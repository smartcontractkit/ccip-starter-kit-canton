import 'dotenv/config'

import { discoverOffRamp } from '@chainlink/ccip-sdk'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { networkConfig, remoteChainName } from '../../helperConfig'
import { loadCantonConfigWithAuth } from '../canton-helper/cantonConfig'
import {
  getCantonChain,
  getEvmWallet,
  getSepoliaChain,
  printCcipRequest,
  sepoliaExplorerTx,
} from '../utils/chains'
import {
  isVerificationNotReadyError,
  printCanton2AnyNotReadyHint,
  resolveManualExecId,
  resolveManualExecRequest,
} from '../utils/manualExec'

const argv = yargs(hideBin(process.argv))
  .usage('$0 <updateIdOrMessageId> [options]')
  .command(
    '$0 <updateIdOrMessageId>',
    `Execute a Canton → ${remoteChainName} message on ${remoteChainName}`,
    (y) =>
      y
        .positional('updateIdOrMessageId', {
          type: 'string',
          demandOption: true,
          describe:
            'Canton source update ID (Lighthouse link), or the CCIP message ID (0x + 64 hex)',
        })
        .option('gasLimit', {
          type: 'number',
          description: `Override gas limit for ccipReceive on ${remoteChainName} (0 keeps original)`,
          default: 0,
        }),
  )
  .help()
  .parseSync()

async function main() {
  const cantonConfig = await loadCantonConfigWithAuth()
  const canton = await getCantonChain(cantonConfig)
  const sepolia = await getSepoliaChain()
  const wallet = await getEvmWallet()

  const id = resolveManualExecId(
    argv.updateIdOrMessageId as string | undefined,
    hideBin(process.argv),
  )
  const { request, viaMessageId } = await resolveManualExecRequest(canton, id)
  printCcipRequest(request, networkConfig.canton.explorerUrl, 'transactions')

  const gasLimit = Number(argv.gasLimit ?? 0)

  try {
    // Message-ID path: let the SDK fetch the offRamp + verifications from the CCIP API.
    // Update-ID path: build them locally from the Canton transaction + destination verifications.
    const execInput = viaMessageId
      ? { messageId: request.message.messageId }
      : await (async () => {
          const offRamp =
            ('offRampAddress' in request.message && request.message.offRampAddress) ||
            (await discoverOffRamp(canton, sepolia, request.lane.onRamp, { logger: console }))
          const indexer = cantonConfig.indexerUrl ? [cantonConfig.indexerUrl] : undefined
          const verifications = await sepolia.getVerifications({ offRamp, request, indexer })
          const input = await canton.getExecutionInput({ request, verifications })
          return { offRamp, input }
        })()

    console.log(`⚙️  Executing on ${sepolia.network.name}...`)

    const receipt = await sepolia.execute({
      wallet,
      ...execInput,
      ...(gasLimit > 0 ? { gasLimit } : {}),
    })

    const txHash = receipt.log.transactionHash
    if (txHash) {
      console.log(`✅ Execution transaction: ${sepoliaExplorerTx(txHash)}`)
    } else {
      console.log('✅ Execution completed:', receipt)
    }
  } catch (err) {
    if (!isVerificationNotReadyError(err)) throw err
    // The message just isn't verified yet — replace the raw error with wait-and-retry guidance.
    if (process.env.CCIP_DEBUG?.trim() === '1') console.error(err)
    printCanton2AnyNotReadyHint(`npm run canton2any:manual-exec -- ${id}`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
