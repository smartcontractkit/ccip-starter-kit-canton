import type { CantonChain, CantonConfig, CantonInstrumentId } from '@chainlink/ccip-sdk'

import { ccipHostedAddresses } from './ccipHostedAddresses'
import {
  emptyChoiceContext,
  extractCreatedContractId,
  extractEventsFromTransaction,
  extractExerciseResultField,
  extractUpdateId,
  findFieldValue,
  getTemplateEntityName,
  matchesTemplateEntity,
  submitLedgerCommands,
} from './ledgerSubmit'

/**
 * Template IDs in `#package-name:Module:Entity` form — the participant
 * resolves the name to the latest vetted package at submission time.
 * (EDS disclosures carry hash-form templateIds; those identify the
 * disclosed contract and are not used in commands.)
 */
const TAR_TEMPLATE_ID = '#ccip-core-v2:CCIP.CoreV2.TokenAdminRegistry:TokenAdminRegistry'
const TOKEN_CONFIG_TEMPLATE_ID = '#ccip-core-v2:CCIP.CoreV2.TokenAdminRegistry:TokenConfig'

export interface DisclosedContractPayload {
  templateId: string
  contractId: string
  createdEventBlob: string
  synchronizerId: string
}

interface TarDisclosureBundle {
  tarContractId: string
  disclosedContracts: DisclosedContractPayload[]
}

export interface RegisterTokenPoolOnTarInput {
  canton: CantonChain
  cantonConfig: CantonConfig
  instrumentId: CantonInstrumentId
  poolInstanceId: string
  poolOwner: string
  poolAdmin: string
  proposeCaller: string
  /** Skip ProposeAdministrator when step 1 already completed (resume steps 2–3). */
  tokenConfigCid?: string
  /** Skip AcceptAdminRole when step 2 already completed (resume at SetPool). */
  skipAccept?: boolean
}

export interface RegisterTokenPoolOnTarResult {
  tokenConfigCid: string
  updateIds: string[]
}

async function fetchTarDisclosures(
  edsUrl: string,
  tarAddress: string,
): Promise<TarDisclosureBundle> {
  const res = await fetch(`${edsUrl.replace(/\/$/, '')}/ccip/v1/global/disclosure/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addresses: [tarAddress] }),
  })

  const text = await res.text()
  let json: { disclosures?: DisclosedContractPayload[]; error?: string }
  try {
    json = text ? (JSON.parse(text) as typeof json) : {}
  } catch {
    throw new Error(
      `Failed to parse Token Admin Registry disclosure response (${res.status}): ${text.slice(0, 200) || '(empty body)'}`,
    )
  }

  if (!res.ok) {
    throw new Error(
      `Failed to fetch Token Admin Registry disclosure (${res.status}): ${JSON.stringify(json)}`,
    )
  }

  const disclosures = json.disclosures ?? []
  if (!disclosures.length) {
    throw new Error(`No disclosures returned for Token Admin Registry address ${tarAddress}`)
  }

  const tarDisclosure =
    disclosures.find((d) => matchesTemplateEntity(d.templateId, 'TokenAdminRegistry')) ??
    disclosures[0]

  return {
    tarContractId: tarDisclosure.contractId,
    disclosedContracts: disclosures,
  }
}

function extractLatestCreatedContractId(
  transaction: unknown,
  entityName: string,
): string | undefined {
  let latest: string | undefined
  for (const event of extractEventsFromTransaction(transaction)) {
    if (!event || typeof event !== 'object') continue
    const rec = event as Record<string, unknown>
    const contractId = rec.contractId ?? rec.contract_id
    if (typeof contractId !== 'string') continue

    const templateId = rec.templateId ?? rec.template_id
    const tid =
      typeof templateId === 'string'
        ? templateId
        : getTemplateEntityName(
            templateId && typeof templateId === 'object'
              ? { ...rec, templateId, template_id: templateId }
              : rec,
          )
    if (matchesTemplateEntity(tid, entityName)) latest = contractId
  }
  return latest
}

function extractContractIdValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>
    const cid = rec.contractId ?? rec.contract_id
    if (typeof cid === 'string') return cid
  }
  return undefined
}

function extractProposeAdministratorResult(transaction: unknown): {
  tokenAdminRegistryCid?: string
  tokenConfigCid?: string
} {
  for (const event of extractEventsFromTransaction(transaction)) {
    if (!event || typeof event !== 'object') continue
    const rec = event as Record<string, unknown>
    const choice = rec.choice ?? rec.choiceId
    if (typeof choice !== 'string' || !choice.includes('ProposeAdministrator')) continue

    const result = rec.exerciseResult ?? rec.exercise_result
    const tokenAdminRegistryCid = extractContractIdValue(
      findFieldValue(result, 'tokenAdminRegistryCid'),
    )
    const tokenConfigCid = extractContractIdValue(findFieldValue(result, 'tokenConfigCid'))

    if (tokenAdminRegistryCid || tokenConfigCid) {
      return { tokenAdminRegistryCid, tokenConfigCid }
    }
  }

  return {
    tokenAdminRegistryCid: extractLatestCreatedContractId(transaction, 'TokenAdminRegistry'),
    tokenConfigCid: extractLatestCreatedContractId(transaction, 'TokenConfig'),
  }
}

function extractChoiceResultContractId(
  transaction: unknown,
  choiceName: string,
): string | undefined {
  for (const event of extractEventsFromTransaction(transaction)) {
    if (!event || typeof event !== 'object') continue
    const rec = event as Record<string, unknown>
    const choice = rec.choice ?? rec.choiceId
    if (typeof choice !== 'string' || !choice.includes(choiceName)) continue

    const result = rec.exerciseResult ?? rec.exercise_result
    if (typeof result === 'string') return result
    const cid = extractContractIdValue(result)
    if (cid) return cid
  }
  return undefined
}

async function resolveTokenConfigCidAfterAccept(
  canton: CantonChain,
  party: string,
  instrumentId: CantonInstrumentId,
  tokenConfigTemplate: string,
  acceptTransaction: unknown,
  fallback: string,
): Promise<string> {
  return (
    extractChoiceResultContractId(acceptTransaction, 'AcceptAdminRole') ??
    extractLatestCreatedContractId(acceptTransaction, 'TokenConfig') ??
    (await findTokenConfigCid(canton, party, instrumentId, tokenConfigTemplate)) ??
    fallback
  )
}

async function refreshTarDisclosuresAfterPropose(
  edsUrl: string,
  tarAddress: string,
  proposeTransaction: unknown,
  previous: TarDisclosureBundle,
): Promise<TarDisclosureBundle> {
  const parsed = extractProposeAdministratorResult(proposeTransaction)

  try {
    const refreshed = await fetchTarDisclosures(edsUrl, tarAddress)
    // Prefer fresh EDS TAR CID; only override when exercise result differs from TokenConfig.
    if (parsed.tokenAdminRegistryCid && parsed.tokenAdminRegistryCid !== parsed.tokenConfigCid) {
      refreshed.tarContractId = parsed.tokenAdminRegistryCid
    }
    return refreshed
  } catch {
    return {
      tarContractId: parsed.tokenAdminRegistryCid ?? previous.tarContractId,
      disclosedContracts: previous.disclosedContracts,
    }
  }
}

async function findTokenConfigCid(
  canton: CantonChain,
  party: string,
  instrumentId: CantonInstrumentId,
  tokenConfigTemplate: string,
): Promise<string | undefined> {
  const { offset } = await canton.provider.getLedgerEnd()
  const responses = await canton.provider.getActiveContracts({
    activeAtOffset: offset,
    eventFormat: {
      filtersByParty: {
        [party]: {
          cumulative: [
            {
              identifierFilter: {
                TemplateFilter: {
                  value: {
                    templateId: tokenConfigTemplate,
                    includeCreatedEventBlob: false,
                  },
                },
              },
            },
          ],
        },
      },
      verbose: true,
    },
  })

  for (const response of responses) {
    const entry = (response as Record<string, unknown>)?.contractEntry as
      | Record<string, unknown>
      | undefined
    const active = entry?.JsActiveContract as Record<string, unknown> | undefined
    const created = active?.createdEvent as Record<string, unknown> | undefined
    const contractId = created?.contractId
    const args = created?.createArgument as Record<string, unknown> | undefined
    const inst = args?.instrumentId as Record<string, unknown> | undefined
    if (
      typeof contractId === 'string' &&
      inst?.admin === instrumentId.admin &&
      inst?.id === instrumentId.id
    ) {
      return contractId
    }
  }
  return undefined
}

/**
 * Project EDS disclosures into ledger `disclosedContracts` entries.
 * `templateId` is optional (validation only) and omitted — the EDS
 * hash-form value is not used in submissions.
 */
function mapDisclosedContracts(
  contracts: DisclosedContractPayload[],
): Array<{ contractId: string; createdEventBlob: string; synchronizerId: string }> {
  return contracts.map((dc) => ({
    contractId: dc.contractId,
    createdEventBlob: dc.createdEventBlob,
    synchronizerId: dc.synchronizerId,
  }))
}

export async function registerTokenPoolOnTar(
  input: RegisterTokenPoolOnTarInput,
): Promise<RegisterTokenPoolOnTarResult> {
  const tarAddress = ccipHostedAddresses.tokenAdminRegistry
  let { tarContractId, disclosedContracts } = await fetchTarDisclosures(
    input.cantonConfig.edsUrl,
    tarAddress,
  )
  const updateIds: string[] = []
  let tokenConfigCid = input.tokenConfigCid?.trim() ?? ''

  if (input.skipAccept) {
    console.log('Step 1/3 — ProposeAdministrator (skipped)')
    tokenConfigCid =
      (await findTokenConfigCid(
        input.canton,
        input.poolAdmin,
        input.instrumentId,
        TOKEN_CONFIG_TEMPLATE_ID,
      )) ?? tokenConfigCid
    if (!tokenConfigCid) {
      throw new Error('No active TokenConfig found on ledger for this instrument')
    }
    console.log(`   tokenConfigCid: ${tokenConfigCid}`)
    console.log(`   tarContractId:  ${tarContractId}`)
  } else if (tokenConfigCid) {
    console.log('Step 1/3 — ProposeAdministrator (skipped; using provided tokenConfigCid)')
    console.log(`   tokenConfigCid: ${tokenConfigCid}`)
    console.log(`   tarContractId:  ${tarContractId}`)
  } else {
    console.log('Step 1/3 — ProposeAdministrator on Token Admin Registry')
    const proposeResponse = await submitLedgerCommands(input.canton, {
      commands: [
        {
          ExerciseCommand: {
            templateId: TAR_TEMPLATE_ID,
            contractId: tarContractId,
            choice: 'ProposeAdministrator',
            choiceArgument: {
              tokenConfigCid: null,
              instrumentId: {
                admin: input.instrumentId.admin,
                id: input.instrumentId.id,
              },
              newAdmin: input.poolAdmin,
              context: emptyChoiceContext(),
              caller: input.proposeCaller,
            },
          },
        },
      ],
      commandId: `cct-tar-propose-${Date.now()}`,
      actAs: [input.proposeCaller],
      disclosedContracts: mapDisclosedContracts(disclosedContracts),
    })

    const proposeUpdateId = extractUpdateId(proposeResponse)
    if (proposeUpdateId) updateIds.push(proposeUpdateId)

    const proposeResult = extractProposeAdministratorResult(proposeResponse.transaction)
    tokenConfigCid = proposeResult.tokenConfigCid ?? ''

    const tarState = await refreshTarDisclosuresAfterPropose(
      input.cantonConfig.edsUrl,
      tarAddress,
      proposeResponse.transaction,
      { tarContractId, disclosedContracts },
    )
    tarContractId = tarState.tarContractId
    disclosedContracts = tarState.disclosedContracts

    if (!tokenConfigCid) {
      throw new Error(
        'ProposeAdministrator succeeded but tokenConfigCid was not found in the transaction tree',
      )
    }
    console.log(`   tokenConfigCid: ${tokenConfigCid}`)
    console.log(`   tarContractId:  ${tarContractId}`)
  }

  if (input.skipAccept) {
    console.log('Step 2/3 — AcceptAdminRole (skipped)')
  } else {
    console.log('Step 2/3 — AcceptAdminRole on Token Admin Registry')
    try {
      const acceptResponse = await submitLedgerCommands(input.canton, {
        commands: [
          {
            ExerciseCommand: {
              templateId: TAR_TEMPLATE_ID,
              contractId: tarContractId,
              choice: 'AcceptAdminRole',
              choiceArgument: {
                tokenConfigCid,
                instrumentId: {
                  admin: input.instrumentId.admin,
                  id: input.instrumentId.id,
                },
                context: emptyChoiceContext(),
                caller: input.poolAdmin,
              },
            },
          },
        ],
        commandId: `cct-tar-accept-${Date.now()}`,
        actAs: [input.poolAdmin],
        disclosedContracts: mapDisclosedContracts(disclosedContracts),
      })

      const acceptUpdateId = extractUpdateId(acceptResponse)
      if (acceptUpdateId) updateIds.push(acceptUpdateId)

      tokenConfigCid = await resolveTokenConfigCidAfterAccept(
        input.canton,
        input.poolAdmin,
        input.instrumentId,
        TOKEN_CONFIG_TEMPLATE_ID,
        acceptResponse.transaction,
        tokenConfigCid,
      )
      console.log(`   tokenConfigCid: ${tokenConfigCid}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!message.includes('CONTRACT_NOT_FOUND') && !message.includes('no pending admin')) {
        throw err
      }
      console.log('   AcceptAdminRole skipped — resolving TokenConfig from ledger')
      tokenConfigCid =
        (await findTokenConfigCid(
          input.canton,
          input.poolAdmin,
          input.instrumentId,
          TOKEN_CONFIG_TEMPLATE_ID,
        )) ?? tokenConfigCid
      if (!tokenConfigCid) throw err
      console.log(`   tokenConfigCid: ${tokenConfigCid}`)
    }
  }

  console.log('Step 3/3 — SetPool on Token Admin Registry')
  const setPoolResponse = await submitLedgerCommands(input.canton, {
    commands: [
      {
        ExerciseCommand: {
          templateId: TAR_TEMPLATE_ID,
          contractId: tarContractId,
          choice: 'SetPool',
          choiceArgument: {
            tokenConfigCid,
            instrumentId: {
              admin: input.instrumentId.admin,
              id: input.instrumentId.id,
            },
            tokenPool: {
              poolOwner: input.poolOwner,
              poolInstanceId: input.poolInstanceId,
            },
            context: emptyChoiceContext(),
            caller: input.poolAdmin,
          },
        },
      },
    ],
    commandId: `cct-tar-set-pool-${Date.now()}`,
    actAs: [input.poolAdmin],
    disclosedContracts: mapDisclosedContracts(disclosedContracts),
  })

  const updateId = extractUpdateId(setPoolResponse)
  if (updateId) updateIds.push(updateId)

  const finalConfigCid =
    extractExerciseResultField(setPoolResponse.transaction, 'SetPool', 'tokenConfigCid') ??
    extractCreatedContractId(setPoolResponse.transaction, 'TokenConfig') ??
    tokenConfigCid

  return { tokenConfigCid: finalConfigCid, updateIds }
}
