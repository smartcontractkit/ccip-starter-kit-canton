import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { type Server, createServer } from 'node:http'
import { resolve } from 'node:path'

import {
  type AccessToken,
  type AuthorizationCodeAuthConfig,
  type CantonAuthConfig,
  type CantonConfig,
  type CantonWallet,
  CantonAuthType,
  CantonStaticProvider,
  buildCantonAuthorizationRequest,
  createCantonAuthProvider,
  createCantonAuthorizationCodeProvider,
  exchangeCantonAuthorizationCode,
  validateCantonAuthorizationCallback,
} from '@chainlink/ccip-sdk'

import { networkConfig } from '../../helperConfig'

/** Always required in canton-config.json (JWT is resolved separately). */
const REQUIRED_CONFIG_FIELDS = ['party', 'ccipParty', 'edsUrl', 'transferInstructionUrl'] as const

/** Default local redirect URI for the authorization-code callback server. */
const DEFAULT_CALLBACK_URL = 'http://localhost:8400/callback'

/** Default overall authorization-code flow timeout (2 minutes). */
const DEFAULT_FLOW_TIMEOUT_MS = 120_000

/** HTML shown in the browser after a successful authorization-code callback. */
const CALLBACK_SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head><title>Authentication Complete</title></head>
<body style="font-family: sans-serif; text-align: center; padding: 40px;">
  <h1>Authentication complete!</h1>
  <p>You can safely close this window.</p>
</body>
</html>`

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
  if (!config.jwt) {
    throw new Error(
      'Canton wallet requires a resolved JWT. Call loadCantonConfigWithAuth() before loadCantonWallet().',
    )
  }
  return { party: config.party }
}

/**
 * Resolve the OIDC auth config from the `auth` block in canton-config.json, merged
 * with `.env` variables (same pattern as ccip-cli).
 *
 * The config file carries the non-secret parameters (`type`, `authUrl`, `audience`,
 * `scopes`); credentials come from `.env` (`CANTON_CLIENT_ID` / `CANTON_CLIENT_SECRET`),
 * keeping secrets out of version-controlled JSON files.
 *
 * Priority:
 * 1. `auth` block in canton-config.json (with `.env` filling missing credentials)
 * 2. `CANTON_JWT` env (static pre-fetched token)
 * 3. `CANTON_AUTH_URL` + `CANTON_CLIENT_ID` + `CANTON_CLIENT_SECRET` (client credentials)
 * 4. `CANTON_AUTH_URL` + `CANTON_CLIENT_ID` (authorization code, interactive browser login)
 */
export function resolveCantonAuthConfig(auth?: CantonAuthConfig): CantonAuthConfig {
  if (auth) {
    return mergeAuthEnvVars(auth)
  }

  const jwt = process.env.CANTON_JWT?.trim()
  if (jwt) {
    return { type: CantonAuthType.Static, jwt }
  }

  const authUrl = process.env.CANTON_AUTH_URL?.trim().replace(/\/$/, '')
  const clientId = process.env.CANTON_CLIENT_ID?.trim()
  const clientSecret = process.env.CANTON_CLIENT_SECRET?.trim()

  if (!authUrl || !clientId) {
    throw new Error(
      'Canton auth is required. Set an "auth" block in canton-config.json, or set CANTON_AUTH_URL + CANTON_CLIENT_ID (+ CANTON_CLIENT_SECRET for client credentials) in .env, or set CANTON_JWT.',
    )
  }

  if (clientSecret) {
    return { type: CantonAuthType.ClientCredentials, authUrl, clientId, clientSecret }
  }

  return { type: CantonAuthType.AuthorizationCode, authUrl, clientId }
}

/**
 * Merge `CANTON_CLIENT_ID` / `CANTON_CLIENT_SECRET` env vars into an `auth` block
 * when it omits them, validating that the merged config is complete.
 */
function mergeAuthEnvVars(auth: CantonAuthConfig): CantonAuthConfig {
  const envClientId = process.env.CANTON_CLIENT_ID?.trim()
  const envClientSecret = process.env.CANTON_CLIENT_SECRET?.trim()

  if (auth.type === CantonAuthType.ClientCredentials) {
    const clientId = auth.clientId || envClientId || ''
    const clientSecret = auth.clientSecret || envClientSecret || ''
    if (!clientId || !clientSecret) {
      throw new Error(
        'clientCredentials auth requires a clientId and clientSecret. Set them in the auth block or via the CANTON_CLIENT_ID and CANTON_CLIENT_SECRET environment variables.',
      )
    }
    return { ...auth, clientId, clientSecret }
  }

  if (auth.type === CantonAuthType.AuthorizationCode) {
    const clientId = auth.clientId || envClientId || ''
    if (!clientId) {
      throw new Error(
        'authorizationCode auth requires a clientId. Set it in the auth block or via the CANTON_CLIENT_ID environment variable.',
      )
    }
    return { ...auth, clientId }
  }

  return auth
}

/**
 * Open a URL in the default browser (cross-platform best-effort).
 */
function openBrowser(url: string): Promise<void> {
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
  return new Promise((resolve) => {
    execFile(cmd, [url], (err) => {
      if (err) {
        process.stderr.write(`Could not open browser — visit this URL manually:\n${url}\n`)
      }
      resolve()
    })
  })
}

/**
 * Run the authorization-code + PKCE flow: start a local callback server, open the
 * browser, wait for the callback, and exchange the code for tokens.
 */
async function runAuthorizationCodeFlow(config: AuthorizationCodeAuthConfig): Promise<AccessToken> {
  const callbackUrl = config.callbackUrl ?? DEFAULT_CALLBACK_URL

  const req = await buildCantonAuthorizationRequest(config, { redirectUri: callbackUrl })

  const callback = new URL(callbackUrl)
  const callbackPath = callback.pathname || '/callback'
  const callbackHost = callback.hostname || '127.0.0.1'
  const callbackPort = Number(callback.port) || 8400

  return new Promise<AccessToken>((resolve, reject) => {
    let settled = false

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close()
      fn()
    }

    const server: Server = createServer((req2, res) => {
      const reqUrl = new URL(req2.url ?? '/', `http://${callbackHost}:${callbackPort}`)
      if (reqUrl.pathname !== callbackPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not found')
        return
      }

      validateCantonAuthorizationCallback(config, reqUrl, req.state)
        .then((callback) =>
          exchangeCantonAuthorizationCode(config, callback, req.verifier, req.redirectUri),
        )
        .then((token) => {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(CALLBACK_SUCCESS_HTML)
          finish(() => resolve(token))
        })
        .catch((e: unknown) => {
          try {
            res.writeHead(400, { 'Content-Type': 'text/plain' })
            res.end('Authentication failed. Check the terminal for details.')
          } catch {
            // response may already be sent
          }
          finish(() => reject(e instanceof Error ? e : new Error(String(e))))
        })
    })

    const timer = setTimeout(() => {
      finish(() =>
        reject(new Error(`Authorization code flow timed out after ${DEFAULT_FLOW_TIMEOUT_MS}ms`)),
      )
    }, DEFAULT_FLOW_TIMEOUT_MS)

    server.on('error', (err) => {
      finish(() => reject(new Error(`Callback server error: ${err.message}`)))
    })

    server.listen(callbackPort, callbackHost, () => {
      process.stderr.write(`Waiting for authentication on ${callbackUrl}\n`)
      process.stderr.write('Opening browser for login…\n')
      process.stderr.write(`If the browser does not open, visit:\n${req.authorizeUrl}\n\n`)
      void openBrowser(req.authorizeUrl)
    })
  })
}

/**
 * Resolve a JWT (or token getter) for a {@link CantonConfig} from the `.env` auth config.
 *
 * `static` auth resolves to a plain JWT string; refreshable flows (clientCredentials /
 * authorizationCode) resolve to a `() => Promise<string>` getter so the SDK clients
 * refresh per request.
 */
async function resolveCantonTokenGetter(
  auth: CantonAuthConfig,
): Promise<string | (() => Promise<string>)> {
  if (auth.type === CantonAuthType.AuthorizationCode) {
    const initialToken = await runAuthorizationCodeFlow(auth)
    const provider = createCantonAuthorizationCodeProvider(auth, initialToken, () =>
      runAuthorizationCodeFlow(auth),
    )
    const tokenGetter = async () => {
      const token = await provider.token()
      return token.accessToken
    }
    await tokenGetter()
    return tokenGetter
  }

  const provider = await createCantonAuthProvider(auth)
  if (provider instanceof CantonStaticProvider) {
    const token = await provider.token()
    return token.accessToken
  }

  const tokenGetter = async () => {
    const token = await provider.token()
    return token.accessToken
  }
  await tokenGetter()
  return tokenGetter
}

/**
 * Load canton-config.json and resolve JWT before connecting to the ledger.
 */
export async function loadCantonConfigWithAuth(configPath?: string): Promise<CantonConfig> {
  const { parsed } = readConfigFile(configPath)
  const config = parsed as unknown as CantonConfig

  const auth = resolveCantonAuthConfig(readAuthBlock(parsed))
  config.jwt = await resolveCantonTokenGetter(auth)

  if (auth.type === CantonAuthType.AuthorizationCode) {
    console.log('Canton bearer token obtained via OIDC authorization code (browser login).')
  } else if (auth.type === CantonAuthType.ClientCredentials) {
    console.log('Canton bearer token obtained via OIDC client credentials.')
  }

  return config
}

/** Extract the `auth` block from a parsed canton-config.json, if present. */
function readAuthBlock(parsed: Record<string, unknown>): CantonAuthConfig | undefined {
  const auth = parsed['auth']
  if (auth == null) return undefined
  if (typeof auth !== 'object' || Array.isArray(auth)) {
    throw new Error(
      'Canton config "auth" must be an object (static, clientCredentials, or authorizationCode)',
    )
  }
  return auth as CantonAuthConfig
}
