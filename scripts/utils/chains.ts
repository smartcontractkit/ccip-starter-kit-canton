import 'dotenv/config'

import {
  type CCIPRequest,
  type CantonConfig,
  type Logger,
  CantonChain,
  EVMChain,
} from '@chainlink/ccip-sdk'
import { JsonRpcProvider, Wallet } from 'ethers'

import { networkConfig, remoteChain } from '../../helperConfig'
import { loadCantonConfigWithAuth, loadCantonWallet } from '../canton-helper/cantonConfig'

const silentSdkLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
}

/** SDK logger — silent by default; set CCIP_DEBUG=1 for RPC/fetch debug output. */
function getSdkLogger(): Logger {
  return process.env.CCIP_DEBUG?.trim() === '1' ? console : silentSdkLogger
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Environment variable ${name} is required. See .env.example.`)
  }
  return value
}

export async function getSepoliaChain() {
  const rpcUrl = requireEnv(remoteChain.rpcUrlEnv)
  return EVMChain.fromUrl(rpcUrl, { logger: getSdkLogger() })
}

export async function getEvmWallet(): Promise<Wallet> {
  const rpcUrl = requireEnv(remoteChain.rpcUrlEnv)
  const privateKey = requireEnv(remoteChain.privateKeyEnv)
  return new Wallet(privateKey, new JsonRpcProvider(rpcUrl))
}

export async function getEvmProvider(): Promise<JsonRpcProvider> {
  return new JsonRpcProvider(requireEnv(remoteChain.rpcUrlEnv))
}

export async function getCantonChain(cantonConfig?: CantonConfig) {
  const config = cantonConfig ?? (await loadCantonConfigWithAuth())
  const ledgerUrl = requireEnv(networkConfig.canton.ledgerUrlEnv)
  return CantonChain.fromUrl(ledgerUrl, { cantonConfig: config, logger: getSdkLogger() })
}

export async function getCantonWallet(cantonConfig?: CantonConfig) {
  const config = cantonConfig ?? (await loadCantonConfigWithAuth())
  return loadCantonWallet(config)
}

/** Load JWT once, then build Canton chain + wallet for source sends. */
export async function getCantonSendContext(cantonConfig?: CantonConfig) {
  const config = cantonConfig ?? (await loadCantonConfigWithAuth())
  return {
    cantonConfig: config,
    canton: await getCantonChain(config),
    wallet: await getCantonWallet(config),
  }
}

export function printCcipRequest(
  request: CCIPRequest,
  sourceExplorer?: string,
  sourceExplorerPath: 'tx' | 'transactions' = 'tx',
) {
  const { message, tx } = request
  console.log('🆔 CCIP Message ID:', message.messageId)
  console.log(`🔗 CCIP Explorer: https://ccip.chain.link/msg/${message.messageId}`)

  if (sourceExplorer && tx.hash) {
    console.log(`✅ Source transaction: ${sourceExplorer}/${sourceExplorerPath}/${tx.hash}`)
  } else if (tx.hash) {
    console.log(`✅ Source transaction / update ID: ${tx.hash}`)
  }
}

export function sepoliaExplorerTx(hash: string): string {
  return `${remoteChain.explorerUrl}/tx/${hash}`
}

export function cantonExplorerTx(updateId: string): string {
  return `${networkConfig.canton.explorerUrl}/transactions/${updateId}`
}
