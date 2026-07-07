import type { CantonChain, CantonInstrumentId } from '@chainlink/ccip-sdk'

import { poolRawAddress } from './ccipHostedAddresses'
import { extractCreatedContractId, extractUpdateId, submitLedgerCommands } from './ledgerSubmit'
import {
  type TokenPoolKind,
  assertBurnMintInstrumentAdmin,
  buildTokenPoolCreateArguments,
  tokenPoolEntityName,
  tokenPoolTemplateId,
} from './tokenPoolArgs'

export interface DeployTokenPoolResult {
  contractId: string
  poolAddress: string
  updateId?: string
}

export async function deployTokenPool(
  canton: CantonChain,
  input: {
    kind: TokenPoolKind
    instanceId: string
    poolOwner: string
    ccipOwner: string
    instrumentId: CantonInstrumentId
    decimals?: number
  },
): Promise<DeployTokenPoolResult> {
  if (input.kind === 'burnMint') {
    assertBurnMintInstrumentAdmin(input.instrumentId, input.poolOwner)
  }

  const createArguments = buildTokenPoolCreateArguments(input)
  const response = await submitLedgerCommands(canton, {
    commands: [
      {
        CreateCommand: {
          templateId: tokenPoolTemplateId(input.kind),
          createArguments,
        },
      },
    ],
    commandId: `cct-deploy-${input.kind}-pool-${Date.now()}`,
    actAs: [input.poolOwner],
  })

  const entityName = tokenPoolEntityName(input.kind)
  const contractId = extractCreatedContractId(response.transaction, entityName)
  if (!contractId) {
    throw new Error(
      `${entityName} creation succeeded but contract ID was not found in the transaction tree`,
    )
  }

  return {
    contractId,
    poolAddress: poolRawAddress(input.instanceId, input.poolOwner),
    updateId: extractUpdateId(response),
  }
}
