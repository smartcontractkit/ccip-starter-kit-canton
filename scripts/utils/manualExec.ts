import {
  type CCIPRequest,
  type Chain,
  type FinalityRequested,
  CCIPMessageIdNotFoundError,
  CCIPTransactionNotFoundError,
  isSupportedTxHash,
} from '@chainlink/ccip-sdk'
import { isHexString } from 'ethers'

import { formatAny2CantonManualExecWaitHint, formatAny2CantonNotReadyInstruction } from './finality'

const PLACEHOLDER_IDS = new Set([
  'sourceTxHash',
  '<sourceTxHash>',
  '<sepoliaTxHash>',
  '<cantonUpdateId>',
  '<messageId>',
  '<txHashOrMessageId>',
  '<updateIdOrMessageId>',
])

/** Resolve the positional source id; recover when the usage placeholder was passed by mistake. */
export function resolveManualExecId(
  positional: string | undefined,
  argv: readonly string[],
): string {
  let id = positional?.trim() ?? ''

  if (!id || PLACEHOLDER_IDS.has(id)) {
    const hexArg = argv.find((arg) => isSupportedTxHash(arg))
    if (hexArg) id = hexArg
  }

  if (!isSupportedTxHash(id)) {
    throw new Error(
      'Pass the source transaction hash / update ID, or the CCIP message ID, as the first argument.\n' +
        '  npm run any2canton:manual-exec -- 0x<sourceTxHash | messageId>\n' +
        '  npm run canton2any:manual-exec -- <cantonUpdateId | 0xmessageId>\n' +
        '  npx tsx scripts/any2canton/manualExecute.ts 0x<sourceTxHash | messageId>',
    )
  }

  return id
}

/** A CCIP request resolved for manual execution, plus how it was resolved. */
export interface ResolvedManualExec {
  request: CCIPRequest
  /**
   * `true` when resolved from a CCIP message ID — execute with the `{ messageId }` shorthand
   * and let the SDK fetch the offRamp + verifications from the CCIP API. `false` when resolved
   * from a source transaction — build `{ offRamp, input }` locally from on-chain data.
   */
  viaMessageId: boolean
}

/**
 * Resolve a CCIP request from either a source-chain transaction id or a CCIP message ID.
 *
 * An EVM tx hash and a CCIP message ID are both `0x` + 64 hex chars and can't be told apart
 * by shape, so — like `ccip-cli manual-exec` — we race a source-chain lookup against an API
 * message-ID lookup and keep whichever resolves. A Canton update ID (`1220…`) is not 32-byte
 * hex, so it only ever resolves through the source-chain path.
 */
export async function resolveManualExecRequest(
  source: Chain,
  id: string,
): Promise<ResolvedManualExec> {
  const bySourceTx = (async (): Promise<ResolvedManualExec> => {
    const tx = await source.getTransaction(id)
    const messages = await source.getMessagesInTx(tx)
    if (!messages.length) {
      throw new Error(`No CCIP messages found in source transaction ${id}`)
    }
    if (messages.length > 1) {
      console.warn(`Multiple messages in tx; executing the first of ${messages.length}.`)
    }
    return { request: messages[0], viaMessageId: false }
  })()

  // Only a 32-byte hex value can be a CCIP message ID; a Canton update ID never is.
  if (!isHexString(id, 32)) {
    return bySourceTx
  }

  const byMessageId = source
    .getMessageById(id)
    .then((request): ResolvedManualExec => ({ request, viaMessageId: true }))

  try {
    // Promise.any resolves with the first lookup that succeeds and only rejects if both fail.
    return await Promise.any([bySourceTx, byMessageId])
  } catch (err) {
    if (err instanceof AggregateError) {
      // Surface the informative failure, not the expected "wrong kind of id" rejection.
      const meaningful = err.errors.find(
        (e) =>
          !(e instanceof CCIPTransactionNotFoundError) &&
          !(e instanceof CCIPMessageIdNotFoundError),
      )
      throw (
        meaningful ??
        new Error(
          `Could not find a CCIP message for "${id}" as a source transaction or a message ID.`,
        )
      )
    }
    throw err
  }
}

export function formatAny2CantonManualExecCommand(messageId: string): string {
  return `npm run any2canton:manual-exec -- ${messageId}`
}

export function formatCanton2AnyManualExecCommand(messageId: string): string {
  return `npm run canton2any:manual-exec -- ${messageId}`
}

/** Log a copy-pasteable manual-exec command (by CCIP message ID) after a remote → Canton send. */
export function printAny2CantonManualExecHint(
  finality: FinalityRequested,
  messageId: string | undefined,
  sourceChainName: string,
): void {
  if (!messageId) return

  console.log(
    `\n⚙️  Execute on Canton ${formatAny2CantonManualExecWaitHint(finality, sourceChainName)}:`,
  )
  console.log(`   ${formatAny2CantonManualExecCommand(messageId)}`)
}

/** Log a copy-pasteable manual-exec command (by CCIP message ID) after a Canton → remote send with --no-exec. */
export function printCanton2AnyManualExecHint(
  messageId: string | undefined,
  destChainName: string,
): void {
  if (!messageId) return

  console.log(
    `\n⚙️  Execute on ${destChainName} once Committee Verifier proofs are on the indexer:`,
  )
  console.log(`   ${formatCanton2AnyManualExecCommand(messageId)}`)
}

/**
 * True when a manual-exec failure means only that the message isn't verified/finalized yet:
 * the source-chain path 404s at the indexer (`MessageID not found`), or the message-ID path
 * reaches the ledger and is rejected for a `missing required CCV` (the Committee Verifier
 * proof hasn't been posted). Both clear once the requested source finality is reached.
 */
export function isVerificationNotReadyError(err: unknown): boolean {
  const parts: string[] = []
  if (err instanceof Error) parts.push(err.message)
  if (err && typeof err === 'object' && 'context' in err) {
    const cause = (err as { context?: { cantonCause?: unknown } }).context?.cantonCause
    if (typeof cause === 'string') parts.push(cause)
  }
  const text = parts.join(' ')
  return (
    /missing required CCV/i.test(text) ||
    /MessageID not found/i.test(text) ||
    (/verifierresults/i.test(text) && /\b404\b/.test(text))
  )
}

/** Read the source finality requested in an EVM → Canton message's extraArgs, if present. */
export function getRequestedFinality(request: CCIPRequest): FinalityRequested | undefined {
  const extraArgs = (request.message as { extraArgs?: { finality?: FinalityRequested } }).extraArgs
  const finality = extraArgs?.finality
  return finality === 'finalized' || typeof finality === 'number' ? finality : undefined
}

/** Print the finality-aware "not ready yet, wait and retry" guidance for an any2canton exec. */
export function printAny2CantonNotReadyHint(
  request: CCIPRequest,
  sourceChainName: string,
  retryCommand: string,
): void {
  console.log(
    '\n⏳ This message is not ready for manual execution yet — the Committee Verifier has not attested it on the indexer.',
  )
  console.log(
    `   ${formatAny2CantonNotReadyInstruction(getRequestedFinality(request), sourceChainName)}`,
  )
  console.log(`   Retry: ${retryCommand}`)
}

/** Print the "not ready yet, wait and retry" guidance for a canton2any exec. */
export function printCanton2AnyNotReadyHint(retryCommand: string): void {
  console.log(
    '\n⏳ This message is not ready for manual execution yet — the Committee Verifier has not attested it on the indexer.',
  )
  console.log('   Wait until the Committee Verifier proofs are on the indexer, then retry.')
  console.log(`   Retry: ${retryCommand}`)
}
