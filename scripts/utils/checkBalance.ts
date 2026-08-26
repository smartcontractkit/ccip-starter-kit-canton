import 'dotenv/config'

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import {
  BALANCE_CHAINS,
  BALANCE_TOKENS,
  getAllBalances,
  getBalance,
  printBalanceReport,
} from './balanceChecker'
import { remoteChainName } from '../../helperConfig'

const argv = yargs(hideBin(process.argv))
  .option('chain', {
    type: 'string',
    choices: BALANCE_CHAINS,
    description: 'canton, sepolia, or evm (alias for sepolia)',
  })
  .option('token', {
    type: 'string',
    choices: BALANCE_TOKENS,
    description: `amulet (Canton only), link or test (${remoteChainName} only)`,
  })
  .option('party', {
    type: 'string',
    description: 'Canton party ID (defaults to canton-config.json party)',
  })
  .option('address', {
    type: 'string',
    description: `${remoteChainName} address (defaults to EVM_PRIVATE_KEY wallet)`,
  })
  .option('show-holdings', {
    type: 'boolean',
    default: false,
    description: 'List individual Canton holding UTXOs (verbose)',
  })
  .check((args) => {
    if (args.chain && !args.token) {
      throw new Error('Pass --token when using --chain, or omit both to show all balances.')
    }
    if (args.token && !args.chain) {
      throw new Error('Pass --chain when using --token, or omit both to show all balances.')
    }
    return true
  })
  .help()
  .parseSync()

async function main() {
  const printOpts = { showHoldings: argv['show-holdings'] }

  if (argv.chain && argv.token) {
    const report = await getBalance(
      argv.chain,
      argv.token,
      argv.chain === 'canton' ? argv.party : argv.address,
    )
    printBalanceReport(report, printOpts)
    return
  }

  console.log(`Checking configured Canton party and ${remoteChainName} wallet balances...`)
  const reports = await getAllBalances({
    party: argv.party,
    account: argv.address,
  })
  for (const report of reports) {
    printBalanceReport(report, printOpts)
  }
}

main().catch((err) => {
  console.error('\n❌ Balance check failed:', err)
  process.exitCode = 1
})
