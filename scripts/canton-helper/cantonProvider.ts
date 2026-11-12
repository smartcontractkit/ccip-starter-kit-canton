import { AbstractProvider } from '@canton-network/core-splice-provider'
import type { RequestArgs } from '@canton-network/core-types'
import type {
  LedgerApiParams,
  LedgerApiResult,
  PrepareExecuteAndWaitResult,
  PrepareExecuteParams,
  RpcTypes,
  Wallet,
} from '@canton-network/core-wallet-dapp-rpc-client'
import { type PartyId, CCIPError, CCIPErrorCode, parsePartyId } from '@chainlink/ccip-sdk'
import type { CantonRpcProvider } from '@chainlink/ccip-sdk/dist/canton/types.js'
import axios from 'axios'

/**
 * Node-side Canton provider, ported from ccip-cli's
 * `src/providers/canton/provider.ts` (MIT, @chainlink/ccip-cli).
 *
 * Unlike the in-browser dApp provider, which proxies `ledgerApi` requests
 * through the validator wallet, this provider talks to the Canton JSON Ledger
 * API directly: `ledgerApi` requests are already in wire format, so the
 * translation layer is a thin HTTP pass-through with JWT authentication.
 *
 * Build it from the user's canton config and hand it to
 * `CantonChain.fromProvider`.
 */
export class JsonRpcProvider extends AbstractProvider<RpcTypes> implements CantonRpcProvider {
  // CAIP-2 compliant chain ID, e.g. canton:testnet
  private readonly chainId: string
  private readonly party: PartyId
  private readonly baseUrl: string
  private readonly jwt: string | (() => Promise<string>)
  /** HTTP protocol version for the axios transport. */
  private readonly httpVersion: '1' | '2'

  private constructor(
    chainId: string,
    baseUrl: string,
    jwt: string | (() => Promise<string>),
    party: PartyId,
    httpVersion: '1' | '2',
  ) {
    super()
    this.chainId = chainId
    this.baseUrl = baseUrl
    this.jwt = jwt
    this.party = party
    this.httpVersion = httpVersion
  }

  static fromUrl(
    chainId: string,
    url: string,
    jwt: string | (() => Promise<string>),
    party: string,
    httpVersion: '1' | '2' = '2',
  ): JsonRpcProvider {
    return new JsonRpcProvider(
      chainId,
      // Trim a single trailing slash so resource paths join cleanly
      url.replace(/\/$/, ''),
      jwt,
      parsePartyId(party),
      httpVersion,
    )
  }

  async request<M extends keyof RpcTypes>(
    args: RequestArgs<RpcTypes, M>,
  ): Promise<RpcTypes[M]['result']> {
    const methodName: string = args.method
    switch (args.method) {
      case 'ledgerApi':
        return await this.ledgerApi(args.params)
      case 'prepareExecuteAndWait':
        return await this.prepareExecuteAndWait(args.params)
      case 'getActiveNetwork':
        return { networkId: this.chainId } as RpcTypes[M]['result']
      case 'getPrimaryAccount':
        return await this.getPrimaryAccount()

      // Native provider methods (wallet/session management), not needed by the SDK.
      case 'listAccounts':
      case 'connect':
      case 'disconnect':
      case 'isConnected':
      case 'prepareExecute':
      case 'signMessage':
      case 'status':
      case 'accountsChanged':
      case 'txChanged':
      case 'messageSignature':
        throw new CCIPError(
          CCIPErrorCode.NOT_IMPLEMENTED,
          `Canton JsonRpcProvider does not implement '${methodName}' yet`,
        )
      default:
        throw new CCIPError(
          CCIPErrorCode.METHOD_UNSUPPORTED,
          `Unknown Canton provider method: ${methodName}`,
        )
    }
  }

  /** Translate a `ledgerApi` request into a direct Ledger API HTTP call. */
  private async ledgerApi(params: LedgerApiParams): Promise<LedgerApiResult> {
    let resource = params.resource.startsWith('/') ? params.resource : `/${params.resource}`
    // Substitute `{key}` placeholders when path params are provided
    if (params.path != undefined) {
      for (const [key, value] of Object.entries(params.path)) {
        resource = resource.replaceAll(`{${key}}`, encodeURIComponent(String(value)))
      }
    }

    const url = new URL(`${this.baseUrl}${resource}`)
    if (params.query != undefined) {
      for (const [key, value] of Object.entries(params.query)) {
        if (value === undefined || value === null) continue
        url.searchParams.set(key, String(value))
      }
    }

    return (await ledgerJsonRequest({
      method: params.requestMethod.toUpperCase(),
      url: url.toString(),
      jwt: this.jwt,
      body: params.body,
      httpVersion: this.httpVersion,
    })) as LedgerApiResult
  }

  /**
   * Submit commands and wait for execution. The participant signs with the
   * party's key via JWT-authenticated direct submission.
   */
  private async prepareExecuteAndWait(
    params: PrepareExecuteParams,
  ): Promise<PrepareExecuteAndWaitResult> {
    const commandId =
      params.commandId ?? `ccip-kit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

    const response = (await ledgerJsonRequest({
      method: 'POST',
      url: `${this.baseUrl}/v2/commands/submit-and-wait`,
      jwt: this.jwt,
      body: {
        commandId,
        commands: params.commands,
        // The dApp spec defaults actAs to the wallet's primary party
        actAs: params.actAs ?? [this.party],
        readAs: params.readAs,
        disclosedContracts: params.disclosedContracts,
        synchronizerId: params.synchronizerId,
      },
      httpVersion: this.httpVersion,
    })) as { updateId?: string; completionOffset?: number }
    if (response.updateId == undefined) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_API_ERROR,
        `Canton submit-and-wait returned no updateId for command ${commandId}`,
      )
    }
    return {
      tx: {
        status: 'executed',
        commandId,
        payload: {
          updateId: response.updateId,
          completionOffset: response.completionOffset ?? 0,
        },
      },
    }
  }

  /**
   * The provider's party as the primary account. The dApp `Wallet` shape's
   * remaining fields are wallet-UI metadata the kit doesn't need.
   */
  private async getPrimaryAccount(): Promise<Wallet> {
    return {
      primary: true,
      partyId: this.party,
      status: 'allocated',
      hint: '',
      publicKey: '',
      namespace: '',
      networkId: this.chainId,
      signingProviderId: '',
    }
  }
}

// Canton endpoints differ in HTTP protocol: the hosted validator front-ends
// require HTTP/2 (HTTP/1.1 is rejected with 464 at their load balancer), while
// Canton's JSON Ledger API is documented as HTTP/1.1 + JSON and user-hosted
// participants commonly serve HTTP/1.1 only. The protocol is selected
// explicitly via the canton config's `httpVersion` (default `2`); an
// explicitly provided `fetch` overrides both.
const http2 = axios.create({ httpVersion: 2 })
const http1 = axios.create({ httpVersion: 1 })

/** fetch-compatible adapter routing requests through axios's native HTTP transport. */
async function axiosFetch(version: '1' | '2', request: Request): Promise<Response> {
  try {
    const response = await (version === '1' ? http1 : http2).request({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers),
      data: request.body ? await request.arrayBuffer() : undefined,
      signal: request.signal,
      responseType: 'arraybuffer',
      // Never throw on non-2xx: errors are classified by response status
      validateStatus: () => true,
    })
    // axios may return AxiosHeaders or a plain object; normalize either into Headers
    const headers = new Headers()
    for (const [key, value] of Object.entries(response.headers)) {
      if (value != null)
        headers.set(key, Array.isArray(value) ? value.map(String).join(', ') : String(value))
    }
    return new Response(response.data, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch (error) {
    // Mirror fetch semantics: cancellation surfaces as an AbortError
    if (axios.isCancel(error)) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }
    throw error
  }
}

/** Default delay before retrying a transient Canton API error. */
const DEFAULT_RETRY_DELAY_MS = 1_000

/**
 * Build the error for a non-2xx Canton Ledger API response.
 *
 * Canton returns structured `JsCantonError` bodies (`{code, cause, …}`, either
 * bare or wrapped in an `error` envelope). The code is surfaced in
 * `context.cantonCode` and the message detail, so callers can match on it
 * (e.g. `CONTRACT_NOT_FOUND`); 429/5xx responses are marked transient so
 * callers retry them.
 */
function cantonApiError(method: string, url: string, statusCode: number, body: string): CCIPError {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    parsed = undefined
  }
  const record =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined
  // Unwrap the gRPC-style `{error: {…}}` envelope when present.
  const cantonError =
    typeof record?.['error'] === 'object' && record['error'] !== null
      ? (record['error'] as Record<string, unknown>)
      : record
  const code = typeof cantonError?.['code'] === 'string' ? cantonError['code'] : undefined
  const cause = typeof cantonError?.['cause'] === 'string' ? cantonError['cause'] : undefined

  const isTransient = statusCode === 429 || statusCode >= 500
  const detail = code ? `[${code}]${cause ? ` ${cause}` : ''}` : body.slice(0, 200)
  return new CCIPError(
    CCIPErrorCode.CANTON_API_ERROR,
    `Canton Ledger API ${method} ${url} failed (${statusCode}): ${detail}`,
    {
      context: {
        statusCode,
        ...(code ? { cantonCode: code } : {}),
        ...(cause ? { cantonCause: cause } : {}),
      },
      isTransient,
      retryAfterMs: isTransient ? DEFAULT_RETRY_DELAY_MS : undefined,
    },
  )
}

interface LedgerJsonRequestOptions {
  method: string
  url: string
  jwt?: string | (() => Promise<string>)
  body?: unknown
  /** HTTP protocol version for the axios transport. */
  httpVersion: '1' | '2'
}

/** Perform a JSON request against the Canton Ledger API, returning the parsed response body. */
async function ledgerJsonRequest({
  method,
  url,
  jwt,
  body,
  httpVersion,
}: LedgerJsonRequestOptions): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = typeof jwt === 'function' ? await jwt() : jwt
  if (token) headers.Authorization = `Bearer ${token}`
  const hasBody = body !== undefined && method !== 'GET' && method !== 'HEAD'
  if (hasBody) headers['Content-Type'] = 'application/json'

  const request = new Request(url, {
    method,
    headers,
    body: hasBody ? JSON.stringify(body) : undefined,
  })

  let response: Response
  try {
    response = await axiosFetch(httpVersion, request)
  } catch (error) {
    // Network-level failures (unreachable, reset) are worth retrying.
    throw new CCIPError(
      CCIPErrorCode.CANTON_API_ERROR,
      `Canton Ledger API ${method} ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error instanceof Error ? error : undefined, isTransient: true },
    )
  }

  const text = await response.text()
  if (!response.ok) {
    throw cantonApiError(method, url, response.status, text)
  }
  if (text === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new CCIPError(
      CCIPErrorCode.CANTON_API_ERROR,
      `Canton Ledger API ${method} ${url} returned invalid JSON: ${text.slice(0, 200)}`,
    )
  }
}
