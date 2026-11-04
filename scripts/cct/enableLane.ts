import 'dotenv/config'

import { zeroPadValue } from 'ethers'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { remoteChain } from '../../helperConfig'
import { loadCantonConfigWithAuth } from '../canton-helper/cantonConfig'
import { cantonExplorerTx, getCantonChain } from '../utils/chains'
import { ccipHostedAddresses } from './utils/ccipHostedAddresses'
import {
  type RateLimiterSpec,
  blockDepthFinalityConfig,
  enableLane,
  waitForFinalityConfig,
} from './utils/laneEnablement'

const argv = yargs(hideBin(process.argv))
  .option('kind', {
    type: 'string',
    choices: ['burnMint', 'lockRelease'] as const,
    description: 'Token pool family deployed in Step 1',
    demandOption: true,
  })
  .option('poolInstanceId', {
    type: 'string',
    description: 'Token pool instance ID deployed in Step 1',
    demandOption: true,
  })
  .option('poolOwner', {
    type: 'string',
    description:
      'Party that owns the token pool contract (defaults to party in canton-config.json)',
  })
  .option('remoteChainSelector', {
    type: 'string',
    description: 'Destination chain selector (defaults to the configured remote chain)',
    default: remoteChain.chainSelector,
  })
  .option('remotePool', {
    type: 'string',
    description:
      'Remote token pool address, 0x-hex — the pool this lane trusts on the remote chain',
    demandOption: true,
  })
  .option('remoteToken', {
    type: 'string',
    description: 'Remote token address, 0x-hex — the token this lane bridges on the remote chain',
    demandOption: true,
  })
  .option('ccv', {
    type: 'array',
    description:
      'CommitteeVerifier raw instance address(es) for both directions (defaults to the CCIP-hosted testnet CCV)',
  })
  .option('finality', {
    type: 'string',
    choices: ['finalized', 'blockDepth'] as const,
    description: 'Allowed finality policy for the lane (defaults to finalized)',
    default: 'finalized',
  })
  .option('blockDepth', {
    type: 'number',
    description: 'Block depth for --finality blockDepth (1–65535)',
  })
  .option('limiterInstanceIdPrefix', {
    type: 'string',
    description:
      'Prefix for the three rate limiter instance IDs (defaults to <poolInstanceId>-<remoteChainSelector>)',
  })
  .option('enableLimiters', {
    type: 'boolean',
    description:
      'Deploy rate limiters enabled (defaults to disabled with zero capacity/rate for testing)',
    default: false,
  })
  .option('capacity', {
    type: 'string',
    description: 'Rate limiter capacity in the pool decimal representation (with --enableLimiters)',
  })
  .option('rate', {
    type: 'string',
    description:
      'Rate limiter refill per second in the pool decimal representation (with --enableLimiters)',
  })
  .parseSync()

/**
 * Left-pad a 0x-hex (or bare hex) EVM address to 32 bytes, no 0x prefix —
 * the form the pool's ChainUpdate expects for remotePools/remoteTokenAddress.
 */
function to32ByteHex(address: string): string {
  const withPrefix = address.startsWith('0x') ? address : `0x${address}`
  return zeroPadValue(withPrefix, 32).slice(2)
}

function limiterSpecs(
  prefix: string,
): Record<'inbound' | 'inbound-custom' | 'outbound', RateLimiterSpec> {
  const base = {
    isEnabled: argv.enableLimiters,
    capacity: argv.enableLimiters ? (argv.capacity ?? '0') : '0',
    rate: argv.enableLimiters ? (argv.rate ?? '0') : '0',
  }
  return {
    inbound: { instanceId: `${prefix}-in`, ...base },
    'inbound-custom': { instanceId: `${prefix}-in-custom`, ...base },
    outbound: { instanceId: `${prefix}-out`, ...base },
  }
}

async function main() {
  const cantonConfig = await loadCantonConfigWithAuth()
  const canton = await getCantonChain(cantonConfig)

  const poolOwner = (argv.poolOwner ?? cantonConfig.party).trim()
  const remoteChainSelector = argv.remoteChainSelector.trim()
  const remotePools = [to32ByteHex(argv.remotePool)]
  const remoteTokenAddress = to32ByteHex(argv.remoteToken)
  const ccvs = (argv.ccv as string[] | undefined)?.map((c) => c.trim()) ?? [
    ccipHostedAddresses.committeeVerifier,
  ]
  const finalityConfig =
    argv.finality === 'blockDepth'
      ? blockDepthFinalityConfig(requireBlockDepth(argv.blockDepth))
      : waitForFinalityConfig()
  const prefix = (
    argv.limiterInstanceIdPrefix ?? `${argv.poolInstanceId}-${remoteChainSelector}`
  ).trim()
  const limiters = limiterSpecs(prefix)

  console.log('Enabling a cross-chain lane on the token pool')
  console.log(`   pool kind:          ${argv.kind}`)
  console.log(`   poolInstanceId:     ${argv.poolInstanceId}`)
  console.log(`   poolOwner:          ${poolOwner}`)
  console.log(`   remoteChainSelector: ${remoteChainSelector}`)
  console.log(`   remotePools:        ${remotePools.join(', ')}`)
  console.log(`   remoteTokenAddress: ${remoteTokenAddress}`)
  console.log(`   CCVs:               ${ccvs.join(', ')}`)
  console.log(`   finalityConfig:     ${argv.finality}`)
  console.log(
    `   limiters:           ${argv.enableLimiters ? 'enabled' : 'disabled (zero capacity/rate)'}`,
  )

  const result = await enableLane({
    canton,
    kind: argv.kind,
    poolInstanceId: argv.poolInstanceId,
    poolOwner,
    update: {
      remoteChainSelector,
      remotePools,
      remoteTokenAddress,
      inboundCCVs: ccvs,
      outboundCCVs: ccvs,
      finalityConfig,
      inboundRateLimiter: limiters.inbound,
      inboundCustomBlockConfirmationsRateLimiter: limiters['inbound-custom'],
      outboundRateLimiter: limiters.outbound,
    },
  })

  console.log(`✅ Lane enabled for remote chain ${remoteChainSelector}`)
  console.log(`   poolContractId: ${result.poolContractId}`)
  for (const role of ['inbound', 'inbound-custom', 'outbound'] as const) {
    console.log(`   ${role} limiter: ${result.rateLimiterAddresses[role]}`)
  }
  for (const updateId of result.updateIds) {
    console.log(`   Update: ${cantonExplorerTx(updateId)}`)
  }
  console.log('')
  console.log('Next step: stand up EDS for your pool and run end-to-end transfer tests.')
}

function requireBlockDepth(depth: number | undefined): number {
  if (depth === undefined || !Number.isInteger(depth) || depth < 1 || depth > 65535) {
    throw new Error(
      '--blockDepth requires an integer between 1 and 65535 with --finality blockDepth',
    )
  }
  return depth
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
