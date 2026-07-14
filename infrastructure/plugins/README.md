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
- `BASEHALF_PLUGIN_CLOUDFRONT_DISTRIBUTION_ID`
- `BASEHALF_PLUGIN_KMS_KEY_ID`
- `BASEHALF_PLUGIN_CATALOG_KEY_ID` (a stable client-facing name such as `release-2026-01`)
- `BASEHALF_PLUGIN_AWS_ROLE_ARN`

Set `submission_bucket_name` to a unique private bucket and
`control_plane_role_name` to the existing Core API workload role. Put the
`submission_bucket_name` output into Core API as `PLUGIN_SUBMISSION_BUCKET`.
The default browser CORS allowlist contains `https://basehalf.com` and local
development on port 4000; override it for additional first-party origins.

After provisioning, export the KMS public key as a PEM SPKI file. During key
rotation, application packaging can set `BASEHALF_PLUGIN_CATALOG_KEY_ID` and
`BASEHALF_PLUGIN_CATALOG_PUBLIC_KEY_PATH`; the package task validates P-256,
prepends the new public key to the product configuration, and refuses to package
an empty keyring. The current production public key is pinned in `product.json`
and under `keys/` so development builds exercise the signed production catalog.
Keep an old public key in supported clients during rotation. The private key
never leaves KMS.

Official publishing is manual through `Publish BaseHalf plugins`. Approved
community submissions are promoted by `Promote reviewed BaseHalf plugin`.
VSIX objects and each
versioned catalog/signature pair are immutable. A single
`v1/catalog-index.json` object switches the current sequence atomically, uses a
short cache, and is invalidated after publication. Withdrawal and rollback
always produce a higher sequence; no existing VSIX is overwritten.
