import { type CantonChain, parseCantonInstrumentId } from '@chainlink/ccip-sdk'
import { Contract, formatUnits } from 'ethers'

import { getCantonChain, getEvmProvider, getEvmWallet } from './chains'
import { networkConfig, remoteChain, remoteChainName } from '../../helperConfig'
import { loadCantonConfigWithAuth } from '../canton-helper/cantonConfig'

export const BALANCE_CHAINS = ['canton', 'sepolia', 'evm'] as const
export const BALANCE_TOKENS = ['link', 'amulet', 'test'] as const

export type BalanceChain = (typeof BALANCE_CHAINS)[number]
export type BalanceToken = (typeof BALANCE_TOKENS)[number]

export interface CantonHoldingRow {
  contractId: string
  amount: string
  locked: boolean
}

export interface BalanceReport {
  chain: 'canton' | 'sepolia'
  token: BalanceToken
  symbol: string
  account: string
  instrumentOrAddress: string
  totalUnlocked: string
  totalLocked: string
  holdings: CantonHoldingRow[]
}

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]

const CANTON_DECIMALS = networkConfig.canton.linkTokenDecimals

function normalizeChain(chain: BalanceChain): 'canton' | 'sepolia' {
  if (chain === 'evm') return 'sepolia'
  return chain
}

export function resolveCantonInstrument(token: 'link' | 'amulet'): {
  instrument: string
  admin: string
  id: string
  decimals: number
} {
  const instrument =
    token === 'link'
      ? networkConfig.canton.linkTokenInstrument
      : networkConfig.canton.amuletTokenInstrument
  const { admin, id } = parseCantonInstrumentId(instrument)
  return {
    instrument,
    admin,
    id,
    decimals: CANTON_DECIMALS,
  }
}

function resolveEvmTokenAddress(token: 'link' | 'test'): string {
  return token === 'link' ? remoteChain.linkTokenAddress : remoteChain.ccipTestTokenAddress
}

export function tokensForChain(chain: BalanceChain): BalanceToken[] {
  const normalized = normalizeChain(chain)
  return normalized === 'canton' ? ['link', 'amulet'] : ['link', 'test']
}

export function assertTokenSupported(chain: BalanceChain, token: BalanceToken): void {
  const normalized = normalizeChain(chain)
  if (normalized === 'canton' && token === 'test') {
    throw new Error(`Token "test" is only on ${remoteChainName}. Use --chain sepolia --token test.`)
  }
  if (normalized === 'sepolia' && token === 'amulet') {
    throw new Error('Token "amulet" is only on Canton. Use --chain canton --token amulet.')
  }
}

function unwrapDamlValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const obj = value as Record<string, unknown>

  if ('Sum' in obj && obj.Sum && typeof obj.Sum === 'object') {
    const sum = obj.Sum as Record<string, unknown>
    return unwrapDamlValue(Object.values(sum)[0])
  }
  if ('value' in obj && Object.keys(obj).length <= 2) {
    return unwrapDamlValue(obj.value)
  }
  if ('Text' in obj) return obj.Text
  if ('text' in obj) return obj.text
  if ('Party' in obj) return obj.Party
  if ('party' in obj) return obj.party
  if ('Numeric' in obj) return obj.Numeric
  if ('numeric' in obj) return obj.numeric
  return value
}

function extractField(record: unknown, fieldName: string): unknown {
  if (!record || typeof record !== 'object') return undefined
  const obj = unwrapDamlValue(record) as Record<string, unknown>

  if (Object.prototype.hasOwnProperty.call(obj, fieldName)) {
    return unwrapDamlValue(obj[fieldName])
  }

  if (Array.isArray(obj.fields)) {
    for (const field of obj.fields as Array<Record<string, unknown>>) {
      if (field.label === fieldName) return unwrapDamlValue(field.value)
    }
  }
  return undefined
}

function extractStringField(record: unknown, fieldName: string): string | null {
  const value = extractField(record, fieldName)
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString()
  return null
}

function extractHoldingView(active: Record<string, unknown>): unknown {
  const interfaceViews = active.interfaceViews
  if (Array.isArray(interfaceViews)) {
    const holdingView = interfaceViews.find((view) => {
      if (!view || typeof view !== 'object') return false
      const viewRecord = view as Record<string, unknown>
      return (
        typeof viewRecord.interfaceId === 'string' &&
        viewRecord.interfaceId.includes('HoldingV1') &&
        viewRecord.viewValue != null
      )
    })
    if (holdingView && typeof holdingView === 'object') {
      return (holdingView as Record<string, unknown>).viewValue
    }
  }
  return active.createArgument
}

function parseDecimalAmount(raw: string): number {
  const trimmed = raw.trim()
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed.replace(/\.$/, ''))) return 0
  return Number(trimmed)
}

function sumDecimalStrings(amounts: string[]): string {
  const total = amounts.reduce((acc, amount) => acc + parseDecimalAmount(amount), 0)
  return total.toString()
}

async function fetchCantonHoldings(
  canton: CantonChain,
  party: string,
  admin: string,
  instrumentId: string,
): Promise<CantonHoldingRow[]> {
  const { offset } = await canton.provider.getLedgerEnd()
  const responses = await canton.provider.getActiveContracts({
    activeAtOffset: offset,
    eventFormat: {
      filtersByParty: {
        [party]: {
          cumulative: [
            {
              identifierFilter: {
                InterfaceFilter: {
                  value: {
                    interfaceId: '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
                    includeInterfaceView: true,
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

  const rows: CantonHoldingRow[] = []

  for (const response of responses) {
    if (!response || typeof response !== 'object') continue
    const entry = (response as Record<string, unknown>).contractEntry
    if (!entry || typeof entry !== 'object' || !('JsActiveContract' in entry)) continue

    const active = (entry as Record<string, unknown>).JsActiveContract
    if (!active || typeof active !== 'object') continue
    const activeRecord = active as Record<string, unknown>
    const created = activeRecord.createdEvent
    if (!created || typeof created !== 'object') continue
    const createdRecord = created as Record<string, unknown>

    const contractId = typeof createdRecord.contractId === 'string' ? createdRecord.contractId : ''
    if (!contractId) continue

    const holdingView = extractHoldingView({
      interfaceViews: createdRecord.interfaceViews,
      createArgument: createdRecord.createArgument,
    })
    if (!holdingView) continue

    const owner = extractStringField(holdingView, 'owner')
    if (owner !== party) continue

    const instrument = extractField(holdingView, 'instrumentId')
    const holdingAdmin = extractStringField(instrument, 'admin')
    const holdingId = extractStringField(instrument, 'id')
    if (holdingAdmin !== admin || holdingId !== instrumentId) continue

    const amount = extractStringField(holdingView, 'amount')
    if (!amount || parseDecimalAmount(amount) <= 0) continue

    rows.push({
      contractId,
      amount,
      locked: extractField(holdingView, 'lock') != null,
    })
  }

  return rows
}

async function getCantonBalanceContext(party?: string): Promise<{
  config: Awaited<ReturnType<typeof loadCantonConfigWithAuth>>
  canton: CantonChain
  account: string
}> {
  const config = await loadCantonConfigWithAuth()
  return {
    config,
    canton: await getCantonChain(config),
    account: party ?? config.party,
  }
}

export async function getCantonTokenBalance(
  token: 'link' | 'amulet',
  party?: string,
  ctx?: { canton: CantonChain; account: string },
): Promise<BalanceReport> {
  const { canton, account } = ctx ?? (await getCantonBalanceContext(party))
  const { instrument, admin, id } = resolveCantonInstrument(token)

  const holdings = await fetchCantonHoldings(canton, account, admin, id)
  const unlocked = holdings.filter((h) => !h.locked).map((h) => h.amount)
  const locked = holdings.filter((h) => h.locked).map((h) => h.amount)

  return {
    chain: 'canton',
    token,
    symbol: token === 'link' ? 'LINK' : 'Amulet',
    account,
    instrumentOrAddress: instrument,
    totalUnlocked: sumDecimalStrings(unlocked),
    totalLocked: sumDecimalStrings(locked),
    holdings,
  }
}

export async function getSepoliaTokenBalance(
  token: 'link' | 'test',
  address?: string,
): Promise<BalanceReport> {
  const provider = await getEvmProvider()
  const wallet = address ? null : await getEvmWallet()
  const account = address ?? (await wallet!.getAddress())
  const tokenAddress = resolveEvmTokenAddress(token)
  const contract = new Contract(tokenAddress, ERC20_ABI, provider)
  const [balance, decimals, symbol] = await Promise.all([
    contract.balanceOf(account),
    contract.decimals(),
    contract.symbol(),
  ])

  const formatted = formatUnits(balance, decimals)

  return {
    chain: 'sepolia',
    token,
    symbol,
    account,
    instrumentOrAddress: tokenAddress,
    totalUnlocked: formatted,
    totalLocked: '0',
    holdings: [],
  }
}

export async function getBalance(
  chain: BalanceChain,
  token: BalanceToken,
  account?: string,
): Promise<BalanceReport> {
  assertTokenSupported(chain, token)
  const normalized = normalizeChain(chain)
  if (normalized === 'canton') {
    return getCantonTokenBalance(token as 'link' | 'amulet', account)
  }
  return getSepoliaTokenBalance(token as 'link' | 'test', account)
}

export async function getAllBalances(opts?: {
  chains?: BalanceChain[]
  account?: string
  party?: string
}): Promise<BalanceReport[]> {
  const chains = opts?.chains ?? (['canton', 'sepolia'] as BalanceChain[])
  const reports: BalanceReport[] = []
  let cantonCtx: Awaited<ReturnType<typeof getCantonBalanceContext>> | undefined

  for (const chain of chains) {
    const normalized = normalizeChain(chain)
    if (normalized === 'canton') {
      cantonCtx ??= await getCantonBalanceContext(opts?.party)
      for (const token of tokensForChain(chain)) {
        reports.push(
          await getCantonTokenBalance(token as 'link' | 'amulet', opts?.party, cantonCtx),
        )
      }
      continue
    }

    for (const token of tokensForChain(chain)) {
      reports.push(await getSepoliaTokenBalance(token as 'link' | 'test', opts?.account))
    }
  }

  return reports
}

export function printBalanceReport(report: BalanceReport, opts?: { showHoldings?: boolean }): void {
  const showHoldings = opts?.showHoldings ?? false

  console.log(`\n${report.chain} · ${report.symbol} (${report.token})`)
  console.log(`  Account:    ${report.account}`)
  console.log(`  Token:      ${report.instrumentOrAddress}`)

  if (report.chain === 'sepolia') {
    console.log(`  Balance:    ${report.totalUnlocked} ${report.symbol}`)
    return
  }

  console.log(`  Unlocked:   ${report.totalUnlocked} ${report.symbol}`)
  if (Number(report.totalLocked) > 0) {
    console.log(`  Locked:     ${report.totalLocked} ${report.symbol}`)
  }

  if (!showHoldings) return

  if (report.holdings.length) {
    console.log('  Holdings:')
    for (const holding of report.holdings) {
      const lockLabel = holding.locked ? 'locked' : 'unlocked'
      console.log(`    - ${holding.amount} ${report.symbol} (${lockLabel}) ${holding.contractId}`)
    }
  } else {
    console.log('  Holdings:   none')
  }
}
