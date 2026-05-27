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
| ⚠️ **Review needed** | MPL-2.0, LGPL-2.1/3.0 (weak copyleft) | Allowed only after a maintainer reviews *how* it's used. Modifications to MPL files must stay open; LGPL must stay dynamically linked/replaceable. Add to the CI allowlist deliberately. |
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
| **pdf.js** | PDF rendering | Apache-2.0 | ✅ Locked in |
| **chokidar** | File watcher | MIT | ✅ Locked in |
| **Zustand** | Renderer state | MIT | ✅ Locked in |

**Other vetted libraries (reference for future decisions):**

| Library | License | Verdict |
|---|---|---|
| **tldraw** | "tldraw license" — source-available, requires a commercial license for production use | ⛔ Not compatible with our Apache-2.0 + open-core path; we use React Flow instead. |
| **Excalidraw** (`@excalidraw/excalidraw`) | MIT | ✅ OK if we ever need free-form sketch (different from React Flow's node/graph). |
| **Konva** / **Fabric.js** | MIT | ✅ Lower-level 2D canvas. |
| **maxGraph** | Apache-2.0 | ✅ Diagramming. |
| **BlockSuite** | MPL-2.0 (weak copyleft) | ⚠️ OK with care — but we picked BlockNote instead (smaller, Notion-shaped, MIT). |
| **ProseMirror / Tiptap** | MIT | ✅ Underlying engine — BlockNote sits on top. |
| **Yjs** | MIT | ✅ Reserved for v1 collaboration (D6). |
| **SQLite** | Public domain | ✅ Reserved for the >5k-files-in-workspace storage swap (D8). |
| **Tantivy** (Rust) | MIT/Apache | ✅ Reserved for v1+ full-text search if needed. |

**Hard rule:** if a candidate requires a commercial license (tldraw), **replace
it with a permissive one** (React Flow or Excalidraw, both MIT). We'd rather
switch libraries than take on a commercialization blocker.

## Process

1. **Propose** a new runtime dependency in an issue; note its license.
2. CI runs **`license-check`** ([.github/workflows/license-check.yml](../.github/workflows/license-check.yml))
   and fails the PR on anything outside the ✅ allowlist.
3. To add a ⚠️ review-needed dependency, a maintainer updates the allowlist in
   that workflow in the same PR, with a one-line justification.
4. Keep a `THIRD-PARTY-NOTICES.md` once we ship bundled dependencies (Apache-2.0
   §4 attribution).

Dev-only tooling (test runners, linters) is lower-risk but should still avoid
copyleft where it could leak into shipped artifacts.
