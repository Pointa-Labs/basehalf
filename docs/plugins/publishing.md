# Publish, review, and update

## Establish a Publisher

Open [BaseHalf Plugins](https://plugins.basehalf.com/publish) with the BaseHalf
account you already use. Accept the current contributor and publishing terms,
then create or join a Publisher. No separate developer account is required.

Publisher and plugin identities are durable. Choose them as product names, not
as temporary test values.

## Connect the CLI

```bash
bh-plugin login
bh-plugin whoami
```

`login` opens a short-lived device approval page on `plugins.basehalf.com`.
The CLI receives an opaque, expiring, Publisher-scoped credential—not the web
password. The credential is stored owner-readable only and can be revoked from
the plugin portal.

## Submit an immutable build

```bash
npm run publish
bh-plugin status .
```

Publishing sends the VSIX directly to private quarantine. The server re-hashes
and inspects the artifact. Reviewers examine the exact package, repository
disclosure, executable-code authority, local-data behavior, and fixed-shell
fit. A rejection includes a summary; fixes require a new version.

Approval creates an immutable release job but does not give the web service a
signing key. A separately credentialed signer leases the job, repeats critical
checks, publishes the VSIX by digest, advances the KMS-signed catalog, and
verifies the CDN.

## Updates and withdrawal

- Published VSIX objects are immutable; never reuse a version.
- Catalog checks may report an update but never install code silently.
- BaseHalf reuses VS Code's extension lifecycle, including enable, disable,
  uninstall, Extension Host restart, **Restart to Update**, settings, context
  menus, and runtime-state UI.
- Normal withdrawal blocks new installs and displays the reason.
- Security withdrawal can use the emergency extension-control list.
- Disable or uninstall must never delete ordinary project files or generated
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
