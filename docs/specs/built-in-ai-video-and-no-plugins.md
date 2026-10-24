# Built-in AI Video and no plugins

Status: Active (2026-10-11), revised 2026-10-24 (D75) and 2026-10-25 (D76)
Decisions: [D45](../decisions.md#d45--ai-video-is-built-in-and-the-plugin-platform-is-frozen-new-2026-10-11),
[D75](../decisions.md#d75--ai-video-is-basehalfs-own-code-not-an-extension-new-2026-10-24),
[D76](../decisions.md#d76--the-plugin-platform-is-removed-new-2026-10-25)
Related: [Video Sequence](video-sequence.md),
[providers and the model catalog](providers.md),
[workbench appearance](workbench-appearance.md),
[architecture invariants](../harness/architecture-invariants.md)

## Problem

On 2026-10-11 AI Video, the product's main capability, was delivered as a
plugin that a new user had to find and install, the Plugins library showed an
error every time it opened, nobody outside BaseHalf had published a plugin,
and the job that promoted reviewed plugins still ran every hour with the
right to sign. D45 built AI Video in and froze the platform, keeping its code;
D75 made AI Video BaseHalf's own code; D76 removed the platform, whose code no
longer described anything the product does.

## Goals

- AI Video works on the first start of a packaged build, with no install step
  and no network, and nothing of it waits for an extension.
- The product has no plugin surface: nothing to open, nothing to install, and
  nothing that can show a catalog error.
- No extension contributes to BaseHalf, and BaseHalf runs only the
  extensions it ships and the agent extensions it supports.
- BaseHalf makes no request to the plugin registry or the publishing portal.
- The repository holds no plugin platform: no code, tooling, workflow,
  package, or infrastructure definition of it.
- VS Code's own extension system stays as VS Code has it, so that BaseHalf
  can build on it later.

## Non-goals

- How a generation card generates an image or a video.
  [Generation cards](generation-cards.md) owns it (D58, D63, D64).
- A switch that turns AI Video off (D45).
- Keeping plugins that earlier builds installed from the catalog running, or
  cleaning them up. The product is not launched; such installs stop running
  and stay on disk unused.
- Retiring the registry, the publishing services, the published packages, and
  the cloud resources behind them. Their owner does it outside the
  repository (see [Outside the repository](#outside-the-repository)).
- What agents themselves can be extended with, such as skills and tool
  connections. BaseHalf's own skill is owned by
  [agent skill](agent-skill.md).

## Terms

- **Provider service.** The part of BaseHalf that holds the provider modules
  and sends their requests. It runs in the shared process, the background
  process that the application starts once for all of its windows
  ([providers and the model catalog](providers.md#requests)).
- **Profile copy.** An AI Video extension, or another plugin, that an earlier
  build recorded in a user's extension profile, from the bundled payload or
  from the catalog.
- **Plugin surface.** The Plugins item in the Activity Bar, the Plugins page
  in the center, the Manage Plugins command with its menu entry, and links
  that open a plugin.
- **Agent extensions.** The extensions of the agents that the Agent Area
  runs, Codex (`openai.chatgpt`) and Claude Code (`anthropic.claude-code`),
  each known by its exact gallery identity.

## Required behavior

### AI Video is BaseHalf's own code

1. AI Video ships as BaseHalf's own code, not as an extension (D75). The
   provider service runs in the shared process. The Video Sequence document,
   its view, its commands, its agent capability, and the starter template are
   registered by the workbench ([Video Sequence](video-sequence.md)). A
   packaged build has no AI Video extension and no separate payload folder.
2. On the first start of a fresh profile, with no network and no user action,
   the starter template, the Sequence view, the Sequence capability for
   agents, and the providers of generation cards are available. A window
   asks the provider service for the catalog as soon as it needs it, and
   waits for no extension.
3. AI Video has the version that the application ships. It has no update,
   restore, enable, disable, or uninstall of its own.
4. Every way into AI Video works without a plugin surface: the starter
   template from the canvas, a generation card's panel, the Sequence view
   from a sequence file, and its commands from the Command Palette.

### No plugin surface

5. The Activity Bar shows exactly Files, Git, and Search.
6. No plugin command is registered. Nothing in the Command Palette, a menu,
   or a keybinding opens a Plugins page or installs, updates, enables,
   disables, or removes a plugin.
7. A link that used to open a plugin brings BaseHalf to the front and does
   nothing else. It shows no page and no error.
8. No message, button, link, or setting names Plugins, installing a plugin,
   or the catalog.

### No plugin platform

9. No extension contributes to BaseHalf. Canvas templates, Card Detail
   projections, and the capabilities that agents read are registered by
   BaseHalf's own features; no extension manifest adds one, and no extension
   API of BaseHalf exists. VS Code's extension host, extension API, extension
   management, and gallery stay as VS Code has them: where BaseHalf changed
   them for its plugins, they are VS Code's code at the import commit again,
   and only the allowlist and the install policy decide what runs and what
   installs.
10. BaseHalf runs its built-in extensions, the agent extensions, and the
    extension that an Extension Development Host was started with, from the
    location it was started with. Any other extension does not run, and
    BaseHalf says why where VS Code would show it.
11. BaseHalf installs nothing but the agent extensions, from the gallery by
    their exact identity. A file, a folder, or another extension from the
    gallery is refused, with a message that says BaseHalf runs only its
    built-in extensions and the agent extensions it supports.
12. BaseHalf makes no network request to `registry.basehalf.com` or
    `plugins.basehalf.com`. The product configuration names neither, and no
    catalog or catalog cache is read.
13. Deleting a file or a folder runs no plugin cleanup: the only cleanups
    are BaseHalf's own ([mirror file resilience](mirror-file-resilience.md)).

### State left by earlier builds

14. An extension that an earlier build's plugin installer put into a profile
    does not run: a profile copy of AI Video, and any plugin installed from
    the catalog. BaseHalf neither removes nor migrates it. Files such plugins
    wrote into workspaces are not touched.
15. What earlier builds' copies of AI Video registered, the
    `basehalf.video.provider.*` commands among it, is not called by BaseHalf.
16. The catalog state and the install receipts that earlier builds stored on
    the machine are not read.

## Failure and recovery

- **The provider service does not answer,** because the shared process
  stopped or a window lost its connection to it. A call that does not reach
  the service fails as one whose service stopped while it ran
  ([providers and the model catalog](providers.md#requests)): the models do
  not load and the page offers **Try Again**, a request that may have
  reached the provider has an unknown outcome, and a generation that waits
  for its provider asks again at its interval. The application does not
  start a shared process that stopped again, as VS Code does not for its own
  background work: every window is told at once, and VS Code asks the user to
  restart, after which the window goes on with the generations it was
  following.
- **A profile copy** from an earlier build stays on disk and does not run.
  Nothing of BaseHalf depends on it.
- **No network.** Nothing changes; no part of this depends on it.

## Outside the repository

The repository no longer holds what managed the plugin services (D76): the
workflows that published, promoted, withdrew, and rolled back plugins, the
workflow that published the developer packages, and the infrastructure
definitions of the registry. They are in git history. What is left is done by
the owner outside the repository:

- The registry, a set of static files that builds already distributed read,
  stays online until it is shut down; while it is, those builds keep showing
  their catalog error until they are updated.
- The signing key, the storage buckets, the content delivery, the database
  tables, the release token, and the roles that the workflows used are
  removed or kept as the owner decides.
- The published packages `@basehalf/plugin-cli` and `@basehalf/plugin-sdk`
  are marked as deprecated or unpublished.
- The publishing portal and its API stay out of service, as since D45.

## Compatibility

- Workspaces need no change. Sequence files, and the videos made with any
  earlier AI Video version, stay ordinary local files. Since D63 nothing is
  converted: an earlier `.bhnode` shows as an ordinary file and `outputs/` as
  an ordinary folder ([generation cards](generation-cards.md#non-goals)).
- A profile that an earlier build installed AI Video into keeps that copy on
  disk, unused. No profile data is changed or removed.
- The credentials of providers, the settings of the Providers page, and the
  last used models stay where they are.
- Builds that are already distributed keep reading the registry for as long
  as it is online.

## Acceptance criteria

1. A packaged build, started offline on a fresh profile, offers the starter
   template on the canvas and opens a sequence file in the Sequence view,
   with no step in between.
2. The packaged application contains no AI Video extension in its extensions
   folder and no separate plugin payload folder.
3. The Activity Bar has exactly three items: Files, Git, and Search.
4. The Command Palette lists no command that opens Plugins or manages a
   plugin.
5. Opening a plugin link focuses BaseHalf and changes nothing on screen.
6. The product configuration contains neither registry nor portal address,
   and a session that starts, idles, and uses AI Video makes no request to
   either host.
7. A built-in extension, an agent extension with its gallery identity, and
   the extension of an Extension Development Host run; a profile copy of AI
   Video, an agent extension's identity on another extension, and any other
   extension do not.
8. Installing a file, a folder, or a gallery extension other than an agent
   extension is refused with the message of rule 11.
9. No user-visible text names Plugins, installing a plugin, or the catalog.
10. The generation card flows of the smoke pass on a fresh fixture profile
    with no install step, their requests sent by the provider service in the
    shared process.
11. No compiled module of the workbench calls a `basehalf.video.provider.*`
    command, and the extension host of a window that generates has no AI
    Video extension.
12. The repository has no plugin workflow, plugin package, or plugin
    infrastructure definition, and no source file of the plugin platform.

## Verification

- Unit tests of the extension allowlist and the install policy (criteria 7
  and 8), and of the product configuration (criterion 6, first half).
- A unit test that scans every compiled module for a call of a provider
  command (criterion 11, first half). The smoke step
  `video-requests-from-provider-service` reads the extension host's log for
  the second half, and the log of the provider service for the requests it
  sent (criterion 10).
- The smoke asserts the three Activity Bar items and the missing command, and
  runs the generation card flows on a fresh profile (criteria 3, 4, and 10).
- A packaged macOS arm64 build for criteria 1 and 2:
  `npm run basehalf:package:layout-check -- --app <application>` checks the
  packaged layout and the packaged product configuration, and the smoke's
  `--packaged-app <application>` option runs the same slices against the
  packaged build.
- Manual checks for criterion 5 and for the second half of criterion 6, and a
  text search of the user-visible strings for criterion 9.
- A search of the repository for criterion 12.

## Where this lands

Paths are under `vscode-base/` unless they start with a dot.

- AI Video's own code since D75: the provider service under
  `src/vs/platform/basehalfProviders/`, and the Video Sequence and starter
  template under `src/vs/workbench/basehalf/sequence/`.
- The registries that BaseHalf's features fill, under
  `src/vs/workbench/basehalf/`: canvas templates in
  `canvas/common/basehalfCanvasTemplateRegistry.ts`, Card Detail projections
  in `cardDetail/common/basehalfCardDetail.ts`, and the capabilities agents
  read in `agentArea/common/basehalfAgentCapabilities.ts`. Project file
  transitions with their upstream guard are in
  `workspace/common/basehalfProjectFileTransitions.ts`.
- The extension allowlist and the install policy:
  `basehalfAllowedExtensionsService.ts` and `basehalfExtensionInstallPolicy.ts`
  in `src/vs/workbench/basehalf/shell/common/`, beside the product profile
  that lists the allowed extension families, and
  `platform/extensionManagement/common/basehalfExtensionGalleryPolicy.ts` for
  the extension server outside the window.
- Packaging: the repository has no AI Video extension, so
  `build/gulpfile.vscode.ts` ships none, and it copies no payload folder.
  `scripts/basehalf-package-layout-check.mts` checks a packaged build.
- Sidebar: `BASEHALF_PRIMARY_VIEW_CONTAINERS` in
  `basehalfWorkbenchProfile.ts`.
- Links and stock commands that used to open the Plugin Library do nothing:
  `handleURL` in `contrib/extensions/browser/extensionsWorkbenchService.ts`,
  and `extension.open` and `_extensions.manage` in `extensions.contribution.ts`.
- Product configuration: `product.json` has no `basehalfPlugins` block and no
  registry entry under `extensionsGallery`.

## Resolved during implementation

1. When a profile copy and a built-in copy of one extension both exist, the
   extension scanner keeps the built-in copy if the profile copy has the same
   or a lower version, and the profile copy if it is higher (`dedupExtensions`
   in `src/vs/platform/extensionManagement/common/extensionsScannerService.ts`).
   Since D75 there is no built-in copy of AI Video, and a profile copy does
   not run (rule 14).
2. The user-visible strings that named plugins were the two messages for an
   unfinished template setup, the empty state of Models & Providers, the
   three status lines of a file-specific Card Detail view, the refusal to
   install an extension, the reason an extension does not run, a cleanup
   error, four lines of the release notes, and, until D76, the refusal of
   the extension server to install from the gallery.
3. VS Code's check that an extension uses only the API proposals it declares
   (`isProposedApiEnabled`) stays as VS Code has it from 1.141.0 on. The
   import commit returned `true` there, so this one line is not the import
   commit's code (`vscode-base/BASEHALF_UPSTREAM.md`).
