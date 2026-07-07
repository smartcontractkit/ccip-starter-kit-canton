import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { CantonConfig, CantonWallet } from '@chainlink/ccip-sdk'

import { networkConfig } from '../../helperConfig'

/** Always required in canton-config.json (JWT is resolved separately). */
const REQUIRED_CONFIG_FIELDS = ['party', 'ccipParty', 'edsUrl', 'transferInstructionUrl'] as const

function readConfigFile(configPath?: string): { path: string; parsed: Record<string, unknown> } {
  const path = resolve(configPath ?? process.env[networkConfig.canton.configPathEnv] ?? '')
  if (!path || !existsSync(path)) {
    throw new Error(
      `Canton config not found at "${path}". Copy config/canton-config.example.json to config/canton-config.json and set ${networkConfig.canton.configPathEnv}.`,
    )
  }

  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  for (const field of REQUIRED_CONFIG_FIELDS) {
    if (typeof parsed[field] !== 'string' || !parsed[field].length) {
      throw new Error(`Canton config "${field}" is required and must be a non-empty string`)
    }
  }

  return { path, parsed }
}

/** True when OIDC client credentials are available for bearer-token refresh. */
export function hasCantonClientCredentials(): boolean {
  const clientId = process.env.CANTON_CLIENT_ID?.trim()
  const clientSecret = process.env.CANTON_CLIENT_SECRET?.trim()
  return Boolean(clientId && clientSecret)
}

/**
 * Load canton-config.json fields (without resolving JWT).
 * Prefer {@link loadCantonConfigWithAuth} for scripts that connect to the ledger.
 */
export function loadCantonConfig(configPath?: string): CantonConfig {
  const { parsed } = readConfigFile(configPath)
  return parsed as unknown as CantonConfig
}

/** Default Canton receiver for EVM → Canton sends (`--cantonReceiver` overrides). */
export function resolveDefaultCantonReceiver(override?: string): string {
  if (override?.trim()) return override.trim()
  return loadCantonConfig().party.trim()
}

/**
 * Build a Canton wallet for JWT-authenticated direct submit (same as ccip-cli without `--wallet`).
 */
export function loadCantonWallet(config: CantonConfig): CantonWallet {
  if (!config.jwt?.trim()) {
    throw new Error(
      'Canton wallet requires a resolved JWT. Call loadCantonConfigWithAuth() before loadCantonWallet().',
    )
  }
  return { party: config.party }
}

/**
 * Fetch a fresh bearer token using OIDC client credentials.
 */
export async function fetchCantonJwt(): Promise<string> {
  const authUrl = process.env.CANTON_AUTH_URL?.replace(/\/$/, '')

  const clientId = process.env.CANTON_CLIENT_ID?.trim() ?? ''
  const clientSecret = process.env.CANTON_CLIENT_SECRET?.trim() ?? ''

  if (!authUrl) {
    throw new Error(
      'Set CANTON_AUTH_URL (OIDC authorization server URL) to obtain a bearer token via client credentials.',
    )
  }

  if (!clientId || !clientSecret) {
    throw new Error('Set CANTON_CLIENT_ID and CANTON_CLIENT_SECRET in .env to obtain a JWT.')
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'daml_ledger_api',
    client_id: clientId,
    client_secret: clientSecret,
  })

  const res = await fetch(`${authUrl}/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  const json = (await res.json()) as { access_token?: string; error?: string }
  if (!res.ok || !json.access_token) {
    throw new Error(`JWT request failed: ${JSON.stringify(json)}`)
  }

  return json.access_token
}

/**
 * Resolve a JWT for Ledger API calls.
 *
 * Priority:
 * 1. `CANTON_JWT` env (explicit override)
 * 2. OIDC client credentials (`CANTON_CLIENT_ID` + `CANTON_CLIENT_SECRET` in `.env`)
 */
export async function resolveCantonJwt(): Promise<string> {
  const jwtOverride = process.env.CANTON_JWT?.trim()
  if (jwtOverride) return jwtOverride

  if (hasCantonClientCredentials()) {
    return fetchCantonJwt()
  }

  throw new Error(
    'Canton JWT is required. Set CANTON_AUTH_URL, CANTON_CLIENT_ID, and CANTON_CLIENT_SECRET in .env, or set CANTON_JWT.',
  )
}

/**
 * Load canton-config.json and resolve JWT before connecting to the ledger.
 */
export async function loadCantonConfigWithAuth(configPath?: string): Promise<CantonConfig> {
  const { parsed } = readConfigFile(configPath)
  const config = parsed as unknown as CantonConfig

  const usedClientCredentials = !process.env.CANTON_JWT?.trim() && hasCantonClientCredentials()
  config.jwt = await resolveCantonJwt()

  if (usedClientCredentials) {
    console.log('Canton bearer token obtained via OIDC client credentials.')
  }

  return config
}
