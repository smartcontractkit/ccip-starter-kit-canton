import {
  type CantonConfig,
  formatCantonLinkFeeToken,
  resolveSenderInstanceId,
} from '@chainlink/ccip-sdk'

import { type CantonFeeTokenChoice, networkConfig, remoteChainName } from '../../helperConfig'

/** Resolve Canton CCIP fee token instrument id (Amulet or CCIP LINK). */
export function resolveCantonFeeToken(feeToken: CantonFeeTokenChoice, ccipParty: string): string {
  if (feeToken === networkConfig.canton.feeTokenNameLink) {
    return formatCantonLinkFeeToken(ccipParty)
  }
  if (feeToken === networkConfig.canton.feeTokenNameNative) {
    return networkConfig.canton.amuletTokenInstrument
  }
  throw new Error(`Invalid fee token "${feeToken}". Use "link" or "native".`)
}

/** Yargs option for Canton source fee token (`link` or native Amulet). */
export const cantonFeeTokenYargsOption = {
  type: 'string' as const,
  choices: [
    networkConfig.canton.feeTokenNameLink,
    networkConfig.canton.feeTokenNameNative,
  ] as const,
  default: networkConfig.canton.feeTokenNameNative,
  description: 'Fee token on Canton (link or native Amulet; default: native)',
} as const

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
