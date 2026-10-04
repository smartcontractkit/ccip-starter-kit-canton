# Chainlink CCIP Canton Starter Kit

> **NOTE:** This starter kit represents an educational example to use a Chainlink system, product, or service and is provided to demonstrate how to interact with Chainlink’s systems, products, and services to integrate them into your own. This template is provided “AS IS” and “AS AVAILABLE” without warranties of any kind, it has not been audited, and it may be missing key checks or error handling to make the usage of the system, product or service more clear. Do not use the code in this example in a production environment without completing your own audits and application of best practices. Neither Chainlink Labs, the Chainlink Foundation, nor Chainlink node operators are responsible for unintended outputs that are generated due to errors in code.

TypeScript scripts for **data**, **token**, and **data + token** CCIP transfers between **Canton testnet** and **Ethereum Sepolia**, built on [`@chainlink/ccip-sdk`](https://www.npmjs.com/package/@chainlink/ccip-sdk) v1.15+.

## Prerequisites

1. [Node.js](https://nodejs.org/) 22+ (required by `@chainlink/ccip-sdk` transitive dependencies)
2. A Sepolia EVM account funded with test ETH (Sepolia LINK only if you pass `--feeToken link` on EVM → Canton sends)
3. A Canton testnet party with:
   - **Amulet** (default) or **LINK** for Canton → Sepolia CCIP fees
   - **LINK** (`link-token`) for Canton → Sepolia token transfer demos
4. Canton participant Ledger API access with a validator user (`can_act_as` for your party)

Canton sends and executes use **OIDC bearer-token authentication** and direct ledger submit (same as `ccip-cli` without `--wallet`). No local signing key is required for participant-hosted parties. Hardware-wallet signing (Ledger-onboarded external parties) is out of scope here — use [`ccip-cli`](https://github.com/smartcontractkit/ccip-tools-ts) with `--wallet ledger[:<derivation-path>]` for that.

## Setup

```bash
cd ccip-starter-kit-canton
cp .env.example .env
cp config/canton-config.example.json config/canton-config.json
npm install
```

Both example files use **placeholders** for values that depend on your accounts, participant, or validator. Replace those before running scripts.

### Environment variables (`.env`)

Copy `.env.example` to `.env` and replace every placeholder:

| Variable                   | Example placeholder                        | What to set                                                                              |
| -------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `EVM_PRIVATE_KEY`          | `0xabc123...`                              | Sepolia signer private key (hex, with or without `0x`)                                   |
| `ETHEREUM_SEPOLIA_RPC_URL` | `https://eth-sepolia.example.com`          | Your Sepolia JSON-RPC URL                                                                |
| `CANTON_LEDGER_URL`        | `https://participant.example.com/json-api` | Canton participant **JSON Ledger API** URL (not EDS or the validator)                    |
| `CANTON_CONFIG_PATH`       | `./config/canton-config.json`              | Path to your Canton config (default is fine)                                             |
| `CANTON_AUTH_URL`          | `https://auth.example.com`                 | OIDC authorization server URL — fallback only, when no `auth` block is set in the config |
| `CANTON_CLIENT_ID`         | `my-client-id`                             | OIDC client ID for your validator user                                                   |
| `CANTON_CLIENT_SECRET`     | _(empty)_                                  | OIDC client secret — set for the client-credentials flow, omit for browser login         |

Optional:

- `CANTON_JWT` — use a pre-fetched bearer token instead of an OIDC flow
- `CCIP_DEBUG=1` — enable CCIP SDK debug logs

Never commit `.env`, `config/canton-config.json`, OIDC secrets, or private keys to version control. Only `config/canton-config.example.json` and `.env.example` belong in git — both use placeholders.

### Canton configuration (`canton-config.json`)

Copy `config/canton-config.example.json` to `config/canton-config.json`. **Replace the three placeholder fields**; the rest are pre-configured for the Canton CCIP testnet lane:

| Field                                                              | Placeholder?                                        | What to set                                                                                                                                     |
| ------------------------------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `party`                                                            | Yes — `myParty::1220...`                            | Your ledger party ID (must match your validator user). Used as Canton sender and default `any2canton` receiver.                                 |
| `transferInstructionUrl`                                           | Yes — `https://validator.example.com/api/validator` | Your validator's **transfer-instruction API** (Amulet fee transfers and token metadata). Depends on which validator hosts your party — not EDS. |
| `auth.authUrl`                                                     | Yes — `https://auth.example.com`                    | OIDC authorization server URL (from your validator setup). Credentials come from `.env`.                                                        |
| `edsUrl`, `indexerUrl`, `ccipParty`, `ccvs`, `packages`, `chainId` | No — real testnet values                            | Shared CCIP deployment constants; leave as in the example unless you target a different environment.                                            |

Chainlink provides shared CCIP endpoints (`edsUrl`, `indexerUrl`, `ccipParty`, `ccvs`, etc.) pre-filled in the example config. You supply your own `CANTON_LEDGER_URL`, validator user credentials, and `transferInstructionUrl`.

The `auth` block in this file selects the auth scheme and carries the non-secret OIDC parameters; credentials (`CANTON_CLIENT_ID` / `CANTON_CLIENT_SECRET`) are resolved from `.env` (see below). When no `auth` block is present, auth falls back to `.env` variables alone.

### Canton authentication

Canton uses standard [OpenID Connect (OIDC)](https://openid.net/connect/). Any compatible identity provider works (Okta, Keycloak, Microsoft Azure, Auth0, and others); local or development nodes may use a local user without an external IdP. See the [Canton validator documentation](https://docs.canton.network/) for setup.

Authentication is handled by the [`@chainlink/ccip-sdk`](https://www.npmjs.com/package/@chainlink/ccip-sdk) OAuth 2.0 providers, configured via the `auth` block in `canton-config.json` (same as `ccip-cli`). The `type` field selects the scheme; `CANTON_CLIENT_ID` / `CANTON_CLIENT_SECRET` in `.env` fill in any credentials the block omits:

| Auth type           | Config `auth` block                               | `.env` credentials                          | Flow                                                                                     |
| ------------------- | ------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `authorizationCode` | `{ "type": "authorizationCode", "authUrl": "…" }` | `CANTON_CLIENT_ID`                          | Interactive browser login (authorization code + PKCE) — **default for this starter kit** |
| `clientCredentials` | `{ "type": "clientCredentials", "authUrl": "…" }` | `CANTON_CLIENT_ID` + `CANTON_CLIENT_SECRET` | Machine-to-machine token grant (CI/CD, no browser)                                       |
| `static`            | _(none — set `jwt` in the block or `CANTON_JWT`)_ | `CANTON_JWT`                                | Pre-fetched bearer token (no refresh)                                                    |

Without an `auth` block, the scheme is picked from `.env` alone: `CANTON_JWT` → `static`; `CANTON_AUTH_URL` + `CANTON_CLIENT_ID` + `CANTON_CLIENT_SECRET` → `clientCredentials`; `CANTON_AUTH_URL` + `CANTON_CLIENT_ID` → `authorizationCode`.

#### `authorizationCode` (browser login)

With the default `auth` block (`authorizationCode`) and `CANTON_CLIENT_ID` set (and no `CANTON_CLIENT_SECRET`), the first ledger-connected script run:

1. Starts a local callback server on `http://localhost:8400/callback`
2. Opens your default browser at the OIDC provider's login page
3. Waits for you to log in and approve access (2-minute timeout)
4. Exchanges the authorization code (with PKCE) for a bearer token
5. Prints `Canton bearer token obtained via OIDC authorization code (browser login).` and proceeds

The token is refreshed automatically per request for the life of the script run; when it expires, the SDK refreshes it via the `refresh_token` grant (or re-runs the browser flow if refresh is unavailable).

The callback server listens on `http://localhost:8400/callback` by default. Override it with `callbackUrl` in the `auth` block (e.g. when port 8400 is occupied) — the value must be a redirect URI registered on your OIDC client:

```json
"auth": {
  "type": "authorizationCode",
  "authUrl": "https://auth.example.com",
  "callbackUrl": "http://localhost:8401/callback"
}
```

```bash
npm run check-balance -- --chain canton --token link
# → Waiting for authentication on http://localhost:8400/callback
# → Opening browser for login…
# → If the browser does not open, visit: https://auth.example.com/...
# → Canton bearer token obtained via OIDC authorization code (browser login).
```

#### `clientCredentials` (machine-to-machine)

Set `"type": "clientCredentials"` in the `auth` block and `CANTON_CLIENT_ID` + `CANTON_CLIENT_SECRET` in `.env` for a non-interactive token grant — useful in CI or when your IdP client is confidential. The SDK fetches and caches the token, refreshing it per request as needed.

#### `static` (pre-fetched token)

Set `CANTON_JWT` to skip OIDC entirely and use a token you obtained out of band (e.g. from your validator's token endpoint). No refresh — re-run with a fresh token when it expires.

The participant submits commands on behalf of `party` via `submit-and-wait-for-transaction` — matching:

```bash
ccip-cli send --rpc <ledger-url> --canton-config canton-config.json ...
```

## Scripts

### Canton → Sepolia (source on Canton)

| Script                              | Description                 |
| ----------------------------------- | --------------------------- |
| `npm run canton2any:data`           | Data-only transfer          |
| `npm run canton2any:token`          | LINK token transfer         |
| `npm run canton2any:data-and-token` | Data + LINK token           |
| `npm run canton2any:manual-exec`    | Manually execute on Sepolia |

Canton → Sepolia sends pay CCIP fees in **Amulet** by default. Pass `--feeToken link` to pay in CCIP LINK instead.

**Examples:**

```bash
# Data transfer
npm run canton2any:data -- --dataString "Hello Sepolia"

# Pay fee in LINK instead of Amulet
npm run canton2any:data -- --dataString "Hello Sepolia" --feeToken link

# LINK token (0.001 LINK)
npm run canton2any:token -- --amount 0.001

# Data + token
npm run canton2any:data-and-token -- --dataString "Hello" --amount 0.001

# Skip auto-execution on Sepolia — run canton2any:manual-exec after Committee Verifier proofs are on the indexer
npm run canton2any:data -- --dataString "Hello Sepolia" --no-exec

# Manual execute on Sepolia (Canton update ID from send output)
npm run canton2any:manual-exec -- <cantonUpdateId>

# ...or by CCIP message ID (the 0x… ID from the send output / CCIP Explorer)
npm run canton2any:manual-exec -- 0x<messageId>
```

### Sepolia → Canton (source on EVM)

Sepolia send scripts only need your EVM key and RPC. They use `canton-config.json` **for the default `--cantonReceiver` party** (or pass `--cantonReceiver` explicitly). Full config + ledger auth is required for `any2canton:manual-exec`.

| Script                              | Description                 |
| ----------------------------------- | --------------------------- |
| `npm run any2canton:data`           | Data-only transfer          |
| `npm run any2canton:token`          | TEST token → LINK on Canton |
| `npm run any2canton:data-and-token` | Data + TEST token           |
| `npm run any2canton:manual-exec`    | Manually execute on Canton  |

**Examples:**

```bash
# Data transfer (default fee: native Sepolia ETH)
npm run any2canton:data -- --dataString "Hello Canton"

# Faster than default source-chain finality: block depth (e.g. 32 block confirmations)
# NOTE: --finality applies to data-only transfers. The TEST ↔ LINK token pool
# only supports default finality, so do NOT pass --finality to token / data-and-token sends.
npm run any2canton:data -- --dataString "Hello Canton" --finality 32

# TEST token (1 TEST mints LINK on Canton after manual exec)
# Do NOT pass --finality here — the LINK token pool only supports default finality.
npm run any2canton:token -- --amount 1

# Pay fee in LINK instead of native ETH
npm run any2canton:data -- --dataString "Hello Canton" --feeToken link

# Data + token
# Do NOT pass --finality here — the LINK token pool only supports default finality.
npm run any2canton:data-and-token -- --dataString "Hello" --amount 1

# Manual execute on Canton (Sepolia tx hash from send output)
npm run any2canton:manual-exec -- 0x<sepoliaTxHash>

# ...or by CCIP message ID (the 0x… ID from the send output / CCIP Explorer)
npm run any2canton:manual-exec -- 0x<messageId>
```

### Balance checks

| Script                  | Description                                                |
| ----------------------- | ---------------------------------------------------------- |
| `npm run check-balance` | Show LINK/Amulet (Canton) and LINK/TEST (Sepolia) balances |

**Examples:**

```bash
# All balances for configured party + Sepolia wallet
npm run check-balance

# Single token
npm run check-balance -- --chain canton --token link
npm run check-balance -- --chain sepolia --token test

# Override account
npm run check-balance -- --chain canton --token amulet --party 'yourParty::1220…'
npm run check-balance -- --chain evm --token link --address 0x...

# List individual Canton holding UTXOs (verbose)
npm run check-balance -- --chain canton --token link --show-holdings
```

### Faucets (fund before sending)

| Script                    | Description                                           |
| ------------------------- | ----------------------------------------------------- |
| `npm run faucet:evm-test` | Drip Sepolia TEST (`drip()` on BurnMintERC20WithDrip) |

**Example:**

```bash
# Sepolia TEST token (for EVM → Canton token sends)
npm run faucet:evm-test
```

For Canton → Sepolia sends, fund your party with **Amulet** for CCIP fees. **LINK** on Canton is only needed for token transfer demos (`canton2any:token`). EVM → Canton TEST transfers mint LINK on Canton only after you run `any2canton:manual-exec` once the message is finalized.

> **Manual-exec input:** both `*:manual-exec` scripts accept either the **source transaction ID** (Sepolia tx hash / Canton update ID) or the **CCIP message ID** as the first argument. A tx hash and a message ID are both `0x` + 64 hex, so the script tries both lookups and uses whichever resolves — no flag needed. The message-ID path resolves the offRamp and verifications from the CCIP API, so it works from only the destination chain's RPC/config; if the message isn't indexed yet, fall back to the source transaction ID.

Optional flags:

- `--evmReceiver` / `--cantonReceiver` — override default receiver
- `--gasLimit` — ccipReceive gas limit (default `200000`)
- `--no-exec` — `canton2any` scripts only: skip automatic execution on Sepolia (negates default auto-exec; run `canton2any:manual-exec` after proofs are on the indexer)
- `--finality` — `any2canton` **data-only** sends: requested source finality (`finalized` or block depth; default `finalized`). Matches ccip-cli `-x finality=…`. **Not supported for token or data-and-token sends** on the TEST ↔ LINK token pool, which only supports default finality; passing `--finality` to those scripts is ignored/rejected by the pool.
- `--feeToken link|native` — CCIP fee token on the source chain (default `native`: Amulet on Canton, ETH on Sepolia)

## Network configuration

Lane defaults live in [`helperConfig.ts`](helperConfig.ts) (selectors, router, token addresses, explorers, default `--gasLimit` of `200000`). Shared Canton CCIP deployment fields (`edsUrl`, `indexerUrl`, `ccipParty`, `ccvs`, etc.) are pre-filled in [`config/canton-config.example.json`](config/canton-config.example.json); you only customize `party` and `transferInstructionUrl` there.

- **Canton testnet** selector: `9268731218649498074`
- **Sepolia** selector: `16015286601757825753`
- **Token lane:** Canton LINK ↔ Sepolia TEST (`0xeEe6675b…`)

These match the Canton CCIP prod testnet deployment. Update `helperConfig.ts` if addresses change.

## Project layout

```
ccip-starter-kit-canton/
├── helperConfig.ts           # Chain selectors, router, token addresses
├── config/
│   └── canton-config.example.json
├── scripts/
│   ├── canton-helper/        # Config loader and OIDC auth (SDK providers)
│   ├── faucets/              # Sepolia TEST drip
│   ├── utils/                # Chain loaders, balances, data payload encoding
│   ├── canton2any/           # Canton source scripts
│   └── any2canton/           # Remote chain source scripts + Canton manual exec
```

## Related docs

- [CCIP SDK documentation](https://docs.chain.link/ccip/tools/sdk/)
- [`ccip-tools-ts`](https://github.com/smartcontractkit/ccip-tools-ts) — underlying CLI and SDK

## Troubleshooting

| Issue                        | Fix                                                                                                                                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PermissionDenied` on Canton | Verify `party` matches your validator user; confirm OIDC settings (`CANTON_AUTH_URL`, `CANTON_CLIENT_ID`, and `CANTON_CLIENT_SECRET` for the client-credentials flow) are set and the user has `can_act_as` for that party |
| `no fee-token holdings`      | Fund your Canton party with Amulet (default) or LINK (`--feeToken link`) for Canton → Sepolia sends                                                                                                                        |
| `no token pool registered`   | Verify LINK holdings and token lane registration                                                                                                                                                                           |
| Manual exec fails early      | Wait until Committee Verifier proofs are on the [CCIP Explorer](https://ccip.chain.link); for EVM → Canton with default `--finality finalized`, wait until Sepolia finalizes — the SDK error includes a retry hint         |

Disclaimer: Please note, this repo contains community examples only — these are not Chainlink products or services and are not supported or maintained by Chainlink. This code represents an example of using a Chainlink product or service, and is intended for demonstration and educational purposes only. It is provided “AS IS” and “AS AVAILABLE” without warranties of any kind, may not have been audited, and may omit checks or error handling. Each party intending to use this example code does so entirely at their own risk and must perform its own audits, security and code review, key management, and testing before any production deployment and ensure the operation and performance of such code matches expectations. Neither Chainlink Labs nor the Chainlink Foundation deploys, operates, monitors, maintains or endorses any deployment of this code. Note that this is not a Chainlink product, feature or service, and there are no commitments made with respect to the code, including compatibility with future Chainlink releases. You should not rely on this code without first conducting your own technical, engineering, and security review. This code is also outside the scope of any Chainlink bug bounty programs. Neither Chainlink Labs, the Chainlink Foundation, nor Chainlink node operators are responsible for outcomes due to errors in this example or how it is deployed or operated, or liable for any resulting claims or damages. Use of the Chainlink Network is subject to the Chainlink Foundation [Terms of Service](https://chain.link/terms), which provides important information and disclosures. By using this code, you acknowledge and agree to these terms.
