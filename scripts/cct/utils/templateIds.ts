/**
 * CCIP Canton template IDs in `#package-name:Module:Entity` form — the
 * participant resolves the name to the latest vetted package at submission
 * time. (EDS disclosures carry hash-form templateIds; those identify the
 * disclosed contract and are not used in commands.)
 *
 * Source of truth: the `chainlink-canton` contracts repo (per-package
 * `daml.yaml` names + Daml module paths).
 */
export const TAR_TEMPLATE_ID = '#ccip-core-v2:CCIP.CoreV2.TokenAdminRegistry:TokenAdminRegistry'
export const TOKEN_CONFIG_TEMPLATE_ID = '#ccip-core-v2:CCIP.CoreV2.TokenAdminRegistry:TokenConfig'

export const BURN_MINT_POOL_TEMPLATE_ID =
  '#ccip-burn-mint-token-pool-v2:CCIP.BurnMintTokenPoolV2:BurnMintTokenPool'
export const LOCK_RELEASE_POOL_TEMPLATE_ID =
  '#ccip-lock-release-token-pool-v2:CCIP.LockReleaseTokenPoolV2:LockReleaseTokenPool'
