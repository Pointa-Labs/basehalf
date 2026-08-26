# Video node model picker surface specification

Status: active implementation work package, version 2

Last updated: 2026-08-25

Implementation readiness: reviewed; no blocking product or engineering questions

Parent specification: [Video node development specification](video-node-development-spec.md)

Composer UI specification: [Video node Composer surface specification](video-node-composer-surface-spec.md)

Semantic model specification: [Video node model selection and settings specification](video-node-model-settings-spec.md)

Owning product contract: [AI Video domain contract](product-contract.md)

## 1. Authority and delivery boundary

This work package defines the desktop UI and interaction contract for the
Video Composer's model trigger and Models popover. It exists because the
general Composer contract and the semantic model contract did not constrain
the row width budget, overflow behavior, state affordances, and activation
transition precisely enough to prevent an unusable narrow list.

The documents divide responsibility as follows:

1. the domain contract owns host, plugin, graph, lifecycle, credential, and
   Result boundaries;
2. the parent specification owns the shared Video-node journey;
3. the semantic model specification owns catalog projection, exact model
   identity, row-state calculation, connection return, and reconciliation;
4. the Composer specification owns the main Composer, generic child-popover
   placement, stacking, and one-layer dismissal;
5. this specification owns the Models trigger, Models-popover dimensions,
   internal layout, row rendering, scrolling, type-ahead, focus, and activation
   transitions.

When the older Composer or model/settings documents summarize Models behavior,
this document is authoritative for the detailed picker surface. In particular,
it supersedes older wording that keeps Models open after choosing an available
model. A successful available-model choice closes Models and returns feedback
to the Composer.

This package consumes immutable semantic row presentations. It must not infer
capabilities, connection state, or execution identity from labels, CSS classes,
icons, or localized text.

## 2. Problem statement and required outcome

The failure that motivated this specification has these visible symptoms:

- the 224-pixel popover exists, but each row reserves a large trailing status
  column, leaving only a few characters for the model label;
- ordinary capability metadata wraps into additional lines inside a fixed
  48-pixel row;
- text from adjacent rows overlaps because row height and content height no
  longer agree;
- headings, notices, or underlying Composer text can visually compete with the
  list;
- the result is technically clickable but not readable or reviewable.

This package is complete when a developer can prove all of the following:

- the canonical 224-pixel Models popover presents a readable icon, one-line
  label, one-line metadata summary, and compact trailing state affordance;
- no ordinary row wraps, overlaps another row, or reserves width for a hidden
  state sentence;
- state words remain available to assistive technology and tooltips without
  consuming the row's content track;
- selected, available, connection-required, and unavailable presentations
  remain visually and semantically distinct;
- opening, type-ahead navigation, selection, connection routing,
  catalog refresh, and dismissal have explicit focus behavior;
- canvas zoom never scales the picker, and node or viewport geometry never
  compresses its internal row layout;
- narrow canvas, 200% text zoom, long localized labels, non-overlay scrollbars,
  high contrast, loading, empty, and error states remain usable;
- tests assert real layout rectangles and overflow, not only class names or
  localized strings.

## 3. Design direction

This is a compact workbench control, not a marketing surface or permanent
inspector. It keeps the existing workbench theme and component language.

Design calibration:

| Dial | Value | Consequence |
| --- | ---: | --- |
| layout variance | 2/10 | stable vertical list, predictable alignment |
| motion intensity | 2/10 | opening and closing feedback only |
| visual density | 8/10 | two readable lines per row, minimal decoration |

The picker uses one neutral elevated surface, one existing focus accent, and
the Composer's radius family. It does not introduce a new component library,
font, color palette, gradient, glass treatment, or icon family.

Focused desktop observation on 2026-08-25 established the following useful
interaction facts without making the observed product authoritative:

- the picker is approximately 224 CSS pixels wide and aligns with the model
  trigger;
- each ordinary row uses a small leading mark, a model label, a compact second
  line, and at most one trailing state icon;
- the selected row uses a full-row fill and trailing check;
- the list scrolls internally at a compact maximum height;
- choosing an available model closes the list and updates the Composer;
- the popover remains screen-space chrome while the canvas is zoomed out.
- a long catalog remains a direct, internally scrolling list without a visible
  search field;
- choosing a different model immediately rebuilds model-owned input slots,
  Settings controls, summary values, and price evidence.

Those observations are adopted only where they fit BaseHalf's catalog,
connection, accessibility, and Draft ownership contracts.

## 4. Surface state and typed intents

Picker state is transient host memory:

```ts
type VideoModelPickerPhase =
  | 'closed'
  | 'open'
  | 'activating'
  | 'navigating-connection';

interface VideoModelPickerSurfaceState {
  phase: VideoModelPickerPhase;
  sceneKey: string;
  nodePath: string;
  nodeId: string;
  focusedLogicalKey?: string;
  typeaheadBuffer: string;
  scrollTop: number;
  placement?: 'above' | 'below';
  catalogEpoch: number;
}

type VideoModelPickerIntent =
  | { kind: 'select'; logicalKey: string }
  | { kind: 'connect'; logicalKey: string }
  | { kind: 'dismiss'; reason: 'trigger' | 'escape' | 'outside' | 'geometry' | 'selection-change' };
```

The production names may follow local conventions, but the integration must
route semantic intents. It must not decide behavior by matching visible status
copy, provider names, model ids, or icon class names.

Type-ahead text, focus, scroll position, hover, placement, and activation phase are not
saved to the `.bhnode`, graph, history, configuration, or credential store.

## 5. Model trigger

The model trigger remains the leading control in the Composer footer:

- height: 28 CSS pixels;
- minimum content width: 72 CSS pixels;
- maximum width: 152 CSS pixels in the canonical Composer;
- leading mark: 14 CSS pixels;
- gap from mark to label: 6 CSS pixels;
- label: one line with trailing ellipsis;
- no chevron;
- complete current label and state in `aria-label` and focus tooltip;
- `aria-haspopup="dialog"`, `aria-expanded`, and `aria-controls` reflect the
  actual Models surface.

The trigger shows **Choose model** when no exact selection exists. Connection
required or unavailable state uses one compact leading or trailing icon and
accessible text. It never replaces the trigger with a multi-line error or an
internal engineering task.

Activating the closed trigger opens Models. Activating the open trigger closes
Models and leaves focus on the trigger. Opening Models while another Composer
child is open replaces that child in one state transition.

## 6. Canonical popover geometry

All values are CSS pixels at 100% text zoom and are independent of canvas zoom.

| Token | Value | Contract |
| --- | ---: | --- |
| outer width | 224 px | canonical width, including border |
| maximum height | 320 px | list scrolls internally |
| placement viability threshold | 160 px | used only to choose above/below placement; it is not a CSS minimum height |
| outer padding | 6 px | all sides |
| border | 1 px | included in the 224-pixel measurement |
| outer radius | 14 px | matches Composer surface family |
| trigger gap | 6 px | measured from trigger edge |
| viewport margin | 8 px | final horizontal and vertical clamp |
| ordinary row height | 48 px | exact border-box height |
| exceptional row minimum | 58 px | may grow only for a visible connection or unavailable reason |
| row radius | 9 px | full-row hit target |
| row horizontal padding | 7 px | inside row border |
| row vertical padding | 6 px | ordinary row |

The popover uses `box-sizing: border-box`, `min-width: 0` on every flex/grid
descendant, and an opaque workbench widget surface. Underlying prompt,
Composer, card, or canvas text must not show through the list.

Models has no visible title bar, generic instruction paragraph, close button,
Apply button, or footer. A visually hidden heading supplies the dialog name.
The Composer continues to own the primary Draft blocker. Models may add visible
copy above the list only for a picker-scoped activation failure, stale exact
selection, or catalog failure that cannot be attached to one row. Such copy is
in normal layout flow, wraps inside the content box, and cannot overlay or
compress the first row.

The 224-pixel width is never derived from:

- selected-card width;
- Composer responsive width;
- canvas zoom;
- model-trigger width;
- the longest model label;
- the visible state sentence;
- provider or capability count.

If the canvas viewport is narrower than 240 CSS pixels, the emergency width is
`viewport width - 16 px`. Section 15 defines content degradation for that case.
No other condition may shrink the canonical popover.

## 7. Ordinary row width budget

An ordinary row is one full-width button with no nested buttons. Its internal
grid is normative:

```text
| 7 | 18 mark | 8 | minmax(0, 1fr) copy | 6 | 16 state | 7 |
```

The tracks mean:

1. **mark**, exactly 18 pixels, carries the model/provider mark;
2. **copy**, the only flexible track, carries label and metadata;
3. **state**, exactly 16 pixels, carries at most one icon;
4. the 8- and 6-pixel values are column gaps;
5. the two 7-pixel values are row padding.

At canonical width, after popover padding, borders, and a non-overlay scrollbar
budget, the copy track must retain at least 120 CSS pixels. Tests must measure
this track. A CSS change that reduces it below 120 pixels is a contract failure
even if the row still has a tooltip.

The state track must not have a `min-width` greater than 16 pixels. Hidden,
hover-only, or selected state text must not participate in layout. In
particular, the implementation must not reserve a 60- to 80-pixel column for
words such as Available, Connect, or Selected.

The state sentence belongs in the button's accessible name, description, or
focus tooltip. If a state needs visible explanatory prose, it uses the
exceptional-row reason defined in section 8. It never expands the ordinary
state track.

## 8. Row anatomy and overflow

### 8.1 Ordinary row

The flexible copy track has exactly two visual lines:

1. model label, 11-pixel semibold, one line;
2. compact capability/disambiguation summary, 10-pixel muted text, one line.

Both lines use `white-space: nowrap`, `overflow: hidden`, and
`text-overflow: ellipsis`. They never wrap. The copy track clips its own
contents and cannot paint into the mark or state tracks.

Capability tokens may retain a quiet token treatment, but the token container
is a single non-wrapping line. It may show at most three short tokens in this
priority order:

1. highest executable reviewed resolution;
2. reviewed duration range;
3. concise executable method or native-audio token when material.

Lower-priority tokens remain in the row's complete accessible description.
They do not create a third line, horizontal scrollbar, or wider popover.

Provider or deployment text appears only when the semantic projection requires
disambiguation. It occupies the same second line and is shortened before the
model label is hidden.

### 8.2 Exceptional row

Connection-required and Unavailable rows may expose one visible reason beneath
the label. The reason:

- uses the copy track, never the state track;
- wraps to at most two lines;
- is complete in accessible description and focus tooltip when visually
  clamped;
- increases row height naturally from a 58-pixel minimum;
- cannot overlap the next row;
- retains the same mark and 16-pixel trailing-state tracks.

A Connection-required row is ordinary by default. Its concrete action is
expressed by the lock icon, accessible name, and focus tooltip. It becomes
exceptional only when the connection itself needs attention and the user must
understand whether the next action is **Connect** or **Reconnect**.

### 8.3 Trailing state affordance

Exactly one of these affordances occupies the 16-pixel state track:

| Availability and selection | Visible affordance | Activation |
| --- | --- | --- |
| available and selected | full-row selected treatment plus check | close Models without mutation |
| available and not selected | empty state track | select exact model |
| connection required | lock | start the exact Connect or Reconnect flow |
| unavailable | unavailable icon | disabled; choose another row |

Selection is an independent trait, not a fifth availability state. A selected
connection-required or unavailable row retains the full-row selected treatment
but gives the 16-pixel track to the lock or unavailable icon; its accessible
name still says that it is the current selection. Available rows do not show an
unlock icon merely to fill the track.

## 9. Grouping, type-ahead, and list structure

The list preserves the semantic model specification's deterministic order.
Scope headings render only when more than one scope must be disambiguated.

- provider heading: 11-pixel semibold, one line, 4/7/3 pixel block padding;
- connection-scope heading: 10-pixel muted, one line, 2/7/3 pixel block
  padding;
- heading overflow: ellipsis plus complete accessible label;
- gap between ordinary rows: 0 pixels inside a scope;
- gap between scope groups: 5 pixels;
- gap between provider groups: 9 pixels.

The first implementation has no visible search field, result mode, or pinned
search section. This keeps the model choice a direct compact menu and matches
the observed desktop interaction. While a row owns focus, printable-key input
performs locale-aware prefix type-ahead against the model label and required
disambiguation label. The transient buffer clears after 700 milliseconds and
never mutates the Draft. A later visible search field is a separate product
change and must update this specification before implementation.

The model list owns vertical scrolling. It has no horizontal scrolling.
`overscroll-behavior: contain` prevents terminal wheel or trackpad delta from
panning or zooming the canvas. A non-overlay scrollbar may consume its reserved
budget but may not reduce the copy track below the 120-pixel canonical minimum.

## 10. Open, focus, and selected-row reveal

Opening Models performs one layout transaction:

1. read the latest semantic projection and exact selected logical key;
2. create one popover in the Composer overlay root;
3. measure trigger, popover, and canvas viewport after layout;
4. place and clamp it using section 11;
5. scroll the selected row fully into view without moving the canvas;
6. focus the selected actionable row;
7. when there is no selected actionable row, focus the first enabled row;

Focus is restored by stable logical key, not provider/model label or DOM node
identity. Opening must not focus a disabled row, scroll the canvas, recreate
the prompt textarea, or select text in the prompt.

Rows use roving tab index. `ArrowUp`, `ArrowDown`, `Home`, and `End` move among
visible enabled rows and reveal the target inside the list. `Enter` and `Space`
activate the focused row. Navigation does not wrap from the last row to the
first or from the first row to the last; the edge key remains at the edge.

## 11. Placement and stacking

Models consumes the Composer specification's screen-space placement algorithm:

1. prefer above the footer when the Composer is below its card;
2. prefer below when the Composer is near the top viewport edge;
3. flip only when the preferred side cannot provide the smaller of desired
   height and 160 pixels and the other side has more room;
4. align the popover's leading edge with the model trigger when possible;
5. clamp to the 8-pixel canvas-viewport margin;
6. reduce available height and scroll internally;
7. never reduce width except for the under-240-pixel emergency viewport;
8. never pan the canvas, resize the card, or resize the Composer.

The popover renders in the Composer-owned screen-space overlay root. It must
not inherit the canvas transform. Its z-index is above cards and Composer
content and below workbench menus, Quick Input, dialogs, and notifications.
It has no backdrop and does not dim the canvas.

## 12. Activation transitions

### 12.1 Selected row

Activating the already selected exact row performs no model or settings
mutation. It closes Models and returns focus to the model trigger.

### 12.2 Available row

Activating an Available row:

1. enters `activating` and rejects re-entrant activation;
2. resolves and reconciles the exact model through the semantic package;
3. commits the one in-memory Draft transaction;
4. updates the model trigger, Settings summary, input projection, blocker, and
   reconciliation notice in one semantic render;
5. closes Models;
6. returns focus to the model trigger;
7. announces the selected model and any reconciliation count through the
   Composer's polite status region.

The activation does not save, create an Attempt, call a provider, remove an
edge, relabel an input role, pan the canvas, or open Settings automatically.
The user can review the updated summary and open Settings explicitly.

If reconciliation fails before commit, Models remains open, the same logical
row keeps focus, and an inline picker problem appears without clearing the
list. There is no partial Draft mutation.

### 12.3 Connection-required row

Activating a connection-required row:

1. checkpoints only valid Draft fields through the parent contract;
2. closes Models before navigation;
3. creates the exact one-shot connection intent;
4. enters the matching connection surface;
5. on cancellation, returns to the same Draft and model trigger without
   selecting the connection-required model;
6. on exact successful return, applies the model and opens Settings according
   to the semantic connection-return contract.

### 12.4 Unavailable and stale selected rows

Unavailable is disabled. Pointer, Enter, and Space create no mutation or
navigation. Its visible reason and accessible description remain reviewable.
When the saved exact model has disappeared from the current catalog, Models
pins one synthetic current-selection row above the catalog. It is selected and
unavailable, says that the model is no longer available, and instructs the user
to choose another model from the same list. The row has no generic corrective
action, never maps itself to a similarly named revision, and never changes the
Draft automatically.

## 13. Dismissal and canvas interaction

| Event | Models result | Focus result |
| --- | --- | --- |
| click open trigger | close | model trigger |
| Escape | close and stop propagation | model trigger |
| click another Composer trigger | replace in one state transition | new child target |
| click prompt or non-trigger Composer content | close only Models | clicked control |
| click selected card | close only Models | card/click target |
| click blank canvas | close, then parent checkpoint/dismiss path | parent selection contract |
| select another node | close before Composer moves | new selection contract |
| start node move or resize | close immediately | card gesture owner |
| start canvas pan or zoom | close immediately | canvas gesture owner |
| window or canvas resize | keep open only when a valid clamped placement remains | preserve logical row |
| selected card becomes off-screen | close before Composer suspension | selected card on later return |
| scene or immutable node identity changes | unmount | new surface owner |

Pointer activity beginning inside Models never starts node drag, node resize,
edge creation, box selection, or canvas pan. Wheel and trackpad activity inside
the list stays in the list. The event-routing layer must close exactly one
interaction layer and stop a single Escape or outside click from also
dismissing the Composer.

## 14. Catalog and asynchronous updates

Catalog and connection projections may refresh while Models is open. The
surface must reconcile without an empty flash:

- preserve placement side and scroll position when still valid;
- restore focus by logical key;
- if that key disappears, focus the nearest enabled row in reviewed order;
- if no enabled row remains, focus the trigger;
- retain the selected row's exact identity until the semantic projection
  proves it current or unavailable;
- never map an old selected row to a new revision by display label;
- apply loading or error copy in normal document flow above or instead of the
  list, never absolutely over the rows;
- discard a stale asynchronous completion whose scene, node id, catalog epoch,
  or activation token no longer matches.

An activating row may show a small progress affordance in the 16-pixel state
track. The row remains 48 pixels high and the other rows do not shift.

## 15. Responsive, localization, and text zoom behavior

The canonical 224-pixel width remains at canvas widths of 240 CSS pixels or
greater, including at 200% text zoom. Canvas zoom never affects it.

At an emergency width below 224 pixels, content degrades in this order:

1. keep the full-row hit target and 16-pixel state affordance;
2. keep the one-line model label;
3. collapse capability tokens into one ellipsized summary string;
4. omit nonessential disambiguation already present in a visible group
   heading;
5. keep the leading mark unless the copy track would fall below 72 pixels;
6. if necessary, omit the visual mark while retaining it in accessible text.

The state icon and model label are never both removed. The row never wraps,
overlaps, or creates horizontal page/canvas scrolling.

At 200% text zoom:

- ordinary rows may grow from 48 to the minimum height required for two
  non-overlapping lines;
- the row grid and 16-pixel state-track rule remain;
- the popover height remains capped by available viewport height;
- every focused row is scrollable into view;
- labels may ellipsize but must remain available in accessible name and focus
  tooltip.

Right-to-left localization mirrors leading/trailing alignment while preserving
the same width budget. Long translated state words never become visible row
columns. High-contrast themes retain visible selected, focus, disabled, and
warning boundaries without relying on background fill alone.

## 16. Appearance and motion

Models uses workbench theme tokens for surface, foreground, secondary text,
hover, selection, focus, disabled, warning, border, and shadow. Hard-coded dark
surfaces or white text are forbidden because the picker must work in light,
dark, and high-contrast themes.

Visual states:

- rest: transparent row, readable primary and secondary text;
- hover: low-contrast full-row fill;
- keyboard focus: focus border in addition to any fill;
- selected: distinct low-contrast fill; an available selected row also uses a check;
- disabled: reduced contrast while reason remains readable;
- connection required or unavailable: icon and boundary, not color alone;
- active press: at most a subtle scale or one-pixel translation that does not
  reflow neighboring rows.

Open/close motion is limited to opacity and a 4-pixel vertical translation over
120 milliseconds. `prefers-reduced-motion` removes the transition. Type-ahead,
focus movement, and row selection do not animate height or width.

## 17. Loading, empty, and error states

The picker must support these complete states:

| State | Presentation | Available action |
| --- | --- | --- |
| initial catalog loading | three 48-pixel row skeletons using final row geometry | dismiss only |
| no reviewed models installed | compact empty copy in list body | open plugin/model management when a complete operation exists |
| catalog failed | sanitized inline error, no stale actionable rows | Retry catalog read when supported |
| selected identity disappeared | pin selected unavailable row above the current catalog | choose another model |
| connection projection requires attention | keep rows and mark the exact row connection required | Connect or Reconnect |
| activation failed | keep list and focused row, inline sanitized reason | retry activation or choose another row |

Skeletons and messages participate in normal layout. They cannot overlay rows,
escape the popover, expose provider response bodies, or leave an invisible
focusable list behind.

## 18. Accessibility contract

- The Models surface is a named, non-modal dialog owned by the model trigger.
- The row collection exposes listbox or equivalent single-choice semantics
  consistent with the host component pattern.
- Each row has one accessible name containing model label, concise capability
  summary, semantic state, and action.
- Disabled and connection-required reasons use accessible description, not only
  `title`.
- Selection uses `aria-pressed` or the chosen single-choice equivalent plus a
  visible full-row treatment. An available selected row also uses a check.
- Status announcements use the Composer's single polite live region. Row focus
  does not announce the entire list again.
- The full row is the minimum pointer target. No tiny nested lock or check is a
  separate target.
- Focus never lands on decorative provider marks, capability tokens, or state
  icons.
- Closing restores focus only when the initiating context still exists and is
  not superseded by a new card or workbench selection.

## 19. Implementation boundary

This package owns implementation changes only in the Composer integration and
its layout tests:

- `src/vs/workbench/basehalf/browser/basehalfCanvasWorkbench.contribution.ts`,
  only for Models trigger, picker rendering, typed activation, and event
  routing;
- `src/vs/workbench/basehalf/browser/media/basehalfCanvasWorkbench.css`, only
  for Models trigger/popover/row selectors;
- `src/vs/workbench/basehalf/browser/basehalfNodeLocalSurface.ts` and its test,
  only when the reusable popover projection lacks a required geometry token;
- `src/vs/workbench/basehalf/test/browser/basehalfCanvasWorkbench.test.ts`, for
  DOM, focus, activation, and semantic integration;
- `scripts/basehalf-smoke.mts`, for compiled workbench acceptance.

Read-only semantic dependencies:

- `basehalfVideoModelSettingsPresentation.ts` and its tests;
- `basehalfVideoModels.ts` and catalog services;
- provider connection catalogs and services;
- input, execution, Attempt, and Result modules.

If the immutable row projection lacks a semantic field required here, update
the semantic model specification before changing its public interface. Do not
rederive semantic state in the renderer or add provider/model branches to CSS
or DOM code.

## 20. Acceptance matrix

| Scenario | Required proof |
| --- | --- |
| P1 canonical popover is 224 by at most 320 CSS pixels | computed bounding-rect component test |
| P2 canvas zoom at 50%, 100%, and 200% never scales popover or row dimensions | screen-space overlay test plus Electron screenshots |
| P3 ordinary row is exactly 48 pixels at 100% text zoom | bounding-rect test for every visible ordinary row |
| P4 canonical copy track remains at least 120 pixels with a non-overlay scrollbar budget | computed grid/child-rect test |
| P5 trailing state track is at most 16 pixels and contains no laid-out state sentence | DOM rect and overflow assertion |
| P6 long model, provider, capability, and translated state labels never wrap or overlap | long-fixture screenshot and pairwise row-rect assertions |
| P7 selected, hover, focus, connection-required, and unavailable presentations remain distinct | theme/high-contrast DOM and screenshot tests |
| P8 open scrolls selected row fully into view and focuses by logical key | scroll/focus component test |
| P9 Arrow/Home/End navigation stays in visible enabled rows and contains scroll delta | keyboard and wheel-routing test |
| P10 printable-key type-ahead moves focus by model label and clears after its timeout | component test |
| P11 choosing Available commits once, closes Models, restores trigger focus, and updates summaries | integration test with mutation count and DOM identity |
| P12 choosing selected closes without mutation | integration test |
| P13 Connect checkpoints and navigates exact intent; cancel never selects | connection-navigation integration test |
| P14 a missing saved identity remains selected and unavailable while Connect/Reconnect uses the exact connection flow | component and service test |
| P15 activation failure keeps picker, row focus, and pre-transaction Draft | failure injection test |
| P16 catalog refresh preserves focus/scroll or chooses deterministic fallback | asynchronous component test |
| P17 node move/resize and canvas pan/zoom close Models before geometry changes | pointer/geometry integration test |
| P18 placement flips/clamps without width compression, canvas pan, or Composer resize | placement test near every viewport edge |
| P19 200% text zoom and 320-pixel canvas remain readable and reachable | Electron accessibility smoke |
| P20 underlying Composer/card text never bleeds through the opaque popover | light/dark/high-contrast screenshot test |
| P21 opening, navigating, choosing, and closing preserve prompt DOM/value/selection/IME | DOM identity and composition test |
| P22 loading, empty, error, and retry states use normal flow and leave no hidden focus target | state-cycle component test |

Pairwise row-rect assertions must verify `row[n].bottom <= row[n + 1].top` for
all visible rows. A screenshot comparison alone is not sufficient proof of no
overlap.

## 21. Implementation sequence

### P1. Surface and row geometry

- isolate Models width and height tokens from card/Composer/canvas transforms;
- implement the exact three-track row grid and remove any long state-text
  width reservation;
- make ordinary label and metadata lines non-wrapping;
- add copy-track, state-track, row-height, opacity, and pairwise-overlap tests.

Exit: the motivating narrow, stacked-row failure is impossible under canonical
fixtures and long-label fixtures.

### P2. Focus, type-ahead, and activation

- implement selected-row reveal, non-wrapping keyboard navigation, and
  prefix type-ahead;
- close after available or selected activation and restore trigger focus;
- route Connect and Reconnect through one typed semantic intent;
- preserve prompt DOM and reject re-entrant activation.

Exit: P8-P16 and P21 pass without a provider credential or paid request.

### P3. Geometry, themes, and smoke

- verify above/below placement and horizontal clamp;
- close before move/resize/pan/zoom;
- cover narrow canvas, 200% text zoom, non-overlay scrollbar, light, dark,
  high-contrast, reduced-motion, loading, empty, and error states;
- add compiled Electron screenshot and pointer smoke.

Exit: every acceptance row has automated proof or a recorded manual check.

## 22. Verification commands

From `vscode-base/` after implementation:

```bash
npm run compile-client
npm run typecheck-client
npm run test-node -- --run src/vs/workbench/basehalf/test/common/basehalfVideoModelSettingsPresentation.test.ts
npm run test-node -- --run src/vs/workbench/basehalf/test/browser/basehalfNodeLocalSurface.test.ts
npm run test-node -- --run src/vs/workbench/basehalf/test/browser/basehalfCanvasWorkbench.test.ts
npm run basehalf:smoke
```

The Electron smoke uses a disposable fixture workspace and fake process-only
catalog/connection seams. It creates no credential and no paid provider task.

For this documentation change, run from the repository root:

```bash
git diff --check
cmp -s AGENTS.md CLAUDE.md
```

Also resolve every new relative Markdown link and scan the changed documents
for restricted product names before handoff.

## 23. Explicit delete/keep boundary

Delete or replace during implementation:

- any trailing model-state column wider than 16 pixels;
- hidden state text that still participates in row layout;
- ordinary capability-token wrapping;
- fixed-height ordinary rows whose content can wrap underneath the next row;
- row-state hover text that changes track width;
- picker width derived from card, Composer, trigger, or canvas zoom;
- available-model selection that leaves Models open;
- looping Arrow navigation that unexpectedly jumps between list ends;
- tests that assert only class names without checking geometry and overflow.

Keep:

- semantic availability-plus-selection projection and exact logical keys;
- reviewed catalog order, conditional grouping, type-ahead, and pinned stale
  selected-row semantics;
- generic Composer overlay root and placement algorithm;
- one-child-popover exclusivity and parent dismissal routing;
- workbench theme and focus tokens;
- exact connection return, Draft reconciliation, and input-preservation rules;
- stable prompt textarea and screen-space Composer ownership.
