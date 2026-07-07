import 'dotenv/config'

import { Contract, Interface, Wallet } from 'ethers'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { remoteChain, remoteChainName } from '../../../helperConfig'
import { getEvmProvider, sepoliaExplorerTx } from '../../utils/chains'

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function drip(address to) external',
]

const argv = yargs(hideBin(process.argv))
  .option('token', {
    type: 'string',
    description: `${remoteChainName} TEST token address (BurnMintERC20WithDrip)`,
    default: remoteChain.ccipTestTokenAddress,
  })
  .parseSync()

async function main() {
  const privateKey = process.env[remoteChain.privateKeyEnv]?.trim()
  if (!privateKey) {
    throw new Error(`Set ${remoteChain.privateKeyEnv} in .env`)
  }

  const provider = await getEvmProvider()
  const wallet = new Wallet(privateKey, provider)
  const tokenAddress = argv.token
  const contract = new Contract(tokenAddress, ERC20_ABI, wallet)

  console.log(`\nCalling drip(${wallet.address}) on ${tokenAddress}...`)

  try {
    const [name, symbol] = await Promise.all([contract.name(), contract.symbol()])
    const tx = await contract.drip(wallet.address)
    console.log(`✅ Transaction sent: ${tx.hash}`)
    console.log('   Waiting for confirmation...')
    await tx.wait(1)
    console.log(`🌎 View on explorer: ${sepoliaExplorerTx(tx.hash)}`)
    console.log(`💰 1 ${symbol} (${name}) dripped to ${wallet.address}`)
  } catch (error) {
    console.error('\n❌ Drip failed:', error)
    if (error instanceof Error && 'data' in error) {
      try {
        const iface = new Interface(ERC20_ABI)
        console.error('   Revert data:', iface.parseError((error as { data: string }).data))
      } catch {
        // ignore parse errors
      }
    }
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
