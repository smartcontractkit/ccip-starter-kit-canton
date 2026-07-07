import type { FinalityRequested } from '@chainlink/ccip-sdk'

/** Parse CLI `--finality` into a {@link FinalityRequested} value. */
export function parseFinalityArg(raw: string): FinalityRequested {
  const lowered = raw.toLowerCase()
  if (lowered === 'finalized') {
    return lowered
  }

  const depth = Number(raw)
  if (Number.isInteger(depth) && depth >= 0) {
    return depth
  }

  throw new Error(
    `Invalid finality "${raw}": use "finalized" or a non-negative integer block depth (e.g. 32)`,
  )
}

export const finalityYargsOption = {
  type: 'string' as const,
  description:
    'Requested source finality: finalized or block depth (e.g. 32 for faster-than-finality)',
} as const

/** User-facing wait hint for any2canton manual-exec after a send. */
export function formatAny2CantonManualExecWaitHint(
  finality: FinalityRequested,
  sourceChainName: string,
): string {
  if (finality === 'finalized') {
    return `once the message is finalized on ${sourceChainName}`
  }
  if (finality === 0) {
    return 'once the source transaction is included (finality 0)'
  }
  if (finality === 1) {
    return `once ${sourceChainName} reaches 1 block confirmation for this message`
  }
  return `once ${sourceChainName} reaches ${finality} block confirmations for this message`
}

/**
 * Actionable "wait and retry" instruction shown when an any2canton manual-exec can't run yet
 * because the message hasn't been verified on the indexer. Phrased by the finality the message
 * requested: `finalized` waits for source finalization, a block depth waits for confirmations.
 */
export function formatAny2CantonNotReadyInstruction(
  finality: FinalityRequested | undefined,
  sourceChainName: string,
): string {
  if (finality === undefined) {
    return `Wait until the source transaction reaches its requested finality on ${sourceChainName}, then retry.`
  }
  if (finality === 'finalized') {
    return `This message requested "finalized" finality — wait until the source transaction is finalized on ${sourceChainName}, then retry.`
  }
  if (finality === 0) {
    return 'This message requested finality 0 — it should be executable shortly after inclusion; wait a moment and retry.'
  }
  const confirmations = finality === 1 ? '1 block confirmation' : `${finality} block confirmations`
  return `This message requested finality = ${finality} — wait until ${sourceChainName} has ${confirmations} past the source transaction, then retry.`
}
