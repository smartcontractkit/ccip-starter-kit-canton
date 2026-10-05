import type { CantonInstrumentId } from '@chainlink/ccip-sdk'

import { ccipHostedAddresses, rawInstanceAddress } from './ccipHostedAddresses'
import {
  emptyChoiceContext,
  emptyGenMap,
  emptyOptional,
  encodeDamlInt64,
  indefiniteTransferTimeout,
} from './ledgerSubmit'

export type TokenPoolKind = 'burnMint' | 'lockRelease'

/** Template IDs in `#package-name:Module:Entity` form — the participant
 * resolves the name to the latest vetted package at submission time.
 */
const TEMPLATE_IDS: Record<TokenPoolKind, string> = {
  burnMint: '#ccip-burn-mint-token-pool-v2:CCIP.BurnMintTokenPoolV2:BurnMintTokenPool',
  lockRelease: '#ccip-lock-release-token-pool-v2:CCIP.LockReleaseTokenPoolV2:LockReleaseTokenPool',
}

const ENTITY_NAMES: Record<TokenPoolKind, string> = {
  burnMint: 'BurnMintTokenPool',
  lockRelease: 'LockReleaseTokenPool',
}

export interface DeployTokenPoolInput {
  kind: TokenPoolKind
  instanceId: string
  poolOwner: string
  ccipOwner: string
  instrumentId: CantonInstrumentId
  decimals?: number
}

export function buildTokenPoolCreateArguments(
  input: DeployTokenPoolInput,
): Record<string, unknown> {
  const decimals = input.decimals ?? 10

  return {
    instanceId: input.instanceId,
    poolOwner: input.poolOwner,
    ccipOwner: input.ccipOwner,
    instrumentId: {
      admin: input.instrumentId.admin,
      id: input.instrumentId.id,
    },
    decimals: encodeDamlInt64(decimals),
    rateLimitAdmin: emptyOptional(),
    remoteChainConfigs: emptyGenMap(),
    tokenTransferFeeConfigs: emptyGenMap(),
    poolReceiveContext: emptyChoiceContext(),
    transferTimeout: indefiniteTransferTimeout(),
    deps: {
      tokenAdminRegistry: rawInstanceAddress(ccipHostedAddresses.tokenAdminRegistry),
      rmnRemote: rawInstanceAddress(ccipHostedAddresses.rmnRemote),
      feeQuoter: rawInstanceAddress(ccipHostedAddresses.feeQuoter),
    },
  }
}

export function tokenPoolTemplateId(kind: TokenPoolKind): string {
  return TEMPLATE_IDS[kind]
}

export function tokenPoolEntityName(kind: TokenPoolKind): string {
  return ENTITY_NAMES[kind]
}

export function assertBurnMintInstrumentAdmin(
  instrumentId: CantonInstrumentId,
  poolOwner: string,
): void {
  if (instrumentId.admin !== poolOwner) {
    throw new Error(
      `BurnMint token pool requires instrument admin (${instrumentId.admin}) to equal poolOwner (${poolOwner})`,
    )
  }
}
