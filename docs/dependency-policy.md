# Dependency & license policy

Why this exists: BaseHalf is open source (Apache-2.0) **and** intended to be
commercialized (open-core). Both depend on us being able to **relicense** the
code and ship proprietary editions. A single incompatible dependency can break
that. This policy keeps the dependency tree clean. It also operationalizes a
rule we already committed to legally: the founder CIIAA (§2.9) forbids pulling
copyleft code into company software.

## License categories

| Category | Licenses | Rule |
|---|---|---|
| ✅ **Allowed** | MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0, Unlicense, public domain | Use freely. |
| ⚠️ **Review needed** | MPL-2.0, LGPL-2.1/3.0 (weak copyleft); CC-BY-4.0 for what is not code (fonts, icons) | Allowed only after a maintainer reviews *how* it's used. Modifications to MPL files must stay open; LGPL must stay dynamically linked/replaceable; CC-BY needs its attribution in the notices that ship. An accepted package is an exception by name and version in the CI check, not a license added to the allowlist. |
| ⛔ **Not accepted** | GPL, AGPL, SSPL, BSL/BUSL, Elastic License, **and any "source-available" / non-commercial license** | These either force us to open-source proprietary code or require a separate commercial license — both kill relicensing/commercialization. |

When in doubt, open an issue before adding the dependency.

## Canvas / editor stack (the libraries we actually use)

[D8](decisions.md) covers the production stack decision. The picks below are
locked in; the rest are kept here as license guidance for anything else that
gets considered.

**Locked-in for v0:**

| Library | Role | License | Status |
|---|---|---|---|
| **React Flow** (`@xyflow/react`) | Canvas (free-position + edges) | MIT | ✅ Locked in |
| **BlockNote** | Block editor (Notion-style; MD round-trip) | MIT | ✅ Locked in |
| **EmbedPDF** (`@embedpdf/core`, `@embedpdf/engines`, `@embedpdf/plugin-*`, `@embedpdf/pdfium`) | The engine and headless parts under BaseHalf's own PDF reader (D135); bundles PDFium WASM | MIT (PDFium: Apache-2.0) | ✅ Locked in |
| **Preact** (`preact`) | The components of EmbedPDF's headless parts that draw the pages of the PDF reader | MIT | ✅ Locked in |
| **foliate-js** | Book reader: EPUB, MOBI, KF8, FictionBook, comic book archives (D81). Taken from its author's repository at a fixed commit; the npm package of that name is someone else's | MIT (with zip.js: BSD-3-Clause, fflate: MIT) | ✅ Locked in |
| **VS Code workbench services** | Files, watching, working copies, UI state | MIT | ✅ Lower application substrate |

**Other vetted libraries (reference for future decisions):**

| Library | License | Verdict |
|---|---|---|
| **tldraw** | "tldraw license" — source-available, requires a commercial license for production use | ⛔ Not compatible with our Apache-2.0 + open-core path; we use React Flow instead. |
| **Excalidraw** (`@excalidraw/excalidraw`) | MIT | ✅ OK if we ever need free-form sketch (different from React Flow's node/graph). |
| **Konva** / **Fabric.js** | MIT | ✅ Lower-level 2D canvas. |
| **maxGraph** | Apache-2.0 | ✅ Diagramming. |
| **`@vscode/vsce-sign`** | Microsoft Software License Terms: "only with" Microsoft's products | ⛔ Must not ship. BaseHalf verifies no signature of an extension instead (D122). |
| **BlockSuite** | MPL-2.0 (weak copyleft) | ⚠️ OK with care — but we picked BlockNote instead (smaller, Notion-shaped, MIT). |
| **ProseMirror / Tiptap** | MIT | ✅ Underlying engine — BlockNote sits on top. |
| **Yjs** | MIT | ✅ Local per-file rich-editor projection; multi-user sync remains deferred (D6). |
| **pdf.js** | Apache-2.0 | ✅ Safe renderer fallback, but not the product viewer; a direct integration would require rebuilding the viewer UX EmbedPDF already supplies. |
| **chokidar / Zustand** | MIT | ✅ Safe libraries, but retired from desktop orchestration now that BaseHalf runs on VS Code's native file and workbench services. |
| **SQLite** | Public domain | ✅ Reserved for the >5k-files-in-workspace storage swap (D8). |
| **Tantivy** (Rust) | MIT/Apache | ✅ Reserved for v1+ full-text search if needed. |

## Reviewed exceptions

Packages outside the allowlist that a maintainer has reviewed. Each is named
with its version in the CI check, so a new version is reviewed again
([D160](decisions.md)).

| Package | License | How BaseHalf uses it | What the license asks, and where it is met |
|---|---|---|---|
| **jschardet** 3.1.4 | LGPL-2.1+ | VS Code's guess of a file's encoding (`src/vs/workbench/services/textfile/common/encoding.ts`). The library is not changed and not bundled: it ships as the separate file `node_modules/jschardet/dist/jschardet.min.js`, loaded when a file's encoding is guessed, and can be replaced by another build of it | A notice that the library is used and under which license, and the license's text: its entry in `ThirdPartyNotices.txt` and the `LICENSE` beside the library, both in the application. That the user may replace the library and study the program to that end: no terms of BaseHalf's may forbid it. The license does not reach BaseHalf's own code |
| **@vscode/codicons** 0.0.46-21 | CC-BY-4.0 (the font; its code is MIT) | The icon font of the workbench | Attribution: the entry `vscode-codicons` in `ThirdPartyNotices.txt`, which is VS Code's and names the version VS Code recorded, 0.0.46-0 |

Reviewed by the owner on 2026-11-27. Neither stands in the way of a
commercial or closed edition: LGPL-2.1 binds the library, and CC-BY-4.0 allows
commercial use. This is the project's reading of the licenses, not legal
advice.

**Hard rule:** if a candidate requires a commercial license (tldraw), **replace
it with a permissive one** (React Flow or Excalidraw, both MIT). We'd rather
switch libraries than take on a commercialization blocker.

## Process

1. **Propose** a new runtime dependency in an issue; note its license.
2. CI runs **`license-check`** ([.github/workflows/license-check.yml](../.github/workflows/license-check.yml))
   and fails the PR on anything outside the ✅ allowlist. It checks the
   production dependencies of the product, from `package.json` at the root,
   which are what runs from `node_modules` in the application, and those of
   `packages/install/`.
3. To add a ⚠️ review-needed dependency, a maintainer adds it to
   [the reviewed exceptions](#reviewed-exceptions) and, by name and version,
   to `--excludePackages` in that workflow, in the same PR.
4. `ThirdPartyNotices.txt` at the root ships in the application. It is VS
   Code's list of what its source incorporates, and holds an entry for each
   reviewed exception whose license asks for a notice. The other packages in
   `node_modules` ship with their own license files.
5. What runs from `node_modules` goes in `dependencies`. What a bundle takes in when
   it is built goes in `devDependencies`, with its notices beside the bundle
   ([what the package holds](specs/what-the-package-holds.md)). Only what is declared
   ships: a package that merely lies in `node_modules` does not.

Dev-only tooling (test runners, linters) is lower-risk but should still avoid
copyleft where it could leak into shipped artifacts.
