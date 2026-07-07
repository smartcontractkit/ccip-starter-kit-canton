import type { FinalityRequested } from '@chainlink/ccip-sdk'
import { ZeroAddress } from 'ethers'

import { type FeeTokenChoice, networkConfig, remoteChain } from '../../helperConfig'

export function resolveEvmFeeToken(feeToken: FeeTokenChoice): string | undefined {
  if (feeToken === remoteChain.feeTokenNameLink) {
    return remoteChain.linkTokenAddress
  }
  if (feeToken === remoteChain.feeTokenNameNative) {
    return ZeroAddress
  }
  throw new Error(`Invalid fee token "${feeToken}". Use "link" or "native".`)
}

/** Build GenericExtraArgsV3 `message.extraArgs` for EVM → Canton sends. */
export function buildEvmToCantonExtraArgs(
  gasLimit: number = networkConfig.canton.defaultGasLimit,
  finality: FinalityRequested,
) {
  return {
    gasLimit: BigInt(gasLimit),
    finality,
  }
}
