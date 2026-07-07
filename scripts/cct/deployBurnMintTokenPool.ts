import 'dotenv/config'

import { parseCantonInstrumentId } from '@chainlink/ccip-sdk'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { loadCantonConfigWithAuth } from '../canton-helper/cantonConfig'
import { cantonExplorerTx, getCantonChain } from '../utils/chains'
import { deployTokenPool } from './utils/deployTokenPool'

const argv = yargs(hideBin(process.argv))
  .option('instanceId', {
    type: 'string',
    description: 'Unique pool instance ID for your party (e.g. acme-eur-bm-pool)',
    demandOption: true,
  })
  .option('instrument', {
    type: 'string',
    description: 'Canton instrument ID (party::fingerprint::tokenId)',
    demandOption: true,
  })
  .option('poolOwner', {
    type: 'string',
    description: 'Pool owner party (must equal instrument admin for BurnMint)',
  })
  .option('ccipOwner', {
    type: 'string',
    description: 'CCIP owner party (defaults to ccipParty in canton-config.json)',
  })
  .option('decimals', {
    type: 'number',
    description: 'Token decimals on Canton (standard value is 10)',
    default: 10,
  })
  .parseSync()

async function main() {
  const cantonConfig = await loadCantonConfigWithAuth()
  const canton = await getCantonChain(cantonConfig)

  const instrumentId = parseCantonInstrumentId(argv.instrument)
  const poolOwner = (argv.poolOwner ?? cantonConfig.party).trim()
  const ccipOwner = (argv.ccipOwner ?? cantonConfig.ccipParty).trim()

  console.log('Deploying BurnMint token pool on Canton')
  console.log(`   instanceId: ${argv.instanceId}`)
  console.log(`   instrument: ${argv.instrument}`)
  console.log(`   poolOwner:  ${poolOwner}`)

  const result = await deployTokenPool(canton, {
    kind: 'burnMint',
    instanceId: argv.instanceId,
    poolOwner,
    ccipOwner,
    instrumentId,
    decimals: argv.decimals,
  })

  console.log(`✅ BurnMintTokenPool contract ID: ${result.contractId}`)
  console.log(`   Pool address: ${result.poolAddress}`)
  if (result.updateId) {
    console.log(`   Update: ${cantonExplorerTx(result.updateId)}`)
  }
  console.log('')
  console.log('Next step: register the pool on the Token Admin Registry:')
  console.log(
    `   npm run cct:set-token -- --instrument "${argv.instrument}" --poolInstanceId "${argv.instanceId}" --poolOwner "${poolOwner}"`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
