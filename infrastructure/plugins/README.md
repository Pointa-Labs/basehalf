# BaseHalf plugin distribution

This Terraform module creates the isolated production distribution plane for
official BaseHalf plugins: a private versioned S3 bucket, CloudFront with an
origin access control, an ECC P-256 KMS signing key, and a narrowly scoped
GitHub Actions OIDC publisher role. It does not use or modify the BaseHalf web
application EC2, Gateway, PostgreSQL, or Redis resources.

Provision the module with an ACM certificate from `us-east-1`, an existing
GitHub Actions OIDC provider ARN, and (optionally) the Route53 hosted zone. Put
the Terraform outputs into the `plugins-production` GitHub environment as:

- `BASEHALF_PLUGIN_AWS_REGION`
- `BASEHALF_PLUGIN_BUCKET`
- `BASEHALF_PLUGIN_CLOUDFRONT_DISTRIBUTION_ID`
- `BASEHALF_PLUGIN_KMS_KEY_ID`
- `BASEHALF_PLUGIN_CATALOG_KEY_ID` (a stable client-facing name such as `release-2026-01`)
- `BASEHALF_PLUGIN_AWS_ROLE_ARN`

After provisioning, export the KMS public key as a PEM SPKI file. Application
packaging must set `BASEHALF_PLUGIN_CATALOG_KEY_ID` and
`BASEHALF_PLUGIN_CATALOG_PUBLIC_KEY_PATH`; the package task validates P-256,
stamps the public key into the product configuration, and refuses to package an
empty keyring. Keep an old public key in supported clients during rotation. The
private key never leaves KMS.

Publishing is manual through `Publish BaseHalf plugins`. VSIX objects and each
versioned catalog/signature pair are immutable. A single
`v1/catalog-index.json` object switches the current sequence atomically, uses a
short cache, and is invalidated after publication. Withdrawal and rollback
always produce a higher sequence; no existing VSIX is overwritten.
