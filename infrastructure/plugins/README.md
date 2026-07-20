# BaseHalf plugin distribution

This Terraform module creates the isolated production distribution plane for
BaseHalf plugins: a private versioned distribution bucket, a separate private
submission quarantine, CloudFront with an origin access control, an ECC P-256
KMS signing key, and a narrowly scoped GitHub Actions OIDC publisher role. The
quarantine is never a CloudFront origin. Core API receives access only to that
quarantine and never receives access to the distribution bucket or signing key.

Provision the module with an ACM certificate from `us-east-1`, an existing
GitHub Actions OIDC provider ARN, and (optionally) the Route53 hosted zone. Put
the Terraform outputs into the `plugins-production` GitHub environment as:

- `BASEHALF_PLUGIN_AWS_REGION`
- `BASEHALF_PLUGIN_BUCKET`
- `BASEHALF_PLUGIN_SUBMISSION_BUCKET` (the `submission_bucket_name` output; used to pin reviewed-download URLs to the private quarantine origin)
- `BASEHALF_PLUGIN_CLOUDFRONT_DISTRIBUTION_ID`
- `BASEHALF_PLUGIN_KMS_KEY_ID`
- `BASEHALF_PLUGIN_CATALOG_KEY_ID` (a stable client-facing name such as `release-2026-01`)
- `BASEHALF_PLUGIN_TRUSTED_KMS_KEYS_JSON` (a JSON object mapping every accepted
  catalog `keyId`, including the current one, to its KMS key ARN or ID)
- `BASEHALF_PLUGIN_AWS_ROLE_ARN`

The Terraform module always retains its managed bootstrap signing key with
`prevent_destroy`. Leave `current_catalog_signing_key_arn` unset to use that
key. For a later rotation, point `current_catalog_signing_key_arn` at the new
externally managed P-256 key ARN and put every still-supported old key ARN in
`trusted_catalog_verification_key_arns`. The publisher role can call `Sign`
only on the current ARN; old ARNs receive only `Verify` and `GetPublicKey`.
Use the active `catalog_kms_key_arn` output for
`BASEHALF_PLUGIN_KMS_KEY_ID`, and build
`BASEHALF_PLUGIN_TRUSTED_KMS_KEYS_JSON` from the current and trusted old ARNs.

The publisher role trusts only the OIDC subject for the
`plugins-production` environment. Configure that environment to allow
deployments only from `main`, protect changes to the publishing workflows with
the repository's normal branch-review rules, and require an environment
reviewer when production policy calls for a human release gate. The publishing
jobs are top-level workflows, not reusable workflows, so their GitHub tokens do
not carry `job_workflow_ref`; putting that absent claim in the AWS trust policy
would make the role impossible to assume. Workflow and branch authorization
therefore belongs to the protected GitHub environment, while AWS independently
pins the repository and environment through `sub`.

Set `submission_bucket_name` to a unique private bucket whose name uses only
lowercase letters, digits, and hyphens. This keeps signed download URLs on the
single virtual-hosted quarantine origin enforced by the promotion job. Set
`control_plane_role_name` to the existing Core API workload role. Put the
`submission_bucket_name` output into Core API as `PLUGIN_SUBMISSION_BUCKET`.
The default browser CORS allowlist admits the isolated publishing portal at
`https://plugins.basehalf.com`, the main-product compatibility path, and local
portal development on port 4100. The machine catalog and immutable VSIX assets
are served from `https://registry.basehalf.com`.
During the desktop-client migration, CloudFront also retains the former
registry hostname as an alias. The portal edge proxies only its signed,
read-only registry paths; remove the legacy alias after the supported-client
window closes.
CloudFront attaches a public read-only CORS and security-headers policy to every
catalog and VSIX behavior so the desktop workbench's `vscode-file://vscode-app`
origin can fetch assets without granting write methods at the distribution.

After provisioning, export the KMS public key as a PEM SPKI file. Before key
rotation, create the replacement key without replacing or scheduling deletion
of the old key, add the old ARN to
`trusted_catalog_verification_key_arns`, add both old and new mappings to
`BASEHALF_PLUGIN_TRUSTED_KMS_KEYS_JSON`, and ship the new public key to supported
clients. Apply Terraform with the new `current_catalog_signing_key_arn`, then
change `BASEHALF_PLUGIN_KMS_KEY_ID` and
`BASEHALF_PLUGIN_CATALOG_KEY_ID`. Workflows verify every newly generated
signature against the trusted map before writing catalog objects, verify older
catalogs with the key named by their signature, and sign only with the current
key. After all supported clients, catalogs, and recovery paths have moved past
the old key, remove its workflow mapping and trusted verification ARN. The
module-managed bootstrap key remains retained; externally managed key stacks
must use the same deletion protection.
Application packaging can set `BASEHALF_PLUGIN_CATALOG_KEY_ID` and
`BASEHALF_PLUGIN_CATALOG_PUBLIC_KEY_PATH`; the package task validates P-256,
prepends the new public key to the product configuration, and refuses to package
an empty keyring. The current production public key is pinned in `product.json`
and under `keys/` so development builds exercise the signed production catalog.
Keep an old public key in supported clients during rotation. The private key
never leaves KMS.

Official publishing is manual through `Publish BaseHalf plugins`. Approved
community submissions are promoted by `Promote reviewed BaseHalf plugin`.
VSIX objects, per-version identity records, and each versioned
catalog/signature pair are immutable. The identity record permanently binds an
extension ID and semantic version to the archive digest, byte size, and asset
path. The signed catalog retains earlier version grants and additionally binds
the canonical installed file-tree digest. That digest uses exact bytes for
ordinary files; both publisher and client strictly parse `package.json`, remove
only the root installer-owned `__metadata`, and hash the same compact JSON
serialization. Harmless installer formatting therefore does not weaken
verification or cause a permanent mismatch.
Publishing
backfills records from the verified current catalog before advancing it. A single
`v1/catalog-index.json` object switches the current sequence atomically, uses a
short cache, and is invalidated after publication. Withdrawal and rollback
always produce a higher sequence; no existing VSIX is overwritten. Initial
creation of both the catalog index and emergency control document requires the
explicit one-time bootstrap input; storage errors never fall back to an empty
registry. A partial bootstrap may resume only when the already-published
control document is proven empty and the versioned bucket inventory contains
only the exact first-release candidate, signature, asset, and identity paths.
Delete markers, non-current versions, later catalog sequences, and unrelated
objects stop bootstrap instead of being interpreted as an empty registry. A
security block is published and CDN-verified before withdrawal,
while restore removes the block only after the restored catalog is verified.
An interrupted status change may be retried with the same sequence after the
current index advances: the workflow verifies that exact requested state and
finishes the remaining control and synchronization steps without rewriting the
immutable catalog.
An interrupted official publish also converges at either catalog boundary. If
the immutable candidate exists before the index switch, a retry verifies and
reuses its exact signed bytes while allowing only regenerated timestamps to
differ. If the current index already points at the requested sequence, the
workflow verifies the package and full published entry before continuing as an
idempotent success.
