/**
 * CCIP-hosted contract raw instance addresses for Canton testnet.
 *
 * Values match {@link https://github.com/smartcontractkit/chainlink-canton}
 * prod testnet deployment and the Issuer Token Pool deployment guides.
 * Override individual fields via env when ops publishes new addresses.
 */
export const ccipHostedAddresses = {
  tokenAdminRegistry:
    process.env.CANTON_TOKEN_ADMIN_REGISTRY_ADDRESS?.trim() ??
    'tokenadminregistry-lzrnd@ccipOwner::1220e382f4e57b0815e6be737006e381e6b7de448e06bd033ece6df498017879f551',
  rmnRemote:
    process.env.CANTON_RMN_REMOTE_ADDRESS?.trim() ??
    'rmn_remote-nzvtd@rmnOwner::1220e382f4e57b0815e6be737006e381e6b7de448e06bd033ece6df498017879f551',
  feeQuoter:
    process.env.CANTON_FEE_QUOTER_ADDRESS?.trim() ??
    'feequoter-scxln@ccipOwner::1220e382f4e57b0815e6be737006e381e6b7de448e06bd033ece6df498017879f551',
} as const

export function rawInstanceAddress(unpack: string): { unpack: string } {
  return { unpack }
}

export function poolRawAddress(instanceId: string, poolOwner: string): string {
  return `${instanceId}@${poolOwner}`
}
