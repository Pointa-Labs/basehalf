# Publish, review, and update

## Publish from the plugin project

```bash
npm run publish
```

The first publish opens `plugins.basehalf.com` for one confirmation with the
BaseHalf account you already use. The page verifies the requesting machine,
shows the Publisher namespace declared by the plugin manifest, and asks for the
current contributor and publishing terms when required.

If that namespace does not exist and is available, BaseHalf creates it for the
account during the same confirmation. There is no separate developer account,
Publisher setup page, or mandatory `login` command in the normal path.

After confirmation, the CLI resumes automatically. It validates the manifest,
packages the VSIX, calculates its hash, registers the plugin identity when
needed, uploads the immutable candidate, and finalizes the submission.

The browser portal is a status and access surface. It does not duplicate local
plugin creation or VSIX upload.

## Review

Publishing sends the VSIX directly to private quarantine. The server re-hashes
and inspects the artifact. Reviewers examine the exact package, repository
disclosure, executable-code authority, local-data behavior, and fixed-shell
fit. A rejection includes a summary; fixes require a new version.

Approval creates an immutable release job but does not give the web service a
signing key. A separately credentialed signer leases the job, repeats critical
checks, publishes the VSIX by digest, advances the KMS-signed catalog, and
verifies the CDN.

Use `bh-plugin status .` only when a terminal-readable status is useful.
`bh-plugin login --publisher <slug>` remains available for manual credential
management and automation setup, but is not required before publish.

## Updates and withdrawal

Publish an update with the same command:

```bash
npm run publish
```

- Every version is immutable; never reuse a published or submitted version.
- Catalog checks may report an update but never install code silently.
- BaseHalf uses its signed catalog for admission and verified VSIX delivery.
- After verification, BaseHalf delegates profile installation, enablement,
  disablement, uninstall, Extension Host restart, settings, context menus, and
  runtime-state UI to VS Code.
- Extension updates normally use VS Code's **Restart Extensions** or
  **Reload Window** runtime actions when a restart is required.
- **Restart to Update** remains owned by the VS Code product updater and appears
  only when the BaseHalf application itself must finish an update.
- Normal withdrawal blocks new installs and displays the reason.
- Security withdrawal can use the emergency extension-control list.
- Disable or uninstall never deletes ordinary project files or generated
  results.

## Maintainer release of the developer tools

`@basehalf/plugin-sdk` and `@basehalf/plugin-cli` are released together. The
**Publish plugin developer tools** workflow tests, builds, packs, and inspects
both packages before publishing them through npm trusted publishing and GitHub
OIDC. The release workflow does not use a long-lived npm publish token.

Use `dry_run` for ordinary workflow verification. A production run requires the
`@basehalf` npm organization, its trusted-publisher relationship, and the
protected `npm-production` GitHub environment; application code never creates
those external resources.
