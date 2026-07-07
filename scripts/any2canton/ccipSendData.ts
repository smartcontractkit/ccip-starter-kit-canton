import 'dotenv/config'

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { networkConfig, remoteChain, remoteChainName } from '../../helperConfig'
import { resolveDefaultCantonReceiver } from '../canton-helper/cantonConfig'
import { getEvmWallet, getSepoliaChain, printCcipRequest } from '../utils/chains'
import { buildEvmToCantonExtraArgs, resolveEvmFeeToken } from '../utils/evmSend'
import { finalityYargsOption, parseFinalityArg } from '../utils/finality'
import { printAny2CantonManualExecHint } from '../utils/manualExec'
import { encodeMessageData } from '../utils/messageData'

const argv = yargs(hideBin(process.argv))
  .option('feeToken', {
    type: 'string',
    choices: [remoteChain.feeTokenNameLink, remoteChain.feeTokenNameNative] as const,
    default: remoteChain.feeTokenNameNative,
    description: `Fee token on ${remoteChainName} (link or native ETH; default: native)`,
  })
  .option('dataString', {
    type: 'string',
    description: 'Data payload to send',
    demandOption: true,
  })
  .option('cantonReceiver', {
    type: 'string',
    description: 'Canton receiver party ID (defaults to party in canton-config.json)',
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
  const wallet = await getEvmWallet()
  const destSelector = BigInt(networkConfig.canton.chainSelector)

  const finality = parseFinalityArg(argv.finality)

  console.log(`📧 Sending data from ${remoteChainName} → Canton: "${argv.dataString}"`)
  console.log(`   Receiver party: ${receiver}`)

  const request = await sepolia.sendMessage({
    router: remoteChain.ccipRouterAddress,
    destChainSelector: destSelector,
    wallet,
    message: {
      receiver,
      data: encodeMessageData(argv.dataString),
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
