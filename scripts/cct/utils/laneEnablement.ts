import type { CantonChain } from '@chainlink/ccip-sdk'

import { poolRawAddress } from './ccipHostedAddresses'
import {
  encodeDamlInt64,
  extractCreatedContractId,
  extractUpdateId,
  submitLedgerCommands,
} from './ledgerSubmit'
import { RATE_LIMITER_TEMPLATE_ID } from './templateIds'
import { type TokenPoolKind, tokenPoolEntityName, tokenPoolTemplateId } from './tokenPoolArgs'

/** Daml enum constructors (JSON Ledger API encodes enums as bare strings). */
export const RATE_LIMIT_DIRECTION_INBOUND = 'RateLimitDirection_Inbound'
export const RATE_LIMIT_DIRECTION_OUTBOUND = 'RateLimitDirection_Outbound'
export const RATE_LIMIT_MODE_DEFAULT_FINALITY = 'RateLimitMode_DefaultFinality'
export const RATE_LIMIT_MODE_CUSTOM_FINALITY = 'RateLimitMode_CustomFinality'

/** FinalityConfig variants — `{ tag, value }` per the JSON Ledger API. */
export function waitForFinalityConfig(): Record<string, unknown> {
  return { tag: 'WaitForFinality', value: {} }
}

export function blockDepthFinalityConfig(depth: number): Record<string, unknown> {
  return { tag: 'BlockDepth', value: encodeDamlInt64(depth) }
}

/** Daml TIMESTAMP — RFC3339 with microseconds, UTC. */
function damlTimestampNow(): string {
  return new Date().toISOString().replace(/(\.\d{3})Z$/, '$100Z')
}

export type RateLimiterRole = 'inbound' | 'inbound-custom' | 'outbound'

export const RATE_LIMITER_ROLES: ReadonlyArray<RateLimiterRole> = [
  'inbound',
  'inbound-custom',
  'outbound',
]

export interface RateLimiterSpec {
  /** Unique instance ID for your party (no `@`). */
  instanceId: string
  /** Disabled with zero capacity/rate (testing) or enabled with real limits. */
  isEnabled: boolean
  /** Max token capacity, in the pool's local decimal representation. */
  capacity: string
  /** Token refill per second, in the pool's local decimal representation. */
  rate: string
}

export interface LaneChainUpdate {
  /** Destination chain selector (e.g. Sepolia `16015286601757825753`). */
  remoteChainSelector: string
  /** Remote pool address(es), 32-byte hex WITHOUT `0x` (EVM: left-padded). */
  remotePools: string[]
  /** Remote token address, 32-byte hex WITHOUT `0x` (EVM: left-padded). */
  remoteTokenAddress: string
  /** CommitteeVerifier raw instance addresses required for inbound. */
  inboundCCVs: string[]
  /** CommitteeVerifier raw instance addresses required for outbound. */
  outboundCCVs: string[]
  /** Allowed finality policy — `WaitForFinality` or `BlockDepth(n)`. */
  finalityConfig: Record<string, unknown>
  /** Inbound (default finality) limiter spec. */
  inboundRateLimiter: RateLimiterSpec
  /** Inbound (custom finality) limiter spec. */
  inboundCustomBlockConfirmationsRateLimiter: RateLimiterSpec
  /** Outbound limiter spec. */
  outboundRateLimiter: RateLimiterSpec
}

export interface EnableLaneInput {
  canton: CantonChain
  kind: TokenPoolKind
  poolInstanceId: string
  poolOwner: string
  update: LaneChainUpdate
}

export interface EnableLaneResult {
  poolContractId: string
  rateLimiterContractIds: Record<RateLimiterRole, string>
  rateLimiterAddresses: Record<RateLimiterRole, string>
  updateIds: string[]
}

function rateLimiterCreateArguments(
  input: EnableLaneInput,
  role: RateLimiterRole,
  spec: RateLimiterSpec,
): Record<string, unknown> {
  const direction =
    role === 'outbound' ? RATE_LIMIT_DIRECTION_OUTBOUND : RATE_LIMIT_DIRECTION_INBOUND
  const mode =
    role === 'inbound-custom' ? RATE_LIMIT_MODE_CUSTOM_FINALITY : RATE_LIMIT_MODE_DEFAULT_FINALITY

  return {
    instanceId: spec.instanceId,
    poolInstanceId: input.poolInstanceId,
    poolOwner: input.poolOwner,
    remoteChainSelector: input.update.remoteChainSelector,
    direction,
    mode,
    isEnabled: spec.isEnabled,
    capacity: spec.capacity,
    rate: spec.rate,
    tokens: spec.capacity,
    lastUpdated: damlTimestampNow(),
  }
}

function chainUpdateChoiceArgument(
  input: EnableLaneInput,
  update: LaneChainUpdate,
): Record<string, unknown> {
  const limiterAddress = (spec: RateLimiterSpec): { unpack: string } => ({
    unpack: poolRawAddress(spec.instanceId, input.poolOwner),
  })

  return {
    remoteChainSelectorsToRemove: [],
    chainsToAdd: [
      {
        remoteChainSelector: update.remoteChainSelector,
        remotePools: update.remotePools,
        remoteTokenAddress: update.remoteTokenAddress,
        inboundCCVs: update.inboundCCVs.map((unpack) => ({ unpack })),
        outboundCCVs: update.outboundCCVs.map((unpack) => ({ unpack })),
        finalityConfig: update.finalityConfig,
        inboundRateLimiter: limiterAddress(update.inboundRateLimiter),
        inboundCustomBlockConfirmationsRateLimiter: limiterAddress(
          update.inboundCustomBlockConfirmationsRateLimiter,
        ),
        outboundRateLimiter: limiterAddress(update.outboundRateLimiter),
      },
    ],
  }
}

/**
 * Enable a cross-chain lane on a token pool: deploy the three RateLimiter
 * contracts, then exercise `ApplyChainUpdates` on the pool (Step 3 of the
 * CCT guides). All commands are submitted by `poolOwner`.
 */
export async function enableLane(input: EnableLaneInput): Promise<EnableLaneResult> {
  const roles = RATE_LIMITER_ROLES
  const specs: Record<RateLimiterRole, RateLimiterSpec> = {
    inbound: input.update.inboundRateLimiter,
    'inbound-custom': input.update.inboundCustomBlockConfirmationsRateLimiter,
    outbound: input.update.outboundRateLimiter,
  }

  const seen = new Set<string>()
  for (const role of roles) {
    const spec = specs[role]
    if (!spec.instanceId || spec.instanceId.includes('@')) {
      throw new Error(`Rate limiter instanceId for "${role}" must be non-empty without "@"`)
    }
    if (seen.has(spec.instanceId)) {
      throw new Error(
        `Duplicate rate limiter instanceId "${spec.instanceId}" — the pool requires three distinct limiters`,
      )
    }
    seen.add(spec.instanceId)
  }

  const poolContractId = await findPoolContractId(input)
  const updateIds: string[] = []

  console.log('Step 1/2 — Deploy three RateLimiter contracts')
  const rateLimiterContractIds: Record<RateLimiterRole, string> = {
    inbound: '',
    'inbound-custom': '',
    outbound: '',
  }
  const rateLimiterAddresses: Record<RateLimiterRole, string> = {
    inbound: '',
    'inbound-custom': '',
    outbound: '',
  }

  for (const role of roles) {
    const spec = specs[role]
    console.log(
      `   ${role}: ${spec.instanceId} (isEnabled=${spec.isEnabled}, capacity=${spec.capacity}, rate=${spec.rate})`,
    )
    const response = await submitLedgerCommands(input.canton, {
      commands: [
        {
          CreateCommand: {
            templateId: RATE_LIMITER_TEMPLATE_ID,
            createArguments: rateLimiterCreateArguments(input, role, spec),
          },
        },
      ],
      commandId: `cct-deploy-rate-limiter-${role}-${Date.now()}`,
      actAs: [input.poolOwner],
    })

    const contractId = extractCreatedContractId(response.transaction, 'RateLimiter')
    if (!contractId) {
      throw new Error(`RateLimiter (${role}) created but contract ID not found in transaction tree`)
    }
    rateLimiterContractIds[role] = contractId
    rateLimiterAddresses[role] = poolRawAddress(spec.instanceId, input.poolOwner)
    const updateId = extractUpdateId(response)
    if (updateId) updateIds.push(updateId)
    console.log(`   ${role} contract ID: ${contractId}`)
  }

  console.log('Step 2/2 — ApplyChainUpdates on the token pool')
  const poolResponse = await submitLedgerCommands(input.canton, {
    commands: [
      {
        ExerciseCommand: {
          templateId: tokenPoolTemplateId(input.kind),
          contractId: poolContractId,
          choice: 'ApplyChainUpdates',
          choiceArgument: chainUpdateChoiceArgument(input, input.update),
        },
      },
    ],
    commandId: `cct-apply-chain-updates-${Date.now()}`,
    actAs: [input.poolOwner],
  })

  const poolUpdateId = extractUpdateId(poolResponse)
  if (poolUpdateId) updateIds.push(poolUpdateId)

  return { poolContractId, rateLimiterContractIds, rateLimiterAddresses, updateIds }
}

/** Resolve the pool's contract ID from the Active Contract Set by instanceId@poolOwner. */
async function findPoolContractId(input: EnableLaneInput): Promise<string> {
  const { offset } = await input.canton.provider.getLedgerEnd()
  const responses = await input.canton.provider.getActiveContracts({
    activeAtOffset: offset,
    eventFormat: {
      filtersByParty: {
        [input.poolOwner]: {
          cumulative: [
            {
              identifierFilter: {
                TemplateFilter: {
                  value: {
                    templateId: tokenPoolTemplateId(input.kind),
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

  const poolAddress = poolRawAddress(input.poolInstanceId, input.poolOwner)
  for (const response of responses) {
    const entry = (response as Record<string, unknown>)?.contractEntry as
      | Record<string, unknown>
      | undefined
    const active = entry?.JsActiveContract as Record<string, unknown> | undefined
    const created = active?.createdEvent as Record<string, unknown> | undefined
    const contractId = created?.contractId
    const args = created?.createArgument as Record<string, unknown> | undefined
    if (typeof contractId === 'string' && args?.instanceId === input.poolInstanceId) {
      return contractId
    }
  }
  throw new Error(
    `No active ${tokenPoolEntityName(input.kind)} found at ${poolAddress} — deploy the pool first (cct:deploy-${input.kind === 'burnMint' ? 'burn-mint' : 'lock-release'})`,
  )
}
