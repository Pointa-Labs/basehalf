# Video node inputs and temporal-frame specification

Status: active implementation work package, version 2

Last updated: 2026-08-24

Parent specification: [Video node development specification](video-node-development-spec.md)

Owning product contract: [AI Video domain contract](product-contract.md)

Implementation readiness: ready after the version 2 state-machine and Draft
checkpoint requirements below

## 1. Authority and purpose

This work package defines the implementable contract for Video-node inputs,
including named Start and End frame slots, ordinary bound inputs, canvas pick,
input reconciliation, explicit role changes, and the graph/undo transactions
that persist those operations.

The parent specification owns shared vocabulary, the complete Composer and
execution lifecycle, model and connection behavior, and cross-package
acceptance. The domain contract remains authoritative for the one reference
graph, target-owned input roles, host/plugin ownership, and sealed Results.
Within that boundary, this document owns the detailed input state model and
input mutations. It must not be used to create a second edge system or an
input-only lifecycle store.

If the documents appear to conflict, use this priority:

1. the domain contract for host/plugin, graph, and Result ownership;
2. the parent specification for shared Video-node behavior;
3. this work package for input presentation, reconciliation, and mutations.

## 2. Product decision: how Start and End relate to a model

Start and End frames are not global Video-node settings or independent
booleans. The dependency chain is:

`exact reviewed model -> selected executable generation method -> declared input roles`

The user may choose a frame-based method only when the exact selected model
declares that executable method. Choosing between methods is optional when the
model offers more than one; when a model offers one executable method, that
method is fixed. Once a frame method is selected, its declared frame roles are
requirements of that method, not optional decorations:

| Method | Named temporal slots | Readiness rule |
| --- | --- | --- |
| Text to Video | none | the method's prompt rule passes |
| Start Frame | Start only | exactly one accepted Start image and the prompt rule pass |
| Start + End Frames | Start then End | exactly one accepted image in each role and the prompt rule pass |

Therefore:

- a missing frame never makes a reviewed method unsupported;
- a model without Start + End Frames never renders those slots;
- attaching one or two images never selects or changes a method;
- removing End never downgrades Start + End Frames to Start Frame;
- switching models preserves a frame method only when the new exact model
  declares the same executable method;
- reference images are not temporal endpoints and never render as Start or End.

Executable `first-frame-to-video` and `first-last-frame-to-video` catalog
entries must declare exactly one allowed item for each temporal role they use.
The catalog/model package validates that invariant. This package consumes the
resolved capability and does not add renderer-owned capability flags. A future
optional media role with `minItems: 0` may use ordinary chips, but it must not
reuse the Start or End labels unless the shared method contract is versioned.

## 3. Goals

- Make the selected exact method the only source of visible active input slots.
- Let users select a valid frame method before its required inputs exist.
- Keep every existing edge and binding across model or method changes until the
  user performs an explicit input mutation.
- Make unresolved bindings visible, actionable, and blocking instead of
  silently deleting or relabelling them.
- Commit every input change together with its graph consequence as one
  reversible host transaction.
- Preserve a stable, inspectable binding order in the saved Draft and Attempt.
- Give the Composer a pure presentation model that can be tested without DOM
  text matching or canvas services.

## 4. Non-goals

- changing model discovery, model ordering, settings normalization, provider
  connection, paid-run authorization, execution, or Result sealing;
- storing an input role on a graph edge;
- allowing the same direct source path to occupy multiple roles in one Draft;
- automatically converting, duplicating, deleting, or importing an input;
- accepting unsaved canvas state, arbitrary local files, or remote URLs as a
  frame source;
- adding a file chooser to ordinary canvas pick;
- adding optional Start/End toggles independent of the selected method;
- implementing reference, video-edit, extension, audio, or multi-reference UI
  before its reviewed executable method is available;
- adding a second input-identity store or changing the Attempt snapshot schema;
  the optional binding identity fields defined in section 11 are the only
  persistence extension owned by this package.

## 5. Sources of truth and terminology

| Concern | Source of truth |
| --- | --- |
| active method and its input cardinalities | resolved reviewed model capability |
| whether a source kind is Recipe-compatible | admitted Recipe input definition |
| source identity, kind, saved revision, and integrity | host node/file inspection |
| direct reference existence | host reference graph |
| input role, order, and captured source identity/revision | target Draft's `recipe.inputBindings` |
| visible slots, chips, problems, and actions | pure input presentation derived from the sources above |
| pending canvas-pick request | transient selected-Composer state |
| undo/redo history | host canvas undo source and project-file transition services |

Terms specific to this package:

- **active role**: a role declared by the currently selected executable method;
- **binding**: `{ sourcePath, slot, order }` stored by the target Draft;
- **eligible source**: a saved, direct-input-compatible source that can fill the
  requested role without violating identity, kind, integrity, or capacity;
- **Needs review**: a visible group of retained bindings that cannot currently
  participate in generation without explicit user action;
- **input mutation plan**: a pure before/after description that the host first
  revalidates, then commits through one graph/document transaction;
- **canvas-pick request**: one transient request for one target node, requested
  role, and expected Draft revision.

## 6. Required pure input model

### 6.1 Module boundary

Create a provider-neutral common module that imports shared Video capability
types and generic node binding types but contains no DOM, service, provider,
catalog-id, model-id, or workspace I/O branches.

The module accepts already resolved data and derives immutable data suitable
for presentation and mutation planning. Its public contract must cover the
following semantics; exact TypeScript names may vary only when the final names
remain equally explicit:

```ts
type BaseHalfVideoFrameRole = 'first-frame' | 'last-frame';

type BaseHalfVideoBindingStatus =
	| 'active'
	| 'unused'
	| 'incompatible'
	| 'source-missing'
	| 'source-changed'
	| 'source-unverified';

interface IBaseHalfVideoInputSourceState {
	readonly sourcePath: string;
	readonly sourceId?: string;
	readonly title: string;
	readonly kind?: BaseHalfCanvasContentKind;
	readonly saved: boolean;
	readonly integrity: 'available' | 'missing' | 'changed' | 'unverified';
	readonly revision?: string;
}

interface IBaseHalfNodeInputBinding {
	readonly sourcePath: string;
	readonly slot: string;
	readonly order: number;
	/** Stable result/node identity when the source kind exposes one. */
	readonly sourceId?: string;
	/** Host-computed content revision captured by Pick or Replace. */
	readonly sourceRevision?: string;
}

interface IBaseHalfVideoFrameSlotPresentation {
	readonly role: BaseHalfVideoFrameRole;
	readonly label: 'Start' | 'End';
	readonly required: true;
	readonly binding?: IBaseHalfNodeInputBinding;
	readonly source?: IBaseHalfVideoInputSourceState;
	readonly problem?: IBaseHalfVideoInputProblemPresentation;
	readonly actions: readonly ('pick' | 'replace' | 'remove')[];
}

interface IBaseHalfVideoBindingPresentation {
	readonly binding: IBaseHalfNodeInputBinding;
	readonly source?: IBaseHalfVideoInputSourceState;
	readonly status: BaseHalfVideoBindingStatus;
	readonly blocking: boolean;
	readonly reason?: string;
	readonly actions: readonly IBaseHalfVideoInputAction[];
}

interface IBaseHalfVideoInputsPresentation {
	readonly frameSlots: readonly IBaseHalfVideoFrameSlotPresentation[];
	readonly activeBindings: readonly IBaseHalfVideoBindingPresentation[];
	readonly needsReview: readonly IBaseHalfVideoBindingPresentation[];
	readonly canSwapFrames: boolean;
	readonly readinessProblems: readonly IBaseHalfVideoInputProblemPresentation[];
}
```

Presentation labels exposed from the pure layer are stable semantic keys or
role names, not localized sentences. The workbench layer localizes visible and
accessibility copy.

### 6.2 Classification order

Each saved binding appears exactly once in the presentation model. Classify in
this fail-closed order:

1. no inspected source at `sourcePath`: `source-missing`;
2. captured `sourceId` or `sourceRevision` no longer matches the freshly
   inspected source:
   `source-changed`;
3. a legacy binding has no captured revision, or the source is unsaved or its
   current identity/revision cannot be verified: `source-unverified`;
4. the Recipe does not declare the stored role or rejects the source kind:
   `incompatible`;
5. the current method does not declare the stored role: `unused`;
6. method role, source kind, and cardinality all match: `active`.

Statuses 1–5 are blocking and appear in Needs review. An active binding whose
media size, format, or provider transport bound fails strict input evaluation
remains attached to its named slot but is blocking and receives a problem; the
Inputs popover exposes the same logical item and repair actions without
creating a duplicate binding row.

Unknown roles and unknown source kinds fail closed as incompatible. They are
never discarded during parsing or reconciliation.

Source inspection is isolated per durable binding/backlink path. If one source
is missing, its path remains present with unknown kind and is classified as
`source-missing`; readable sibling roles keep their verified kind, identity,
revision, active presentation, and edge. One missing role must not make another
role appear missing or unavailable.

### 6.3 Deterministic ordering

- Start is rendered before End regardless of binding `order`.
- Active ordinary chips follow canonical binding order.
- Needs review rows follow canonical binding order.
- Ties are resolved by normalized `sourcePath`, then role; output order must not
  depend on object or map iteration.
- Reordering multiple items is allowed only within one role. The host rewrites
  the canonical order sequence while preserving every other role's relative
  order.
- Model and method changes do not rewrite binding order.
- Swap changes roles only; it preserves both binding order values unless the
  generic binding normalizer requires an equivalent canonical rewrite.

### 6.4 Cardinality and readiness

The presentation model consumes the shared input evaluation. It must not
reimplement capability selection or prompt validation.

- an empty required Start slot contributes one missing-Start problem;
- an empty required End slot contributes one missing-End problem;
- an extra active-role binding contributes an over-capacity problem and remains
  visible in Needs review;
- a binding for a role absent from the current method contributes an unused or
  incompatible problem even when all current required slots are filled;
- any Needs review binding blocks Generate until explicitly resolved;
- an empty slot affects readiness only, not selection validity;
- the first actionable blocker is Start before End, then active binding
  integrity, then retained Needs review bindings in canonical order.

The primary-action package may consume these stable problem kinds to render
**Add Start Frame**, **Add End Frame**, or **Review inputs**. It must not parse
localized reason strings.

## 7. Composer presentation

### 7.1 Named temporal slots

Named frame slots appear before the prompt and before ordinary chips:

- Start Frame renders one Start slot;
- Start + End Frames renders Start and End left-to-right with a non-color-only
  directional connector;
- Text to Video renders no frame slot;
- each slot has a separate preview target, action control, and accessibility
  name; clicking the thumbnail must not accidentally invoke Remove or Swap;
- Replace and Remove expose distinct non-overlapping pointer hit regions at
  every supported canvas scale; a real pointer click on either action must
  reach that action without interception by its sibling;
- an empty required slot is an enabled pick target, not a disabled error card;
- a filled slot shows source thumbnail or kind fallback, source title, and
  integrity state;
- Replace and Remove are distinct actions and require no hover discovery.

When only one of two slots is filled, the filled source remains stable while
the other slot is actionable. Opening a model, settings, input, or Attempt
popover must not recreate the prompt DOM or clear either slot.

### 7.2 Ordinary chips and Needs review

Ordinary active inputs render in the Composer chip strip. Each chip exposes
role, source identity, kind, problem state, and Remove. Multi-item roles also
offer drag plus keyboard Move Earlier/Move Later; both paths execute the same
mutation plan.

Retained non-active bindings render under one visible **Needs review** heading
after active slots and chips. Every row includes:

- original role and source identity;
- one concise blocking reason;
- all valid explicit repair actions, selected from Change method, Change role,
  Remove input, Replace source, or Inspect source;
- no action that would silently infer a role or remove a graph edge.

Returning to a method that accepts a retained role moves its binding back to
the active slot without a binding or graph write.

### 7.3 Frame Swap

**Swap Start and End** appears only when exactly one valid binding fills each
frame role. It is absent or disabled with visible reason when either slot is
empty, duplicated, missing, changed, unverified, or incompatible.

Swap exchanges only the two target-owned `slot` values. It preserves source
paths, source nodes, graph edges, and Draft method. The entire exchange is one
binding transaction and one undo unit. Undo restores both roles together; no
intermediate state with duplicate Start or End may be externally visible.

## 8. Canvas-pick interaction

### 8.1 Entering pick mode

An empty named slot or **Pick from canvas** creates one transient request:

```ts
interface IBaseHalfVideoCanvasPickRequest {
	readonly sceneKey: string;
	readonly targetNodePath: string;
	readonly targetNodeId: string;
	readonly expectedDraftRevision: string;
	readonly recipeId: string;
	readonly requestedRole: string;
	readonly returnFocusKey: string;
	readonly epoch: number;
}
```

Entering pick mode closes the Inputs popover but preserves the selected Video
card, Composer, prompt DOM, viewport, current bindings, and Draft values. A
fixed banner names the requested role: **Select Start Frame Image** or **Select
End Frame Image**. The banner includes Cancel.

Only one canvas-pick request exists at a time. Starting a different child
popover or selecting a different target cancels the request without mutation.

Before creating the request, the host flushes the ordinary Draft-configuration
save for the exact model, method, and canonical scalar settings that declare
the requested role. The resulting durable Draft revision becomes
`expectedDraftRevision`. This checkpoint belongs to the user's earlier
model/settings edit; it must not save an unrelated pending title or prompt.
If the checkpoint conflicts or cannot be verified, canvas pick does not open.
The later input transaction still owns only bindings plus the exact graph pair.

This rule makes configuration order deterministic: a user may select Start +
End Frames and immediately pick Start even when the previous durable Draft was
Text to Video. Cancelling pick preserves the selected method and creates no
edge or binding.

### 8.2 Source eligibility

A source is eligible only when all are true at hover and rechecked at commit:

1. it is not the target node;
2. it is a saved project source with a stable path and identity;
3. its inspected content kind is accepted by the requested Recipe role;
4. for a temporal frame role, it is a saved Image source with available
   integrity;
5. the selected method still declares the requested role with capacity;
6. the same normalized source path is not already bound anywhere in the Draft;
7. no direct edge or backlink already exists between this source and target in
   an inconsistent state;
8. target path, immutable node id, Recipe, and expected Draft revision still
   match the request.

The eligible source inspection supplies a non-empty fresh revision. Pick and
Replace copy that revision and any available stable source id into the target
binding. A later render never infers `source-changed` from path or timestamps
alone; it compares the persisted capture with another fresh host inspection.

Ineligible nodes are dimmed but retain their graph and selection state. Their
reason is available to pointer and keyboard users. A source already bound as
Start is ineligible for End, and vice versa; the UI does not duplicate the edge
or move the role.

### 8.3 Commit and cancellation

Selecting an eligible source plans and commits exactly one direct edge plus one
target binding. The commit then reopens Inputs and focuses the new chip/slot.

`Escape`, banner Cancel, blank-canvas cancellation, stale target, or failed
revalidation creates neither edge nor binding. A transaction failure rolls
back every applied layer and reports one actionable error while keeping the
Draft inspectable. It must never leave an edge without a binding, a binding
without an edge, or a second source-path binding.

### 8.4 Canvas-pick state machine and exactly-once behavior

Each request has a monotonically increasing epoch and follows this state
machine:

`idle -> preflighting -> ready -> accepting -> revalidating -> committing -> idle`

- `preflighting` flushes the model/method checkpoint and inspects eligible
  sources. Only `ready` accepts pointer, Enter, or Space selection.
- The first eligible selection moves synchronously to `accepting`; repeated
  click, key-repeat, pointer, or keyboard events for that epoch are ignored.
- `revalidating` re-reads the target, source, graph, Recipe, capability, and
  durable revision. It then produces the one mutation plan.
- `committing` stages one host graph/document transition. Durable changes are
  exposed only at its atomic commit point.
- Successful commit exits role-specific pick exactly once only after the host
  transition resolves and a refreshed presentation contains the filled role.
  It restores the selected Video card and focuses that filled slot.
- Failure exits the busy phase, keeps the Draft inspectable, and presents one
  actionable error. It must not silently return to an empty idle Composer.

Cancellation marks the current epoch cancelled before listeners, overlays, or
focus state are torn down. Every awaited preflight, inspection, revalidation,
and staging continuation checks that epoch both before and after the await.
The host must keep staged changes non-durable until the final epoch check. If
cancellation is observed before the atomic commit point, it writes neither
edge nor binding. Once the atomic commit point has begun, Cancel is no longer
offered and the host completes or rolls back that one transition.

Exiting role-specific pick, whether by success, cancellation, target change,
or failure, must not enter or reveal a generic graph-connection mode. One
`Escape` cancels the request, removes its overlay/listeners, and returns focus;
it never requires a second `Escape`. Re-entry creates a fresh epoch with fresh
listeners and cannot inherit a cancelled or accepting flag.

The adapter records an own-write acknowledgement using the normalized target
configuration key and the host file revision/etag; configuration equality by
itself is not a durable revision. The acknowledgement has explicit
`pending-write`, `observed-expected`, and settled states. While the write is
pending, graph/reference notifications and document reads may expose
intermediate versions. Each exact intermediate `(configuration key, etag)` is
recorded as an own version and cannot cancel the request. The checkpoint may
enter `ready` only after an atomic read observes the expected normalized
configuration at a durable revision.

An exact watcher echo of a recorded own version remains an acknowledgement,
not an external edit. Before the expected durable revision has first been
observed, another intermediate own version is recorded and re-read rather than
classified as external. After the expected revision has been observed, any
unknown version or etag follows the ordinary external-change merge/conflict
path. Thus rewriting the previous configuration produces a new etag and is
not hidden as an old echo.

## 9. Input mutations and atomicity

### 9.1 Shared preconditions

Before any mutation the host re-reads and verifies:

- the same workspace folder, scene, target path, and immutable target node id;
- target lifecycle is editable Draft with no Attempt or Result;
- current node contents match the operation's expected revision;
- installed Recipe identity and input definitions still match;
- current graph forward/backlink state is internally consistent;
- source identity, kind, saved state, and integrity still satisfy the action,
  except that Remove intentionally does not require the source file to exist;
- normalized binding source paths remain unique.

If a precondition fails, no partial mutation is committed. The Composer refreshes
from current durable state and explains the stale operation.

The adapter applies `afterBindings` to a fresh persisted target document, not
to the complete in-memory Composer draft. An input transaction may therefore
change only `recipe.inputBindings` plus its exact graph pair. It must not save,
discard, or include in its undo snapshot unrelated pending title, role, prompt,
model, method, or scalar-setting edits. Those values keep their existing dirty
state and their own normal Draft save/undo lifecycle.

The configuration checkpoint required by section 8.1 must finish before the
input request captures its expected revision. It is not included in the input
mutation's undo snapshot. This prevents a frame binding from being committed
against an older persisted method while preserving the input adapter's narrow
write boundary.

### 9.2 Mutation table

| User operation | Binding change | Graph change | One undo unit |
| --- | --- | --- | --- |
| Pick/Add | append requested role, canonicalize order | add forward reference and backlink | yes |
| Replace | replace one binding source, preserve role and position | remove old pair, add new pair | yes |
| Remove | remove one binding, canonicalize remaining order | remove its forward reference and backlink | yes |
| Swap Start/End | exchange two `slot` values | none | yes |
| Explicit role conversion | change one `slot`, preserve source and position | none | yes |
| Move Earlier/Later | reorder only within one role | none | yes |
| Change model/method | no binding change | none | normal Draft configuration undo |

All operations use host-owned project-file/reference transitions and the
canvas undo source. The pure package may produce a mutation plan but never
writes files, graph metadata, or undo history itself.

Undo and redo revalidate exact before/after snapshots. They fail closed when an
external edit has changed an overlapping binding or graph entry; they do not
overwrite newer state. A failure leaves both graph directions and the target
document mutually consistent.

### 9.3 Remove semantics

Because an edge exists only for real context flowing into the target, removing
an input removes its direct edge in the same transaction. The action copy names
both effects. It never deletes the source node or source artifact.

If multiple unrelated graph facts share the same files, the transition edits
only the exact source-target reference. It does not rewrite unrelated edges,
bindings, geometry, or selection.

Remove remains available when the source file or source badge is missing. The
persisted binding path is sufficient to address the exact pair: the graph
transition removes whichever forward reference, backlink, and canvas edge
still exist, while the same transaction removes the target binding. An already
absent direction is an idempotent cleanup condition, not a reason to strand the
binding. Undo may restore the binding and graph facts but never recreates the
deleted source file; if restoring the captured graph state is no longer safe,
undo fails closed without overwriting newer graph state.

### 9.4 Explicit role conversion

Role conversion is offered only when the current Recipe and method accept the
source kind in a different role, the destination role has capacity, and the
source path is not already represented by another binding.

Before commit, confirmation copy names the old role, new role, and source. The
operation changes only the target-owned role and does not reconnect the edge.
There is no default confirmation and no conversion caused merely by switching
models or methods.

For example, changing from Start + End Frames to Start Frame leaves Start active
and End in Needs review. When Start is already filled, End cannot be converted
to Start; the valid actions are return to Start + End Frames or remove End. If
Start were empty and the End source remained an eligible image, **Use as Start
Frame** may be offered as an explicit one-unit role conversion.

## 10. Model and method reconciliation

Model/settings code supplies the newly resolved exact capability. This package
reclassifies bindings without mutating them.

### 10.1 Method change

- preserve every binding, role, order, source, and graph edge;
- derive active slots only from the new method;
- move roles absent from the new method into Needs review;
- restore retained roles automatically to active presentation when the user
  switches back, because their durable binding never changed;
- never use input counts to select a fallback method;
- block Generate while a retained non-active binding exists.

### 10.2 Model change

- preserve bindings only as user-owned data, not as evidence for method choice;
- if the new model declares the same method, re-evaluate its exact role
  cardinality and media bounds;
- otherwise consume the catalog-ordered fallback selected by the model package,
  then classify every old role against that method;
- expose unresolved roles to the reconciliation summary by stable problem kind;
- never delete, relabel, or reorder a binding and never add an edge.

### 10.3 Recipe or catalog drift

If the Recipe disappears, its input contract changes incompatibly, or the
resolved capability becomes unavailable, retain all bindings and graph edges
as Needs review. Disable input mutations that cannot be safely validated, keep
Remove available only when the graph/document transaction can still identify
the exact pair, and route model/Recipe repair through the parent flow.

## 11. Persistence and execution handoff

This package makes one backward-compatible persistence extension and no other
format change.

- Draft bindings remain normalized entries and may additionally contain
  `sourceId` and `sourceRevision` captured by Pick or Replace;
- `sourceRevision` is required for newly created or replaced bindings, while
  its absence remains readable as a legacy, `source-unverified` binding;
- role conversion, reorder, Swap, model change, and method change preserve the
  captured identity fields byte-for-byte;
- Remove needs only the persisted `sourcePath` and does not require a live
  source inspection;
- The host persists the selected model snapshot's derived input counts from the
  same active bindings used by presentation.
- Transient pick requests, source thumbnails, Needs review classification,
  notices, and focus keys never enter `.bhnode`.
- Generate preflight re-inspects every source and requires zero readiness and
  Needs review problems before creating an Attempt.
- Attempt inputs freeze binding role, order, source path, and source revision.
- The executor consumes only the immutable Attempt snapshot; it never reads the
  live Composer classification.

An incomplete Draft with a valid method and empty slot is valid to save. A
Draft with retained Needs review bindings is also preservable but non-runnable.

## 12. Focus, keyboard, and accessibility

- Empty slot `Enter`/`Space` enters role-specific canvas pick.
- Filled slot controls expose separately named Preview, Replace, and Remove.
- Swap names both roles and is reachable after the two slot controls.
- Needs review status and reason are programmatically associated with its row.
- Ineligible pick targets expose their reason without relying on color or
  pointer hover.
- `Escape` cancels pick and restores focus to the originating slot or Add input
  control without changing Draft state.
- Successful pick returns focus to the filled slot/chip; Remove returns focus
  to the next input or Add input; undo restores a deterministic logical focus.
- Screen-reader announcements use one polite Composer status region; commit
  failures may use the host alert path.
- The Start-to-End relationship uses label, order, and a directional symbol,
  never color alone.
- At 200% text zoom and a 320 CSS-pixel canvas width, both named slots and every
  repair action remain reachable without horizontal page scrolling.

## 13. Parallel code ownership

This package is intentionally split so it can be implemented in parallel with
model/settings and execution/recovery work.

### 13.1 Phase I input-package implementation owner

The input-package developer may create or edit only:

- `vscode-base/src/vs/workbench/basehalf/common/basehalfVideoInputs.ts`;
- `vscode-base/src/vs/workbench/basehalf/test/common/basehalfVideoInputs.test.ts`;
- this specification when a pure-input discovery changes the owned contract.

The pure module may import existing contracts but must not edit them to make a
test pass. Any required shared-interface change is reported to the integration
owner first.

### 13.2 Integration owner

The main integration task owns later changes to:

- `vscode-base/src/vs/workbench/basehalf/browser/basehalfCanvasWorkbench.contribution.ts`;
- `vscode-base/src/vs/workbench/basehalf/browser/media/basehalfCanvasWorkbench.css`;
- `vscode-base/src/vs/workbench/basehalf/test/browser/basehalfCanvasWorkbench.test.ts`;
- `vscode-base/scripts/basehalf-smoke.mts`;
- generic graph, node-document, Recipe, and project-transition modules when an
  already specified host primitive is missing.

The integration owner consumes the pure input presentation/mutation model and
is responsible for the graph/undo adapter, DOM, focus, and Electron smoke.

### 13.3 Do-not-touch boundary for the Phase I parallel input package

The parallel input-package developer must not modify:

- `basehalfVideoModels.ts`, model catalogs, or their tests;
- the large workbench contribution, shared canvas CSS, or smoke script;
- provider adapters, connection validation, generation, polling, or download
  code in the Video extension;
- `video-node-development-spec.md`, `product-contract.md`, harness indexes, root
  agent guides, package manifests, or generated output;
- any `.bh/` path in the repository root or `vscode-base/`.

No task in this package commits changes unless the user separately requests a
commit.

### 13.4 Phase II/III input-transaction owner

After the pure package is accepted and the parallel model/settings owner has
released the shared host file, the input-transaction owner may additionally
edit only the narrow input helpers in
`basehalfCanvasWorkbench.contribution.ts`, the backward-compatible binding
fields in `basehalfNodeDocument.ts`, and their focused tests. That lane owns:

- applying a plan to a fresh persisted Draft rather than the complete Composer
  draft;
- refreshing only the persisted model-snapshot input counts derived from that
  binding set;
- source identity/revision capture and comparison;
- missing-source and incomplete-graph Remove cleanup;
- exact graph/document transition and undo snapshots.

It does not own model/settings rendering, shared canvas CSS, provider execution,
or the execution/recovery extension. The owner must coordinate before editing a
shared helper and must preserve unrelated changes already present in the file.

## 14. Implementation sequence

### Phase I — pure presentation and reconciliation

1. define source, binding-status, frame-slot, problem, and action types;
2. derive named slots from a resolved capability without model-id branches;
3. classify every binding exactly once with deterministic order;
4. merge shared input readiness with integrity and Needs review problems;
5. derive swap availability and explicit repair actions;
6. add exhaustive pure tests.

Exit: all slot and retained-binding states can be proven without DOM or I/O.

### Phase II — host transaction adapter

1. integrate named slots, chips, and Needs review into Composer rendering;
2. implement transient role-specific canvas pick;
3. adapt Pick, Replace, Remove, Swap, Convert, and Reorder plans to host
   project/reference transitions;
4. add one-unit undo/redo and stale-state failure tests;
5. integrate stable focus and accessibility behavior.

Exit: each explicit input operation changes the target and graph exactly once
and can be undone as one unit.

### Phase III — end-to-end input gate

1. feed pure problems to the primary-action/readiness package;
2. verify persisted counts and frozen Attempt inputs match the presentation;
3. add Start/End paths to the disposable-workspace Electron smoke;
4. adversarially exercise model/method changes and restart-safe persistence.

Exit: users can configure the Draft in any order without silent input mutation.

## 15. Acceptance criteria

### I1. Method selection is independent of missing inputs

Given a model with Start Frame and no image, selecting Start Frame keeps the
method selected and renders one empty Start slot. Settings remain editable and
the blocker is Add Start Frame, not model unsupported. Maps to parent A3.

### I2. Exact model controls frame methods

Given a model without Start + End Frames, those slots are absent. Given a model
with that method, the method can be selected before either frame exists. Given
one executable method, it is fixed rather than a fake choice. Maps to A16.

### I3. Start and End remain distinct

Given Start + End Frames, adding Start fills only Start and leaves End empty and
actionable; adding End produces one binding per role. Removing End leaves Start
unchanged. Maps to A17.

### I4. Canvas pick is atomic

Given an empty Start slot, picking one eligible saved Image commits exactly one
edge pair and one Start binding in one undo unit. Undo removes both; cancellation
creates neither. Maps to A6.

### I5. Same source cannot fill two roles

Given a source already bound as Start, End-pick marks it ineligible with a
visible reason. Selection creates no duplicate edge, binding, or implicit role
move.

### I6. Swap changes roles only

Given one valid Start and End, Swap exchanges their target-owned roles in one
undo unit. Source paths and graph edges are byte-for-byte unchanged; undo
restores both roles together.

### I7. Method change retains End

Given Start and End, switching to Start Frame keeps Start active and retains End
with its original role in Needs review. Both edges remain; switching back
restores End without a graph write. Maps to A18.

### I8. Model fallback ignores attached images

Given two images and a method absent from a newly selected model, method
fallback follows reviewed catalog order. Both bindings remain unchanged and
unresolved roles are visible. Maps to A19 and A7.

### I9. Role conversion is explicit

Given an eligible retained image and an empty accepted destination role, Change
role names old and new roles before commit, changes only the binding slot, and
is one undo unit. No model/method change invokes it automatically.

### I10. Remove changes graph and binding together

Removing one input removes exactly its target binding and direct graph pair,
never its source node or artifact. Undo restores both; a partial write is rolled
back or fails closed. The same result holds when the source file is already
missing or either graph direction was already absent. Unrelated pending prompt,
model, method, and setting edits are neither committed nor reverted by Remove
or its undo.

### I11. Integrity failures stay inspectable

Given a missing, changed, or unverified source, its binding remains visible with
identity, original role, reason, and explicit actions. Generate is blocked and
no alternate source is inferred.

### I12. Presentation and saved inputs agree

Given a ready Draft, saved binding roles/order, model-snapshot counts, Composer
slots/chips, and strict preflight inputs describe the same canonical set. Maps
to A8.

### I13. External changes do not get overwritten

Given a pending pick or mutation and an overlapping external Draft/graph edit,
commit detects the stale revision and writes nothing. Current state is rendered
with an actionable message.

### I14. Popovers preserve input and prompt state

Opening Models, Settings, and Inputs does not change slot bindings, canvas
viewport, prompt DOM, prompt selection, or IME composition. Maps to A15.

### I15. Narrow and accessible operation

At 200% text zoom and 320 CSS-pixel canvas width, Start, End, Replace, Remove,
Swap, Needs review actions, and Cancel remain keyboard and screen-reader
reachable without horizontal page scrolling. Replace and Remove pointer hit
regions remain non-overlapping and independently clickable.

### I16. Cancel, re-enter, and selection are request-scoped

Given an open Start pick, when the user cancels and immediately re-enters, then
one Enter or pointer selection on an eligible source commits exactly one edge
pair and one Start binding. The prior epoch cannot consume, suppress, or repeat
the new selection. Success returns to the filled Start slot without entering a
generic connection mode.

### I17. Unsaved method checkpoint precedes input commit

Given a durable Text-to-Video Draft whose Composer has selected Start + End
Frames, when the user opens Start pick, then the canonical model/method
configuration is durably checkpointed before the request revision is captured.
Picking Start changes only the binding and graph pair in the input transaction;
an unrelated pending prompt or title is neither saved nor reverted.

### I18. Current blocker outranks adjustment history

Given a model switch that both adjusts settings and leaves Start empty, the
complete adjustment list remains reviewable while the primary status and
action are Add Start Frame. Saving or dismissing the adjustment does not change
input readiness.

## 16. Required tests

### 16.1 Pure common tests

- Text, Start, and Start + End slot derivation;
- required slot absent, one-sided, complete, duplicate, and over-capacity states;
- valid method remains selected with zero inputs;
- method fallback result is consumed without inspecting input counts;
- active, unused, incompatible, missing, changed, and unverified classification;
- unknown role and unknown source kind fail closed;
- deterministic active/Needs review ordering;
- same source-path uniqueness and second-role ineligibility;
- explicit conversion eligibility and destination-capacity rejection;
- Swap availability and role-only before/after plan;
- Pick, Replace, Remove, Convert, and Reorder plan invariants;
- Pick/Replace identity capture and changed/legacy revision classification;
- missing-source Remove with present, incomplete, and already-absent graph
  state;
- one missing bound source does not contaminate a readable sibling role;
- document application changes only `recipe.inputBindings` and rejects stale
  before-bindings without touching prompt/model/settings;
- no mutation plan changes a graph for Swap/Convert/Reorder;
- every blocker has a stable non-localized kind.

### 16.2 Host integration tests

- pick, cancel, stale pick, and transaction rollback;
- cancel then re-enter followed by pointer selection and keyboard selection;
- double-click, Enter key-repeat, and mixed pointer/keyboard selection commit
  at most once per epoch;
- cancellation before and after every asynchronous preflight/revalidation
  continuation produces zero input/graph writes;
- successful selection does not fall through to generic graph-connect mode and
  returns focus only after the filled slot renders;
- pending writes, the first durable expected revision, and exact stale
  `(configuration key, etag)` echoes are distinguished; own intermediate
  versions cannot cancel the next request, while an unknown revision after
  expected has been observed follows the external-change path;
- an unsaved frame-method selection is checkpointed before pick without saving
  unrelated prompt/title edits;
- one graph pair plus binding per Pick and one undo/redo unit;
- Replace and Remove modify the exact graph pair atomically;
- method/model change preserves bindings and edges;
- retained End returns without a write when switching back;
- focus restoration after pick, cancel, remove, and undo;
- prompt DOM/selection/IME and viewport stability;
- role labels, disabled reasons, live status, keyboard order, high contrast,
  reduced motion, 200% zoom, and narrow canvas.

### 16.3 Electron smoke

The parent smoke path must select Start + End Frames before adding inputs,
observe missing Start, add Start and observe missing End without losing Start,
add End, and verify two distinct role bindings plus two graph edges. A real
Workbench Undo must remove the latest binding, forward reference, backlink,
and canvas edge together while retaining Start; Redo must restore all four.
After the expected Redo revision is visible, the smoke opens a pending input
request and externally writes the exact bytes of the earlier Start-only
configuration. That new file revision must cancel the request and refresh the
End blocker rather than being swallowed as the earlier own-write echo. The
smoke then deletes one bound frame source outside the app, observes that the
missing binding remains removable, invokes Remove from Composer, and verifies
the binding, exact forward/backlink pair, and canvas edge are all absent before
continuing to Generate. It must run only in a disposable fixture workspace.

## 17. Verification commands

Run from `vscode-base/` after the relevant implementation phase:

```sh
npm run compile-client
npm run typecheck-client
npm run test-node -- --run src/vs/workbench/basehalf/test/common/basehalfVideoInputs.test.ts
npm run test-node -- --run src/vs/workbench/basehalf/test/browser/basehalfCanvasWorkbench.test.ts
node --experimental-strip-types scripts/basehalf-smoke.mts --plugin-only
npm run basehalf:smoke
```

The pure input-package developer is required to run the first three commands
that apply to the new common module and test. The integration owner runs the
browser and smoke checks. A targeted smoke does not replace the compile-backed
full smoke release gate.

Also verify:

- `git diff --check` passes;
- root `AGENTS.md` and `CLAUDE.md` remain equivalent;
- no repository-root or `vscode-base/` `.bh/` data was created or followed;
- documentation, code, comments, test names, fixtures, and logs contain no
  unapproved external product identifiers.

## 18. Definition of done

This work package is complete only when:

1. the pure module and tests cover every input presentation and mutation state;
2. the Composer renders model-driven named slots without renderer capability
   flags;
3. canvas pick and every explicit input mutation are atomic and undoable;
4. model/method changes preserve every edge and binding until explicit action;
5. Needs review blocks Generate with visible repair paths;
6. saved binding/order/count data and Attempt inputs agree with presentation;
7. parent acceptance A3, A6-A8, and A15-A19 pass at their required layers;
8. the scoped typecheck, tests, disposable-workspace smoke, and final diff
   hygiene checks pass.
