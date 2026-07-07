import type { CantonChain } from '@chainlink/ccip-sdk'

type LedgerCommands = Parameters<CantonChain['provider']['submitAndWaitForTransaction']>[0]
type LedgerSubmitResponse = Awaited<
  ReturnType<CantonChain['provider']['submitAndWaitForTransaction']>
>

/** Encode a Daml INT64 for the JSON Ledger API (string, not JSON number). */
export function encodeDamlInt64(value: bigint | number): string {
  return value.toString()
}

export function indefiniteTransferTimeout(): Record<string, unknown> {
  return { tag: 'Indefinite', value: {} }
}

export function emptyChoiceContext(): Record<string, unknown> {
  return { values: {} }
}

/** Empty Daml GenMap — encoded as `[]` (array of [key, value] pairs). */
export function emptyGenMap(): unknown[] {
  return []
}

/** Empty Daml Optional at record field level. */
export function emptyOptional(): null {
  return null
}

async function resolveSynchronizerId(canton: CantonChain): Promise<string | undefined> {
  const fromEnv = process.env.CANTON_SYNCHRONIZER_ID?.trim()
  if (fromEnv) return fromEnv

  const synchronizers = await canton.provider.getConnectedSynchronizers()
  return synchronizers[0]?.synchronizerId
}

/** Enrich JsCommands with fields required by prod-testnet JSON Ledger API. */
export async function enrichLedgerCommands(
  canton: CantonChain,
  commands: LedgerCommands,
): Promise<LedgerCommands> {
  const synchronizerId = commands.synchronizerId ?? (await resolveSynchronizerId(canton))

  return {
    ...commands,
    synchronizerId,
    disclosedContracts: commands.disclosedContracts ?? [],
    packageIdSelectionPreference: commands.packageIdSelectionPreference ?? [],
    deduplicationPeriod: commands.deduplicationPeriod ?? { Empty: {} },
  }
}

export async function submitLedgerCommands(
  canton: CantonChain,
  commands: LedgerCommands,
): Promise<LedgerSubmitResponse> {
  return canton.provider.submitAndWaitForTransaction(await enrichLedgerCommands(canton, commands))
}

export function templateEntityName(templateId: string): string {
  const parts = templateId.split(':')
  return parts[parts.length - 1] ?? templateId
}

/** Match template entity exactly (last `:` segment), not module substring. */
export function matchesTemplateEntity(templateId: string, entityName: string): boolean {
  return templateEntityName(templateId) === entityName
}

export function extractCreatedContractId(
  transaction: unknown,
  entityName: string,
): string | undefined {
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
    if (matchesTemplateEntity(tid, entityName)) return contractId
  }
  return undefined
}

export function extractExerciseResultField(
  transaction: unknown,
  choiceName: string,
  fieldName: string,
): string | undefined {
  for (const event of extractEventsFromTransaction(transaction)) {
    if (!event || typeof event !== 'object') continue
    const rec = event as Record<string, unknown>
    const choice = rec.choice ?? rec.choiceId
    if (typeof choice !== 'string' || !choice.includes(choiceName)) continue

    const result = rec.exerciseResult ?? rec.exercise_result
    const value = findFieldValue(result, fieldName)
    if (typeof value === 'string') return value
  }
  return undefined
}

export function findFieldValue(value: unknown, fieldName: string): unknown {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (fieldName in record) return record[fieldName]

  if (Array.isArray(record.fields)) {
    for (const field of record.fields as Array<Record<string, unknown>>) {
      if (field.label === fieldName) return field.value
    }
  }

  for (const key of ['value', 'record', 'Sum']) {
    if (record[key] && typeof record[key] === 'object') {
      const nested = findFieldValue(record[key], fieldName)
      if (nested !== undefined) return nested
    }
  }

  return undefined
}

export function extractEventsFromTransaction(transaction: unknown): unknown[] {
  if (!transaction || typeof transaction !== 'object') return []
  const record = transaction as Record<string, unknown>
  const events = record.events
  if (Array.isArray(events)) {
    return events.flatMap((event) => {
      if (!event || typeof event !== 'object') return []
      const ev = event as Record<string, unknown>
      for (const key of ['CreatedEvent', 'ExercisedEvent', 'ArchivedEvent']) {
        if (ev[key] && typeof ev[key] === 'object') return [ev[key]]
      }
      return [event]
    })
  }

  for (const key of ['transaction', 'JsTransaction']) {
    if (record[key] && typeof record[key] === 'object' && !Array.isArray(record[key])) {
      return extractEventsFromTransaction(record[key])
    }
  }

  return []
}

export function getTemplateEntityName(event: Record<string, unknown>): string {
  const templateId = event.templateId ?? event.template_id
  if (typeof templateId === 'string') {
    const parts = templateId.split(':')
    return parts[parts.length - 1] ?? templateId
  }
  if (templateId && typeof templateId === 'object') {
    const rec = templateId as Record<string, unknown>
    if (typeof rec.entityName === 'string') return rec.entityName
    if (typeof rec.entity_name === 'string') return rec.entity_name
  }
  return ''
}

export function extractUpdateId(response: LedgerSubmitResponse): string | undefined {
  const tx = response.transaction as Record<string, unknown> | undefined
  const updateId = tx?.updateId ?? tx?.update_id
  return typeof updateId === 'string' ? updateId : undefined
}
