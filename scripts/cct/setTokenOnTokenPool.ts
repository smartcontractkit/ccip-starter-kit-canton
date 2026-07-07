import 'dotenv/config'

import { parseCantonInstrumentId } from '@chainlink/ccip-sdk'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { poolRawAddress } from './utils/ccipHostedAddresses'
import { loadCantonConfigWithAuth } from '../canton-helper/cantonConfig'
import { cantonExplorerTx, getCantonChain } from '../utils/chains'
import { registerTokenPoolOnTar } from './utils/tarRegistration'

const argv = yargs(hideBin(process.argv))
  .option('instrument', {
    type: 'string',
    description: 'Canton instrument ID (party::fingerprint::tokenId)',
    demandOption: true,
  })
  .option('poolInstanceId', {
    type: 'string',
    description: 'Token pool instance ID deployed in Step 1',
    demandOption: true,
  })
  .option('poolOwner', {
    type: 'string',
    description: 'Party that owns the token pool contract',
  })
  .option('poolAdmin', {
    type: 'string',
    description: 'Party that administers this instrument in TAR (defaults to poolOwner)',
  })
  .option('proposeCaller', {
    type: 'string',
    description:
      'Party that calls ProposeAdministrator (instrument admin or CCIP owner; defaults to instrument admin)',
  })
  .option('tokenConfigCid', {
    type: 'string',
    description:
      'Existing TokenConfig CID — skip ProposeAdministrator and resume at AcceptAdminRole (steps 2–3)',
  })
  .option('skipAccept', {
    type: 'boolean',
    default: false,
    description: 'Skip AcceptAdminRole and resume at SetPool (step 3 only)',
  })
  .parseSync()

async function main() {
  const cantonConfig = await loadCantonConfigWithAuth()
  const canton = await getCantonChain(cantonConfig)

  const instrumentId = parseCantonInstrumentId(argv.instrument)
  const poolOwner = (argv.poolOwner ?? cantonConfig.party).trim()
  const poolAdmin = (argv.poolAdmin ?? poolOwner).trim()
  const proposeCaller = (argv.proposeCaller ?? instrumentId.admin).trim()
  const poolAddress = poolRawAddress(argv.poolInstanceId, poolOwner)

  console.log('Registering token pool on the Token Admin Registry (TAR)')
  console.log(`   instrument:     ${argv.instrument}`)
  console.log(`   poolInstanceId: ${argv.poolInstanceId}`)
  console.log(`   pool address:   ${poolAddress}`)
  console.log(`   poolOwner:      ${poolOwner}`)
  console.log(`   poolAdmin:      ${poolAdmin}`)
  console.log(`   proposeCaller:  ${proposeCaller}`)

  const result = await registerTokenPoolOnTar({
    canton,
    cantonConfig,
    instrumentId,
    poolInstanceId: argv.poolInstanceId,
    poolOwner,
    poolAdmin,
    proposeCaller,
    tokenConfigCid: argv.tokenConfigCid?.trim() || undefined,
    skipAccept: argv.skipAccept,
  })

  console.log(`✅ Token pool registered for ${argv.instrument}`)
  console.log(`   tokenConfigCid: ${result.tokenConfigCid}`)
  for (const updateId of result.updateIds) {
    console.log(`   Update: ${cantonExplorerTx(updateId)}`)
  }
  console.log('')
  console.log(
    'Next step: enable a cross-chain lane (rate limiters + ApplyChainUpdates on the pool).',
  )
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
