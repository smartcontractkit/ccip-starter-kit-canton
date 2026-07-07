# Chainlink CCIP Canton Starter Kit

> **NOTE:** This starter kit represents an educational example to use a Chainlink system, product, or service and is provided to demonstrate how to interact with Chainlink’s systems, products, and services to integrate them into your own. This template is provided “AS IS” and “AS AVAILABLE” without warranties of any kind, it has not been audited, and it may be missing key checks or error handling to make the usage of the system, product or service more clear. Do not use the code in this example in a production environment without completing your own audits and application of best practices. Neither Chainlink Labs, the Chainlink Foundation, nor Chainlink node operators are responsible for unintended outputs that are generated due to errors in code.

TypeScript scripts for **data**, **token**, and **data + token** CCIP transfers between **Canton testnet** and **Ethereum Sepolia**, built on [`@chainlink/ccip-sdk`](https://www.npmjs.com/package/@chainlink/ccip-sdk) v1.10+.

## Prerequisites

1. [Node.js](https://nodejs.org/) 20+
2. A Sepolia EVM account funded with test ETH (Sepolia LINK only if you pass `--feeToken link` on EVM → Canton sends)
3. A Canton testnet party with:
   - **Amulet** (default) or **LINK** for Canton → Sepolia CCIP fees
   - **LINK** (`link-token`) for Canton → Sepolia token transfer demos
4. Canton participant Ledger API access with a validator user (`can_act_as` for your party)

Canton sends and executes use **OIDC bearer-token authentication** and direct ledger submit (same as `ccip-cli` without `--wallet`). No local signing key is required for participant-hosted parties.

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

| Variable                   | Example placeholder                        | What to set                                                           |
| -------------------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| `EVM_PRIVATE_KEY`          | `0xabc123...`                              | Sepolia signer private key (hex, with or without `0x`)                |
| `ETHEREUM_SEPOLIA_RPC_URL` | `https://eth-sepolia.example.com`          | Your Sepolia JSON-RPC URL                                             |
| `CANTON_LEDGER_URL`        | `https://participant.example.com/json-api` | Canton participant **JSON Ledger API** URL (not EDS or the validator) |
| `CANTON_CONFIG_PATH`       | `./config/canton-config.json`              | Path to your Canton config (default is fine)                          |
| `CANTON_AUTH_URL`          | `https://auth.example.com`                 | OIDC authorization server URL (from your validator setup)             |
| `CANTON_CLIENT_ID`         | `my-client-id`                             | OIDC client ID for your validator user                                |
| `CANTON_CLIENT_SECRET`     | _(empty)_                                  | OIDC client secret — scripts fetch a fresh bearer token on each run   |

Optional:

- `CANTON_JWT` — use a pre-fetched bearer token instead of client credentials
- `CCIP_DEBUG=1` — enable CCIP SDK debug logs

Omit `CANTON_CLIENT_SECRET` only for interactive browser login flows (not typical for this starter kit).

Never commit `.env`, `config/canton-config.json`, OIDC secrets, or private keys to version control. Only `config/canton-config.example.json` and `.env.example` belong in git — both use placeholders.

### Canton configuration (`canton-config.json`)

Copy `config/canton-config.example.json` to `config/canton-config.json`. **Replace the two placeholder fields**; the rest are pre-configured for the Canton CCIP testnet lane:

| Field                                                                                  | Placeholder?                                        | What to set                                                                                                                                     |
| -------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `party`                                                                                | Yes — `myParty::1220...`                            | Your ledger party ID (must match your validator user). Used as Canton sender and default `any2canton` receiver.                                 |
| `transferInstructionUrl`                                                               | Yes — `https://validator.example.com/api/validator` | Your validator's **transfer-instruction API** (Amulet fee transfers and token metadata). Depends on which validator hosts your party — not EDS. |
| `edsUrl`, `indexerUrl`, `ccipParty`, `ccvs`, `senderInstanceId`, `packages`, `chainId` | No — real testnet values                            | Shared CCIP deployment constants; leave as in the example unless you target a different environment.                                            |

Chainlink provides shared CCIP endpoints (`edsUrl`, `indexerUrl`, `ccipParty`, `ccvs`, etc.) pre-filled in the example config. You supply your own `CANTON_LEDGER_URL`, validator user credentials, and `transferInstructionUrl`.

Bearer token resolution is from `.env` (see below), not from this file.

### Canton authentication

Canton uses standard [OpenID Connect (OIDC)](https://openid.net/connect/). Any compatible identity provider works (Okta, Keycloak, Microsoft Azure, Auth0, and others); local or development nodes may use a local user without an external IdP. See the [Canton validator documentation](https://docs.canton.network/) for setup.

Scripts obtain a bearer token automatically via **OIDC client credentials** (`CANTON_CLIENT_ID` + `CANTON_CLIENT_SECRET` in `.env`). Resolution order:

1. `CANTON_JWT` in `.env` (explicit override)
2. Client credentials → fresh token from your OIDC provider (`CANTON_AUTH_URL`)

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
npm run any2canton:data -- --dataString "Hello Canton" --finality 32

# TEST token (1 TEST mints LINK on Canton after manual exec)
npm run any2canton:token -- --amount 1

# Pay fee in LINK instead of native ETH
npm run any2canton:data -- --dataString "Hello Canton" --feeToken link

# Data + token
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
- `--finality` — `any2canton` scripts only: requested source finality (`finalized` or block depth; default `finalized`). Matches ccip-cli `-x finality=…`.
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
│   ├── canton-helper/        # Config loader and JWT refresh
│   ├── faucets/              # Sepolia TEST drip
│   ├── utils/                # Chain loaders, balances, data payload encoding
│   ├── canton2any/           # Canton source scripts
│   └── any2canton/           # Remote chain source scripts + Canton manual exec
```

## Related docs

- [CCIP SDK documentation](https://docs.chain.link/ccip/tools/sdk/)
- [`ccip-tools-ts`](https://github.com/smartcontractkit/ccip-tools-ts) — underlying CLI and SDK

## Troubleshooting

| Issue                        | Fix                                                                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PermissionDenied` on Canton | Verify `party` matches your validator user; confirm OIDC credentials (`CANTON_AUTH_URL`, `CANTON_CLIENT_ID`, `CANTON_CLIENT_SECRET`) are set and the user has `can_act_as` for that party                          |
| `no fee-token holdings`      | Fund your Canton party with Amulet (default) or LINK (`--feeToken link`) for Canton → Sepolia sends                                                                                                                |
| `no token pool registered`   | Verify LINK holdings and token lane registration                                                                                                                                                                   |
| Manual exec fails early      | Wait until Committee Verifier proofs are on the [CCIP Explorer](https://ccip.chain.link); for EVM → Canton with default `--finality finalized`, wait until Sepolia finalizes — the SDK error includes a retry hint |
