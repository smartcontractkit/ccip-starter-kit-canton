import { networkInfo } from '@chainlink/ccip-sdk'

/**
 * CCIP network configuration for Canton testnet ↔ Ethereum Sepolia (prod testnet lane).
 *
 * Addresses match the Canton CCIP prod testnet deployment documented in
 * chainlink-canton/scripts/prod_testnet/.
 *
 * Canton deployment fields (CCV, senderInstanceId, chainId, etc.) live in
 * `config/canton-config.json` — see `config/canton-config.example.json`.
 */
export const networkConfig = {
  canton: {
    chainSelector: '9268731218649498074',
    /** Default EVM receiver for Canton → remote-chain message demos. */
    defaultEvmReceiver: '0xf19DEcEDE7A40a190e6F3457D1d8cAecaD275C54',
    /** Amulet instrument (DSO admin) — CCIP fee token for Canton → EVM sends. */
    amuletTokenInstrument:
      'DSO::1220f22a8b8f2d813c25b9a684dc4dd52b532a0174d8e73a13cdf2baabfff7518337::Amulet',
    /** Default gas limit for ccipReceive on the EVM destination. */
    defaultGasLimit: 200_000,
    /** 5N Lighthouse explorer for Canton testnet. */
    explorerUrl: 'https://lighthouse.testnet.cantonloop.com',
    ledgerUrlEnv: 'CANTON_LEDGER_URL',
    configPathEnv: 'CANTON_CONFIG_PATH',
    feeTokenNameNative: 'native',
  },
  /**
   * Non-Canton ("remote") chains this kit can bridge with. Canton is the fixed hub; every
   * entry here is a counterpart chain. There is one today (Sepolia); add more with the same
   * shape and select between them via {@link remoteChain} (a `--chain` selector can build on
   * this later).
   */
  remotes: {
    sepolia: {
      chainSelector: '16015286601757825753',
      ccipRouterAddress: '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59',
      /** Sepolia TEST token (BurnMintERC20WithDrip) — EVM → Canton token lane. */
      ccipTestTokenAddress: '0xeEe6675b20fE5950eb51361b93021D076289F612',
      linkTokenAddress: '0x779877A7B0D9E8603169DdbD7836e478b4624789',
      explorerUrl: 'https://sepolia.etherscan.io',
      rpcUrlEnv: 'ETHEREUM_SEPOLIA_RPC_URL',
      privateKeyEnv: 'EVM_PRIVATE_KEY',
      feeTokenNameLink: 'link',
      feeTokenNameNative: 'native',
      /** Default requested finality for EVM → Canton (standard wait-for-finality). */
      defaultFinality: 'finalized',
    },
  },
} as const

/** Names of the configured non-Canton (remote) chains. */
export const remoteChainNames = Object.keys(
  networkConfig.remotes,
) as (keyof typeof networkConfig.remotes)[]

/**
 * The active remote (non-Canton) chain config. A single remote is configured today, so this
 * resolves to it directly; scripts read `remoteChain` instead of a hardcoded chain key, so a
 * future `--chain <name>` selector only needs to change this one resolution.
 */
export const remoteChain = networkConfig.remotes.sepolia

/**
 * Display name of the active remote chain, derived from its CCIP selector
 * (e.g. `ethereum-testnet-sepolia`). Use this in user-facing text instead of hardcoding
 * "Sepolia", so the kit reads correctly if pointed at a different chain.
 */
export const remoteChainName: string = networkInfo(BigInt(remoteChain.chainSelector)).name

export type FeeTokenChoice =
  | typeof remoteChain.feeTokenNameLink
  | typeof remoteChain.feeTokenNameNative
