import { type CantonConfig, resolveSenderInstanceId } from '@chainlink/ccip-sdk'

import { networkConfig, remoteChainName } from '../../helperConfig'

/** Resolve the Canton CCIP fee token instrument id (Amulet). */
export function resolveCantonFeeToken(): string {
  return networkConfig.canton.amuletTokenInstrument
}

/** CCIPSender instance id for Canton source sends (`canton-config.json` `senderInstanceId`). */
export function getCantonRouter(cantonConfig: CantonConfig): string {
  return resolveSenderInstanceId(cantonConfig)
}

/**
 * Yargs boolean for destination auto-execution.
 * Users pass `--no-exec` to set this to false (yargs negation of `exec`).
 */
export const autoExecYargsOption = {
  type: 'boolean' as const,
  default: true,
  description: `Allow automatic execution on ${remoteChainName} (default). Pass --no-exec to skip and use canton2any:manual-exec after proofs are on the indexer.`,
} as const

/** Build `message.extraArgs` for Canton → EVM sends. */
export function buildCantonToEvmExtraArgs(
  gasLimit: number = networkConfig.canton.defaultGasLimit,
  noExec = false,
) {
  return {
    gasLimit: BigInt(gasLimit),
    ...(noExec ? { executorMode: 'none' as const } : {}),
  }
}
