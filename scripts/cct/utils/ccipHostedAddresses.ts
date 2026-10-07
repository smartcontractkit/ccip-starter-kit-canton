/**
 * CCIP-hosted contract raw instance addresses for Canton testnet.
 *
 * Values match {@link https://github.com/smartcontractkit/chainlink-canton}
 * prod testnet deployment (ccip-core-v2 contracts, verified against the
 * testnet EDS Oct 2026). Override individual fields via env when ops
 * publishes new addresses.
 */
export const ccipHostedAddresses = {
  tokenAdminRegistry:
    process.env.CANTON_TOKEN_ADMIN_REGISTRY_ADDRESS?.trim() ??
    'tokenadminregistry-nbehb@ccipOwner::1220e382f4e57b0815e6be737006e381e6b7de448e06bd033ece6df498017879f551',
  rmnRemote:
    process.env.CANTON_RMN_REMOTE_ADDRESS?.trim() ??
    'rmn_remote-pttst@rmnOwner::1220e382f4e57b0815e6be737006e381e6b7de448e06bd033ece6df498017879f551',
  feeQuoter:
    process.env.CANTON_FEE_QUOTER_ADDRESS?.trim() ??
    'feequoter-koyox@ccipOwner::1220e382f4e57b0815e6be737006e381e6b7de448e06bd033ece6df498017879f551',
} as const

export function rawInstanceAddress(unpack: string): { unpack: string } {
  return { unpack }
}

export function poolRawAddress(instanceId: string, poolOwner: string): string {
  return `${instanceId}@${poolOwner}`
}
