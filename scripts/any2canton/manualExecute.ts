import 'dotenv/config'

import { discoverOffRamp } from '@chainlink/ccip-sdk'
import { hexlify } from 'ethers'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { remoteChainName } from '../../helperConfig'
import { loadCantonConfigWithAuth } from '../canton-helper/cantonConfig'
import {
  cantonExplorerTx,
  getCantonChain,
  getCantonWallet,
  getSepoliaChain,
  printCcipRequest,
} from '../utils/chains'
import {
  isVerificationNotReadyError,
  printAny2CantonNotReadyHint,
  resolveManualExecId,
  resolveManualExecRequest,
} from '../utils/manualExec'

const argv = yargs(hideBin(process.argv))
  .usage('$0 <txHashOrMessageId> [options]')
  .command(
    '$0 <txHashOrMessageId>',
    `Execute an ${remoteChainName} → Canton message on Canton`,
    (y) =>
      y
        .positional('txHashOrMessageId', {
          type: 'string',
          demandOption: true,
          describe: `${remoteChainName} source transaction hash, or the CCIP message ID (0x + 64 hex)`,
        })
        .option('receiver', {
          type: 'string',
          describe:
            'Canton CCIPReceiver contract ID, party ID, or keccak256(party). Defaults to message receiver.',
        }),
  )
  .option('gasLimit', {
    type: 'number',
    description: 'Override gas limit for ccipReceive on Canton (0 keeps original)',
    default: 0,
  })
  .help()
  .parseSync()

async function main() {
  const cantonConfig = await loadCantonConfigWithAuth()
  const canton = await getCantonChain(cantonConfig)
  const sepolia = await getSepoliaChain()
  const wallet = await getCantonWallet(cantonConfig)

  const id = resolveManualExecId(
    argv.txHashOrMessageId as string | undefined,
    hideBin(process.argv),
  )
  const { request, viaMessageId } = await resolveManualExecRequest(sepolia, id)
  printCcipRequest(request, undefined)

  const gasLimit = Number(argv.gasLimit ?? 0)

  // Default to the receiver the message was addressed to (keccak256(party) hash), so execution
  // targets that exact CCIPReceiver when the party owns more than one. Override with --receiver.
  const messageReceiver =
    typeof request.message.receiver === 'string'
      ? request.message.receiver
      : hexlify(request.message.receiver)

  try {
    // Message-ID path: let the SDK fetch the offRamp + verifications from the CCIP API.
    // Transaction path: build them locally from the source transaction + Canton verifications.
    const execInput = viaMessageId
      ? { messageId: request.message.messageId }
      : await (async () => {
          const offRamp =
            ('offRampAddress' in request.message && request.message.offRampAddress) ||
            (await discoverOffRamp(sepolia, canton, request.lane.onRamp, { logger: console }))
          const indexer = cantonConfig.indexerUrl ? [cantonConfig.indexerUrl] : undefined
          const verifications = await canton.getVerifications({ offRamp, request, indexer })
          const input = await sepolia.getExecutionInput({ request, verifications })
          return { offRamp, input }
        })()

    console.log('⚙️  Executing on Canton...')
    console.log(
      '   Resolving CCIPReceiver, fetching EDS disclosures, and submitting to the ledger — often 1–3 minutes with no further output.',
    )
    console.log('   Set CCIP_DEBUG=1 for step-by-step SDK logs.')

    const receipt = await canton.execute({
      wallet,
      ...execInput,
      receiver:
        typeof argv.receiver === 'string' && argv.receiver ? argv.receiver : messageReceiver,
      ...(gasLimit > 0 ? { gasLimit } : {}),
    })

    const updateId = receipt.log.transactionHash
    if (updateId) {
      console.log(`✅ Canton execution transaction: ${cantonExplorerTx(updateId)}`)
    } else {
      console.log('✅ Execution completed:', receipt)
    }
  } catch (err) {
    if (!isVerificationNotReadyError(err)) throw err
    // The message just isn't verified/finalized yet — replace the raw ledger/indexer error
    // with finality-aware guidance. Surface the underlying error only under CCIP_DEBUG.
    if (process.env.CCIP_DEBUG?.trim() === '1') console.error(err)
    printAny2CantonNotReadyHint(
      request,
      sepolia.network.name,
      `npm run any2canton:manual-exec -- ${id}`,
    )
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
