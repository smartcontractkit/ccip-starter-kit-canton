import { AbiCoder, hexlify, toUtf8Bytes } from 'ethers'

/**
 * Encode a human-readable string for CCIP data payloads.
 * Matches ccip-cli behavior: raw UTF-8 bytes unless prefixed with `0x:` for ABI string encoding.
 */
export function encodeMessageData(message: string): string {
  if (message.startsWith('0x:')) {
    return AbiCoder.defaultAbiCoder().encode(['string'], [message.slice(3)])
  }
  if (message.startsWith('0x')) {
    return message
  }
  return hexlify(toUtf8Bytes(message))
}
