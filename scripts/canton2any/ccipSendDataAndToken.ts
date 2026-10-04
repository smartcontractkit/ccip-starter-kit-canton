import 'dotenv/config'

import { networkInfo } from '@chainlink/ccip-sdk'
import { parseUnits } from 'ethers'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { networkConfig, remoteChain, remoteChainName } from '../../helperConfig'
import {
  autoExecYargsOption,
  buildCantonToEvmExtraArgs,
  cantonFeeTokenYargsOption,
  resolveCantonFeeToken,
} from '../utils/cantonSend'
import { getCantonSendContext, printCcipRequest } from '../utils/chains'
import { printCanton2AnyManualExecHint } from '../utils/manualExec'
import { encodeMessageData } from '../utils/messageData'

const argv = yargs(hideBin(process.argv))
  .option('feeToken', cantonFeeTokenYargsOption)
  .option('dataString', {
    type: 'string',
    description: 'Data payload to send alongside the token transfer',
    demandOption: true,
  })
  .option('amount', {
    type: 'string',
    description: 'Amount of LINK to send (human-readable, e.g. 0.001)',
    demandOption: true,
  })
  .option('evmReceiver', {
    type: 'string',
    description: `EVM receiver contract address on ${remoteChainName}`,
    default: networkConfig.canton.defaultEvmReceiver,
  })
  .option('gasLimit', {
    type: 'number',
    description: `Gas limit for ccipReceive on ${remoteChainName}`,
    default: networkConfig.canton.defaultGasLimit,
  })
  .option('exec', autoExecYargsOption)
  .parseSync()

async function main() {
  const { canton, cantonConfig, wallet } = await getCantonSendContext()
  const destSelector = BigInt(remoteChain.chainSelector)
  const amount = parseUnits(argv.amount, networkConfig.canton.linkTokenDecimals)
  const noExec = !argv.exec

  console.log(
    `📧🪙 Sending data + ${argv.amount} LINK from Canton → ${remoteChainName}: "${argv.dataString}"`,
  )
  console.log(
    noExec
      ? `   Executor: none (--no-exec) — run canton2any:manual-exec on ${remoteChainName} after proofs are on the indexer`
      : `   Executor: default (auto-execution on ${remoteChainName} when an executor is configured)`,
  )

  const request = await canton.sendMessage({
    router: '',
    destChainSelector: destSelector,
    wallet,
    message: {
      receiver: argv.evmReceiver,
      data: encodeMessageData(argv.dataString),
      feeToken: resolveCantonFeeToken(argv.feeToken, cantonConfig.ccipParty),
      tokenAmounts: [
        {
          token: networkConfig.canton.linkTokenInstrument,
          amount,
        },
      ],
      extraArgs: buildCantonToEvmExtraArgs(argv.gasLimit, noExec),
    },
  })

  printCcipRequest(request, networkConfig.canton.explorerUrl, 'transactions')
  if (noExec) {
    printCanton2AnyManualExecHint(request.message.messageId, networkInfo(destSelector).name)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
