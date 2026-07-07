import 'dotenv/config'

import { Contract, parseUnits } from 'ethers'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { networkConfig, remoteChain, remoteChainName } from '../../helperConfig'
import { resolveDefaultCantonReceiver } from '../canton-helper/cantonConfig'
import { getEvmProvider, getEvmWallet, getSepoliaChain, printCcipRequest } from '../utils/chains'
import { buildEvmToCantonExtraArgs, resolveEvmFeeToken } from '../utils/evmSend'
import { finalityYargsOption, parseFinalityArg } from '../utils/finality'
import { printAny2CantonManualExecHint } from '../utils/manualExec'
import { encodeMessageData } from '../utils/messageData'

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]

const argv = yargs(hideBin(process.argv))
  .option('feeToken', {
    type: 'string',
    choices: [remoteChain.feeTokenNameLink, remoteChain.feeTokenNameNative] as const,
    default: remoteChain.feeTokenNameNative,
    description: `Fee token on ${remoteChainName} (link or native ETH; default: native)`,
  })
  .option('dataString', {
    type: 'string',
    description: 'Data payload to send alongside the token transfer',
    demandOption: true,
  })
  .option('amount', {
    type: 'string',
    description: 'Amount of TEST token to send (human-readable, e.g. 1)',
    demandOption: true,
  })
  .option('cantonReceiver', {
    type: 'string',
    description: 'Canton party that receives minted LINK (defaults to canton-config party)',
  })
  .option('gasLimit', {
    type: 'number',
    description: 'Gas limit for ccipReceive on Canton',
    default: networkConfig.canton.defaultGasLimit,
  })
  .option('finality', {
    ...finalityYargsOption,
    default: remoteChain.defaultFinality,
  })
  .parseSync()

async function main() {
  const receiver = resolveDefaultCantonReceiver(argv.cantonReceiver)
  const sepolia = await getSepoliaChain()
  const provider = await getEvmProvider()
  const wallet = await getEvmWallet()
  const destSelector = BigInt(networkConfig.canton.chainSelector)

  const tokenAddress = remoteChain.ccipTestTokenAddress
  const token = new Contract(tokenAddress, ERC20_ABI, provider)
  const decimals: number = await token.decimals()
  const symbol: string = await token.symbol()
  const amount = parseUnits(argv.amount, decimals)
  const finality = parseFinalityArg(argv.finality)

  console.log(
    `📧🪙 Sending data + ${argv.amount} ${symbol} from ${remoteChainName} → Canton: "${argv.dataString}"`,
  )
  console.log(`   Receiver party: ${receiver}`)
  console.log('   LINK is minted on Canton only after manual execution.')

  const request = await sepolia.sendMessage({
    router: remoteChain.ccipRouterAddress,
    destChainSelector: destSelector,
    wallet,
    message: {
      receiver,
      data: encodeMessageData(argv.dataString),
      tokenAmounts: [{ token: tokenAddress, amount }],
      extraArgs: buildEvmToCantonExtraArgs(argv.gasLimit, finality),
      feeToken: resolveEvmFeeToken(argv.feeToken),
    },
  })

  printCcipRequest(request, remoteChain.explorerUrl)
  printAny2CantonManualExecHint(finality, request.message.messageId, sepolia.network.name)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
