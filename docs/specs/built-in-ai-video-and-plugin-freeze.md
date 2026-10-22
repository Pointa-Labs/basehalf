# Built-in AI Video and the frozen plugin platform

Status: Active (2026-10-11)
Decision: [D45](../decisions.md#d45--ai-video-is-built-in-and-the-plugin-platform-is-frozen-new-2026-10-11)
Related: [plugin architecture](../plugin-architecture.md),
[AI Video domain contract](../../vscode-base/extensions/basehalf-ai-video/docs/product-contract.md),
[architecture invariants](../harness/architecture-invariants.md)

## Problem

Three things were true on 2026-10-11.

- AI Video is the product's main capability, but it is delivered as a plugin.
  In a packaged build nothing of it runs until the user finds the Plugins
  library and installs it.
- The Plugins library shows an error every time it opens. Client builds made
  after 2026-07-20 require a content hash for every version in the signed
  catalog. The published catalog (sequence 10, generated 2026-07-15) has none,
  so the client rejects all of it.
- Nobody outside BaseHalf has published a plugin. The published catalog holds
  AI Video up to 0.4.0, while the source is at 0.6.0, and one withdrawn test
  plugin. The job that promotes reviewed plugins still ran every hour with
  the right to sign.

## Goals

- AI Video works on the first start of a packaged build, with no install step
  and no network.
- The product has no plugin surface: nothing to open, nothing to install, and
  nothing that can show a catalog error.
- BaseHalf makes no request to the plugin registry or the publishing portal.
- Nothing can publish or sign a plugin without a person starting it.
- The freeze can be lifted without rebuilding what exists.

## Non-goals

- Deleting the plugin platform's code, release tooling, infrastructure
  definitions, or developer packages.
- How a generation card generates an image or a video.
  [Generation cards](generation-cards.md) owns it (D58, D63, D64).
- A switch that turns AI Video off (D45).
- Keeping plugins that earlier builds installed from the catalog running, or
  cleaning them up. The product is not launched; such installs stop running
  and stay on disk unused.
- Repairing the published catalog for builds that are already distributed.
- What agents themselves can be extended with, such as skills and tool
  connections. BaseHalf's own skill is owned by
  [agent skill](agent-skill.md).

## Terms

- **Built-in copy.** The AI Video extension in the application's own
  extensions folder. It ships with the application and is replaced when the
  application is updated.
- **Profile copy.** An AI Video extension that an earlier build recorded in a
  user's extension profile, from the bundled payload or from the catalog.
- **Admitted.** Allowed to contribute templates, card projections,
  structural cleanups, and agent capabilities. Since D58, AI Video also
  answers the provider commands of generation cards; recipes and the
  reviewed model catalogs that plugins declared are gone.
- **Plugin surface.** The Plugins item in the Activity Bar, the Plugins page
  in the center, the Manage Plugins command with its menu entry, and links
  that open a plugin.

## Required behavior

### AI Video is built in

1. A packaged build carries AI Video among its built-in extensions. The
   separate payload folder that the installer read from is gone.
2. The built-in copy is admitted in packaged and in development builds, and
   only at the application's own extensions folder. An extension with the same
   identity anywhere else is not admitted.
3. On the first start of a fresh profile, with no network and no user action,
   AI Video's starter template, Sequence view, agent capabilities, and the
   provider commands of generation cards are available.
4. AI Video has the version that the application ships. It has no update,
   restore, enable, disable, or uninstall of its own.
5. Every way into AI Video works without the plugin surface: the starter
   template from the canvas, a generation card's panel, the Sequence view
   from a sequence file, and its commands from the Command Palette.
6. The release notes of the release that carries this change say that AI
   Video is built in and that the Plugins library is gone. Since
   [D48](../decisions.md#d48--release-notes-are-written-once-on-the-releases-page-new-2026-10-12)
   they are on the releases page only.

### No plugin surface

7. The Activity Bar shows exactly Files, Git, and Search.
8. No plugin command is registered. Nothing in the Command Palette, a menu,
   or a keybinding opens a Plugins page or installs, updates, enables,
   disables, or removes a plugin.
9. A link that used to open a plugin brings BaseHalf to the front and does
   nothing else. It shows no page and no error.
10. No message, button, link, or setting names Plugins, installing a plugin,
    or the catalog. Where a message offered that as a repair, for example on a
    node that could not run, it now says what is wrong in plain words and
    offers only actions that exist (D41).

### The frozen platform in the client

11. BaseHalf makes no network request to `registry.basehalf.com` or
    `plugins.basehalf.com`. The product configuration names neither, and no
    catalog cache is read at start.
12. The only extension admitted in a normal window is the built-in copy of
    AI Video. No grant from a catalog exists, so no reviewed plugin is
    admitted, and nothing can install one. No location alone admits an
    extension, and no folder is installable by itself.
13. The rule for an Extension Development Host is unchanged: an unpublished
    extension contributes only there, and only from the exact location that
    host was started with.
14. The platform's source files stay in the repository, keep compiling, and
    keep their unit tests. Nothing registers their interface or starts their
    network code. The smoke keeps its slice for the life cycle of a reviewed
    plugin and refuses to run it. This is a recorded exception to the rule
    against detached interface code (D23); D45 says when it is reviewed.

### State left by earlier builds

15. An extension that an earlier build's plugin installer put into a profile
    is never admitted and does not run: a profile copy of AI Video, and any
    plugin installed from the catalog. BaseHalf neither removes nor migrates
    it. Files such plugins wrote into workspaces are not touched.
16. The built-in copy of AI Video is the one that runs. A profile copy with
    the same or a lower version does not replace it.
17. The catalog state that earlier builds stored on the machine is not read.
    Install receipts from earlier builds admit nothing, because no catalog
    grant exists for them to match.
18. If the Plugins library of an earlier build left AI Video disabled,
    BaseHalf enables it at start without asking, because nothing in the
    product can turn it back on. An extension that the product itself holds
    back is left as it is.

## Failure and recovery

- **The built-in copy does not load,** for example because the application is
  damaged. A generation card cannot generate: its generation fails with a
  message that AI Video could not start and that reinstalling BaseHalf
  repairs it, as does an unfinished template setup. The rest of BaseHalf
  works.
- **A profile copy of AI Video has a higher version than the built-in copy.**
  The extension scanner then prefers the profile copy, which is not admitted,
  so AI Video is unavailable as in the case above. No distributed build can
  produce this: the catalog stopped at 0.4.0, below every built-in copy. It
  can happen only on a development machine that runs an older build after a
  newer one, and it is not handled.
- **No network.** Nothing changes; no part of this depends on it.

## Outside the desktop client

The end state is listed here so that it is in one place. The services belong
to the server repository and are changed there.

Repository automation and documents:

- The workflow that promotes reviewed plugins has no schedule. It can still
  be started by hand.
- The two publishing workflows stay manual and are not used while the
  platform is frozen.
- The plugin documents say at the top that publishing is frozen.
- The published developer packages, the command-line tool and the SDK, carry
  a notice that publishing is paused. They still scaffold and accept recipes,
  which the host and the release checks no longer have (D58); they are
  brought up to date if the freeze is lifted.

Services:

- The registry stays online and unchanged as read-only static files, because
  builds that are already distributed read it.
- The publishing portal and the publishing API are not reachable, and the
  main site starts without the portal.
- The token that lets the promotion workflow claim a release is revoked.
- Before the portal closes, registered publishers and submissions are
  counted, and anyone found is told.
- The signing key, both storage buckets, and the database tables are kept.

## Compatibility

- Workspaces need no change. Sequence files, and the videos made with any
  earlier AI Video version, stay ordinary local files. Since D63 nothing is
  converted: an earlier `.bhnode` shows as an ordinary file and `outputs/` as
  an ordinary folder ([generation cards](generation-cards.md#non-goals)).
- A profile that an earlier build installed AI Video into keeps that copy on
  disk, unused. No profile data is changed or removed.
- Builds that are already distributed keep reading the registry and keep
  showing their catalog error until they are updated.

## Acceptance criteria

1. A packaged build, started offline on a fresh profile, offers AI Video's
   starter template on the canvas and opens a sequence file in the Sequence
   view, with no step in between.
2. The packaged application contains AI Video in its built-in extensions
   folder and no separate plugin payload folder.
3. The Activity Bar has exactly three items: Files, Git, and Search.
4. The Command Palette lists no command that opens Plugins or manages a
   plugin.
5. Opening a plugin link focuses BaseHalf and changes nothing on screen.
6. The product configuration contains neither registry nor portal address,
   and a session that starts, idles, and uses AI Video makes no request to
   either host.
7. Admission accepts the built-in copy in a packaged build, rejects an
   extension with the same identity at any other location, and rejects any
   extension that depends on a catalog grant.
8. A profile copy of AI Video is not admitted, also when it is recorded at
   the built-in copy's own path, and the built-in copy is admitted beside
   it.
9. No user-visible text names Plugins, installing a plugin, or the catalog.
10. The promotion workflow has no schedule trigger.
11. The generation card flows of the smoke pass on a fresh fixture profile
    with no install step.
12. A profile in which an earlier build disabled AI Video starts with it
    enabled.

## Verification

- Unit tests for admission (criteria 7 and 8) and for the product
  configuration (criterion 6, first half). That a profile copy with the same
  or a lower version does not replace the built-in copy is the extension
  scanner's own rule; it was read in the code and is not exercised end to end.
- A unit test for the start-up check that enables AI Video (criterion 12),
  and one that scans every compiled module for an import of the frozen
  surface.
- The smoke asserts the three Activity Bar items and the missing command, and
  runs the generation card flows on a fresh profile (criteria 3, 4, and 11).
- A packaged macOS arm64 build for criteria 1 and 2:
  `npm run basehalf:plugin:layout-smoke -- --app <application>` checks the
  packaged layout and the packaged product configuration, and the smoke's
  `--packaged-app <application>` option runs the same slices against the
  packaged build.
- Manual checks for criterion 5 and for the second half of criterion 6, and a
  text search of the user-visible strings for criterion 9.
- `git diff` of the workflow file for criterion 10.

## Where this lands

Paths are under `vscode-base/` unless they start with a dot.

- Built-in capabilities and their location:
  `src/vs/workbench/basehalf/plugins/common/basehalfBuiltInCapabilities.ts`.
  `isAllowedContributor` in `basehalfPluginAdmissionService.ts` admits such a
  capability only as the built-in copy at that location. AI Video is
  deliberately not in the profile's list of extensions that are allowed by
  id. `browser/basehalfBuiltInCapabilities.contribution.ts` enables it at
  start when an earlier build left it disabled.
- Packaging: `build/gulpfile.vscode.ts` ships AI Video with the built-in
  extensions and copies no payload folder.
- No plugin surface: `electron-browser/basehalfPluginPlatform.contribution.ts`
  loads only the credential store, which keeps the keys of the providers
  (D58, D64). The catalog service, the plugin state store, the
  management service, the Plugins view, the Plugin Library, and the
  contribution that restored the catalog cache and handled plugin links stay
  in the tree and are not loaded.
  `test/node/basehalfPluginPlatformBoundary.test.ts` guards this.
- Release checks: `scripts/basehalf-plugin-release.mts` refuses a manifest
  that declares recipes or model catalogs, and a template draft with fields
  other than `path` and `prompt` (D58, D63). It reads a template as the host
  does ([reference graph](reference-graph.md#templates)): it refuses a
  `nodes` list, a draft whose path has no generation extension, and a folder
  that holds a draft and no file.
  An activation event must name something the manifest declares, with one
  exception: the official AI Video may activate on the four provider
  commands of the host, which it answers without declaring them.
  `npm run basehalf:plugin:fixture` exercises these checks.
- Sidebar: `BASEHALF_PRIMARY_VIEW_CONTAINERS` in
  `basehalfWorkbenchProfile.ts`.
- Links and stock commands that used to open the Plugin Library do nothing:
  `handleURL` in `contrib/extensions/browser/extensionsWorkbenchService.ts`,
  and `extension.open` and `_extensions.manage` in `extensions.contribution.ts`.
- Product configuration: `product.json` has no `basehalfPlugins` block and no
  registry entry under `extensionsGallery`. The pinned public key stays in
  `infrastructure/plugins/keys/`.
- Schedule: `.github/workflows/promote-reviewed-plugin.yml`.

Two parts of the frozen platform were removed instead of kept, because each
trusted a location without a signed grant: admitting an official plugin at
the payload folder, and installing from that folder without an authorization
(`basehalfPluginAdmissionService.ts`, `basehalfExtensionInstallPolicy.ts`).
The frozen management service still has its bundled-install path, which now
ends in a refusal. If the freeze is lifted for an official plugin that is not
built in, that plugin needs a signed grant like any other, or these two rules
have to be decided again.

## Resolved during implementation

1. When a profile copy and a built-in copy of one extension both exist, the
   extension scanner keeps the built-in copy if the profile copy has the same
   or a lower version, and the profile copy if it is higher (`dedupExtensions`
   in `src/vs/platform/extensionManagement/common/extensionsScannerService.ts`).
   Rule 16 states the first case; the second is the failure case above.
2. The user-visible strings that named plugins were the two messages for an
   unfinished template setup, the empty state of Models & Providers, the
   three status lines of a file-specific Card Detail view, the refusal to
   install an extension, the reason an extension does not run, a cleanup
   error, and four lines of the release notes.
3. Packaging asked for a catalog public key only when the product
   configuration had a `basehalfPlugins` block. Without the block it asks for
   none.
4. In a development build AI Video was already scanned as a built-in
   extension and admitted, and the smoke ran its video flows that way. The
   packaged build is the new case.
