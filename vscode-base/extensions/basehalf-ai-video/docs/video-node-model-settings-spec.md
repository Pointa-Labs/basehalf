# Video node model selection and settings specification

Status: active implementation work package, version 2

Last updated: 2026-08-24

Parent specification: [Video node development specification](video-node-development-spec.md)

Owning product contract: [AI Video domain contract](product-contract.md)

## 1. Authority and delivery boundary

This work package defines the implementation boundary for choosing an exact
reviewed Video model, connecting the matching provider scope, and configuring
that model through a schema-driven Settings popover. It is intended to be
implemented in parallel with the input and execution work packages.

The parent specification remains authoritative for shared vocabulary, the
end-to-end Draft/Attempt/Result lifecycle, Composer geometry, input transactions,
and acceptance wording. The domain contract remains authoritative for host,
plugin, graph, credential, and artifact ownership. This document narrows those
contracts into model/settings state, interfaces, file ownership, and tests; it
does not redefine the shared lifecycle.

When requirements overlap:

1. the domain contract owns cross-product and host/plugin boundaries;
2. the parent specification owns shared Video-node behavior;
3. this work package owns model-picker, connection-return, and Settings details
   inside those boundaries.

There are no unresolved product questions in this work package. An
implementation that satisfies the acceptance matrix in section 13 may proceed.

## 2. Required outcome

This package is complete when a developer can prove all of the following
without a real credential or paid request:

- the model picker presents every admitted reviewed model in a deterministic
  order and exactly one of five semantic row states;
- model choice and model-specific settings are separate anchored surfaces with
  separate triggers; choosing a model never opens a second settings panel
  inside the picker;
- selecting a model is an explicit in-memory reconciliation transaction;
- a generation method is selectable whenever the exact model declares it,
  even when the Draft is missing required inputs;
- a locked model opens the one matching connection form and returns to the
  exact initiating Draft after read-only verification;
- Settings is rendered from the resolved model/method schema, updates without
  an Apply step, and explains every automatic value change;
- the summary, persistence snapshot, and execution handoff use the same
  canonical values;
- prompt content, graph edges, input roles, canvas viewport, and Composer DOM
  are never mutated as a side effect of model/settings presentation.

## 3. Scope

### 3.1 In scope

- model-row projection, ordering, grouping, search, pinned selection, focus,
  keyboard semantics, and the five row states;
- exact model choice identity and connection-scope projection;
- model selection and generation-method reconciliation;
- the connection editor entry, local validation, verification, replacement,
  stored-credential revalidation, removal, cancellation, and one-shot return;
- Settings schema projection, control-kind selection, conditional visibility,
  disabled reasons, normalization adjustments, and compact summary tokens;
- incomplete-Draft persistence handoff for a valid model/method;
- pure presentation tests, connection service tests, and integration contracts
  consumed by the Composer owner.

### 3.2 Out of scope

- rendering, moving, or dismissing the node-adjacent Composer itself;
- Start/End slot UI, canvas-pick mode, edge/binding mutation, role conversion,
  input ordering, or undo;
- paid authorization, Attempt creation, provider submission, polling,
  cancellation of an Attempt, Retry, download, or Result sealing;
- provider-specific request fields, free-form model identifiers, free-form
  endpoints, or renderer-owned capability flags;
- numeric pricing derived only from capability metadata;
- changing a sealed Result in place.

The Composer integration owner consumes this package's pure presentation data
and performs host mutations. It must not move model/settings rules back into
DOM branches.

## 4. Sources of truth and dependency direction

The dependency direction is one-way:

`reviewed catalogs -> capability resolution -> normalization -> pure presentation -> workbench rendering`

The following data is authoritative:

| Concern | Source of truth |
| --- | --- |
| exact provider/deployment/region/model/revision identity | admitted video model catalog |
| executable generation methods and their order | exact model descriptor `modes` |
| method inputs, prompt rule, parameters, options, and constraints | exact resolved mode capability |
| configured connection scopes | host model-service descriptors plus provider-connection catalog |
| canonical setting values and adjustments | `normalizeBaseHalfVideoSettingsForCapability` result |
| input counts and missing-input diagnostics | `evaluateBaseHalfVideoInputs` result |
| transient selection, search, focus, and reconciliation notice | Composer memory |
| persisted model/method identity and input counts | host-owned model snapshot in the `.bhnode` Draft |
| credentials | system credential store only |

The renderer must not derive capabilities from model ids, provider ids, labels,
or current input count. Catalog display labels may be shown or searched but
must never become execution identity.

## 5. Capability selection and input readiness are separate

The model/settings path must use the split public model API:

1. `resolveCapability` exact-matches provider, deployment, region, model id,
   revision, method, and catalog availability without considering current
   inputs.
2. `normalizeBaseHalfVideoSettingsForCapability` produces canonical values,
   rendered parameter state, and adjustment data for that valid capability.
3. `evaluateBaseHalfVideoInputs` independently reports whether the Draft's
   prompt and media counts satisfy the selected method.
4. strict execution resolution combines capability support and readiness only
   in save/preflight/execution paths.

The following invariants are normative:

- a missing Start or End frame never makes a declared method unsupported;
- current inputs never choose or downgrade a method;
- Start Frame and Start + End Frames are distinct model-scoped methods;
- a model row's Available/Selected state is not changed by missing inputs;
- input problems may contribute a footer blocker or reconciliation count, but
  the input work package owns their detailed actions and role transactions;
- changing input counts may alter catalog-declared conditional parameter state,
  but it must not alter method availability or selection.

If the public capability API cannot express one of these invariants, this lane
must report an interface handoff to the shared model-layer owner rather than add
a duplicate resolver.

## 6. Pure model/settings presentation contract

The common layer must expose one immutable, DOM-free projection. Exact names
may follow local conventions, but the observable shape must carry semantic
state rather than localized sentence parsing:

```ts
type VideoModelRowState =
  | 'selected'
  | 'available'
  | 'connect'
  | 'unavailable'
  | 'needs-review';

interface VideoModelRowPresentation {
  logicalKey: string;
  choice: VideoModelChoice;
  label: string;
  disambiguationLabel?: string;
  capabilityTokens: readonly VideoCapabilityToken[];
  state: VideoModelRowState;
  action: 'none' | 'select' | 'connect' | 'repair';
  repairSurface?: 'models' | 'connection' | 'settings';
  disabledReason?: string;
  selected: boolean;
  searchText: string;
}

interface VideoMethodPresentation {
  mode: BaseHalfVideoGenerationMode;
  label: string;
  selected: boolean;
}

interface VideoParameterPresentation {
  parameterId: string;
  control: 'fixed' | 'segmented' | 'listbox' | 'range' | 'boolean';
  visible: boolean;
  enabled: boolean;
  disabledReason?: string;
  valueLabel?: string;
  unit?: string;
  // Options and range ticks already carry catalog-derived display labels.
  // The DOM never formats a value by parameter id or localized label text.
}

interface VideoSettingAdjustmentPresentation {
  parameterId: string;
  parameterLabel: string;
  kind: 'defaulted' | 'constrained' | 'removed';
  previousValueLabel?: string;
  valueLabel?: string;
  reason: string;
}

interface VideoModelSettingsPresentation {
  rows: readonly VideoModelRowPresentation[];
  showSearch: boolean;
  showScopeHeadings: boolean;
  pinnedSelectedRow?: VideoModelRowPresentation;
  methods: {
    presentation: 'fixed' | 'segmented' | 'listbox';
    options: readonly VideoMethodPresentation[];
  };
  parameters: readonly VideoParameterPresentation[];
  settingsSummary: readonly VideoSettingsSummaryToken[];
  adjustments: readonly VideoSettingAdjustmentPresentation[];
  selectionProblem?: VideoModelSelectionProblem;
}
```

The production type may split picker and Settings projections for smaller
recomputation. In either form it must be deeply immutable, use stable logical
keys, and contain enough semantic data for tests to assert behavior without
matching localized DOM strings.

The pure function may accept display-only provider/deployment labels and
connection projections supplied by host services. It must not import DOM,
storage, credential, command, dialog, graph, or execution services.

## 7. Model picker behavior

### 7.1 Row-state precedence

Each catalog row has exactly one state, derived in this order:

1. **Unavailable** when the descriptor is unavailable or has no executable
   reviewed method. The row is disabled and includes the catalog reason.
2. **Needs review** when it is the Draft's selected exact identity and its
   connection needs attention or its saved configuration cannot normalize.
3. **Selected** when it is the Draft's exact valid selection and the connection
   is currently usable. Missing prompt or inputs do not change this state.
4. **Connect** when the row is otherwise selectable but its exact connection
   scope is not configured.
5. **Available** when the row is selectable and its connection is usable.

When a persisted exact identity no longer exists in the current catalog, add
one synthetic pinned Needs review row for that saved identity; never pretend a
current revision is selected. Its repair action keeps Models open and focuses
the first current replacement candidate in reviewed order. It cannot be
executed or saved again without an explicit current selection.

Any row whose exact identity matches the Draft carries `selected: true`, even
when its state is Unavailable or Needs review. The DOM integration uses both a
check indicator and `aria-pressed="true"`. Unavailable is the only disabled
catalog state. Connect and Needs review remain actionable and identify whether
their repair surface is Models, Connection, or Settings.

### 7.2 Capability summary

Capability tokens are derived only from executable reviewed modes. They may
include method families, maximum reviewed resolution, reviewed duration range,
and native-audio support. A value present only in an unavailable mode or option
must not appear in the summary.

Method labels are provider-neutral:

- `text-to-video`: **Text to Video**;
- `first-frame-to-video`: **Start Frame**;
- `first-last-frame-to-video`: **Start + End Frames**;
- other modes use their separate catalog-reviewed family labels.

Start + End Frames must not summarize a Start-Frame-only model.

### 7.3 Ordering, grouping, and search

- Preserve catalog contribution order within each provider connection scope.
- Group only when more than one provider/connection scope is present.
- Show in-popover search only when the unfiltered row count is greater than 12.
- Normalize the query by trimming and case-folding. Match model label,
  display-only provider label, display-only deployment label, and executable
  capability labels. Do not use secrets or endpoint values.
- Filtering never changes the Draft or selection.
- When the selected row does not match a non-empty query, render it once in a
  pinned Selected section and omit its duplicate from filtered results.
- On registry refresh, restore focus by `logicalKey`; when that key vanished,
  move to the closest enabled row in reviewed order, then the search field.

Rows implement Arrow Up/Down, Home, End, Enter, and Space through the workbench
integration. Search preserves ordinary text-field key behavior.

### 7.4 Picker and Settings are separate surfaces

The Composer exposes two adjacent but independent summary triggers:

1. the model trigger shows the selected model identity and opens the model
   picker;
2. the Settings trigger shows method, aspect ratio, resolution, duration, and
   other catalog-declared summary tokens and opens Settings.

The model picker is an anchored, scrollable list above or beside the model
trigger. Each row presents the model label, provider/deployment mark when
needed for disambiguation, capability tokens, and its semantic row state.
Unavailable rows remain visible with a disabled reason; the selected row has
both a non-color selection treatment and semantic selected state.

Settings is a separate compact anchored popover. It is rebuilt from the newly
selected exact model and method after a model transaction. A method with one
executable choice, an enum with one declared choice, or a normalized numeric
range with one legal value is `fixed`: it remains visible as labeled text with
explanatory copy rather than disappearing or pretending to be selectable.
Opening either surface closes the other without
unmounting the Composer, recreating the prompt, changing a binding, or moving
the canvas viewport.

Changing model may normalize the method and scalar settings, but it never
removes an already bound source. The input package reclassifies each retained
binding against the new method and makes unresolved roles explicit.

## 8. Selection and method transactions

### 8.1 Selecting an available model

The host invokes one pure reconciliation and commits its output to Composer
memory only:

1. resolve the exact choice and executable modes;
2. preserve the previous method only when the new exact model declares it;
3. otherwise select the first executable method in catalog order;
4. normalize existing scalar settings against the selected capability;
5. preserve the prompt, every graph edge, and every input binding/role;
6. return all defaulted, constrained, and removed setting adjustments;
7. return unresolved input-problem identities without changing them;
8. mark the Composer Draft dirty and keep the picker open;
9. focus the newly selected row and announce a compact semantic summary.

No save, connection request, paid authorization, Attempt, or provider task is
part of this transaction. If no executable method exists, the row must already
be Unavailable and the transaction must fail closed.

### 8.2 Changing generation method

Changing a method resolves that exact capability and normalizes settings in
one in-memory transaction. It updates visible Settings controls immediately,
preserves graph/bindings verbatim, and records every repaired scalar value.

Method fallback is allowed only when a model switch or catalog revalidation
makes the previous method unavailable. It is never based on the number, kind,
or order of inputs. The reconciliation data must identify both old and new
methods so the integration can show an explicit notice.

## 9. Connection and verification loop

### 9.1 Return intent

Choosing Connect first asks the host to checkpoint the valid Draft fields, then
creates one immutable in-memory intent containing the parent specification's
scene key, node path, document id, Recipe id, catalog id, exact model key,
connection spec id, and random request id.

The intent is window-scoped and one-shot:

- a new intent supersedes the old intent;
- completion must match the current connection spec and request;
- cancellation consumes only the matching current request;
- it is never persisted in project files, configuration, history, or credential
  storage;
- restart or window loss discards the intent. A successfully saved connection
  remains machine-local, while the user returns to the checkpointed Draft
  manually and no model is applied automatically.

### 9.2 Connection states

The connection editor implements this state machine:

`editing -> validating -> verifying -> accepted | rejected | unavailable | storage-failure`

Additionally, an existing connection may be `verified` or `needs-attention`
and exposes Test connection, Replace key, and Remove.

- Local validation focuses the first invalid field and performs no request.
- Verify & Connect calls only the admitted validator for the exact connection
  spec. The validator is read-only and cannot create a generation task.
- During verification, fields and actions are disabled and a polite status is
  announced.
- Acceptance stages credential storage, persists only reviewed non-secret
  values, commits atomically, and cleans staging state on every failure.
- A rejected new credential remains only in the live field and is not stored.
- Provider unavailability is retryable and does not store a new credential.
- Test connection uses the stored credential through the same read-only
  validator. Failure marks the machine-local connection Needs attention but
  does not echo, delete, or rewrite the credential or any project file.
- Replace key follows the same staging/verification/atomic-commit path.
- Remove requires confirmation and removes only that machine-local credential
  and metadata.

Errors exposed to the UI are sanitized by the existing secret-redaction
boundary. Provider bodies and credential-bearing endpoints never enter DOM,
logs, model rows, return intents, or Drafts.

### 9.3 Exact return validation

After acceptance, the host consumes the intent and reopens the target only when
scene key, node path, immutable document id, Recipe id, catalog id, and exact
model key all still match an editable Draft. It then selects the initiating
model, restores the prior selection/viewport/prompt context, opens Settings,
and presents the connection-review notice from the parent specification.

On any mismatch, the connection remains saved but the model is not applied.
The canvas returns without targeting a reused path and exposes the stale-target
explanation. Cancelling setup never selects the locked model.

## 10. Settings schema and controls

Settings renders in this fixed section order:

1. exact model heading and connection status;
2. generation method;
3. visible parameters in catalog order;
4. complete adjustment notice;
5. model/settings selection problem, if any;
6. reviewed source URL and verification date in low-priority disclosure.

That order is structural, not merely visual styling: reviewed-source disclosure
must never be inserted before the current problem, and a supported exact model
continues to show its heading and source when normalization needs review.

### 10.1 Method control

- zero executable methods: the model is Unavailable in the picker;
- one executable method: render a fixed value with explanatory copy;
- two to four short labels: segmented radio group;
- more or long labels: listbox.

The selected method stays valid while required inputs are absent. The input
package owns the corresponding Add Start/Add End action.

### 10.2 Parameter controls

- enum with at most eight short options: segmented radio group;
- larger or long-label enum: listbox;
- numeric range with at most fifteen discrete legal values: segmented group;
- larger numeric range: slider with editable numeric value and unit;
- boolean: On/Off radio group unless catalog wording clearly declares an
  independent conventional toggle.

`visibleWhen === false` omits a control. A visible disabled parameter and every
disabled enum option remain visible with an inline accessible reason. A newly
illegal selected value moves to the deterministic legal value and adds an
old-to-new adjustment. A parameter absent from the new schema is removed from
canonical values and adds a removed adjustment.

Range parameters declare an optional short `unit` in the reviewed catalog. The
pure projection returns the canonical `valueLabel` and labeled range ticks by
combining the number with that unit. Enum labels and Boolean On/Off labels are
resolved by the same pure formatter. A missing unit means an intentionally
unitless number; renderer inference from parameter ids or localized labels is
forbidden.

There is no Apply button. Rebuilding controls restores focus by parameter id or
the deterministic replacement id. IME composition in the prompt suppresses
host save/rerender work until composition ends.

### 10.3 Reconciliation and summary

Adjustment notices are display-safe data, not synthesized by comparing DOM.
Each item carries its catalog label and formatted old/new labels. When a removed
legacy value has no surviving or previous reviewed schema, the projection uses
neutral copy such as **Previous setting** and **Previous saved value** rather
than exposing a raw parameter id or scalar. They remain
until the next model/method transaction, explicit dismissal, or successful
save of the reviewed configuration.

The summary trigger emits label/value tokens in this priority order:

1. method;
2. aspect ratio when declared;
3. resolution when declared;
4. duration when declared;
5. audio only when declared and different from the clear model default.

Catalog option labels are displayed; raw internal scalar values are not used as
fallback UI copy. A capability or normalization problem adds a warning state
without replacing the compact summary with a long error.

### 10.4 Message and action precedence

Adjustment notices are historical, non-blocking review data. They never replace
the current blocking problem, never enable or disable Generate, and never
become the primary action label.

The Composer and Settings integration consume the parent specification's one
message-precedence contract. In particular, a missing Start or End frame and a
Needs review input outrank a settings-adjustment notice. Settings may continue
to show the complete adjustment list in its own section, while the Composer's
primary status and action show the highest-priority current blocker. Both
surfaces must agree on the same semantic problem kind; neither may choose a
message by whichever asynchronous result arrived last.

## 11. Persistence and integration handoff

The package returns canonical model identity, method, normalized scalar values,
adjustments, and summary tokens. The host integration owns saving them.

An incomplete Draft may save a valid exact model/method plus current input
counts. It must not save:

- credentials, secret references, endpoints, or connection form values;
- transient search, focus, popover, row, or notice state;
- a half-resolved model tuple;
- numeric cost claims without a reviewed pricing contract.

The persisted snapshot is created from the exact capability resolution, not
from row labels or DOM controls. At Generate preflight, the execution owner
strictly resolves the same catalog/revision/scope and compares normalization to
the canonical saved settings. This package must not weaken that strict check.

## 12. Parallel file ownership

To keep parallel development merge-safe, this work package owns only the
following implementation files:

- `src/vs/workbench/basehalf/common/basehalfVideoModelSettingsPresentation.ts`
  (new pure projection and reconciliation helpers);
- `src/vs/workbench/basehalf/test/common/basehalfVideoModelSettingsPresentation.test.ts`
  (new pure contract tests);
- `src/vs/workbench/basehalf/common/basehalfModelConnectionNavigation.ts` and
  its existing common test;
- `src/vs/workbench/basehalf/common/basehalfModelServices.ts` and its existing
  common test, only for stored Test connection and Needs-attention state;
- `src/vs/workbench/basehalf/browser/basehalfModelConnections.ts` and
  `browser/media/basehalfModelConnections.css`, only for the generic connection
  form and its states.

The following are integration-owned and must not be edited by this parallel
lane:

- `basehalfCanvasWorkbench.contribution.ts`;
- `browser/media/basehalfCanvasWorkbench.css`;
- `scripts/basehalf-smoke.mts`;
- the `.bhnode`, graph, input, execution, run-lease, and Result files;
- plugin provider adapters and provider execution files.

The following are read-only shared dependencies during parallel work:

- `basehalfVideoModels.ts` and `basehalfVideoModels.test.ts`;
- `basehalfVideoModelCatalogs.ts` and its test;
- video/provider catalog extension-point registration files;
- the reviewed plugin catalog JSON.

If a required shared interface is absent, stop that edit, report the smallest
interface addition to the integration owner, and continue on work that fits the
owned files. Do not duplicate shared types to bypass ownership.

## 13. Acceptance matrix

| Package scenario | Parent mapping | Required proof |
| --- | --- | --- |
| locked selection checkpoints prompt and returns to exact Draft | A1 | connection-navigation service test plus Composer integration smoke |
| deleted/reused connection target never receives the model | A2 | exact-target integration test |
| frame method remains selected without its frame | A3 | pure presentation test using valid capability plus failed input readiness |
| model switch reports every repaired setting and preserves input identities | A4, A7 | pure reconciliation test plus integration assertion that graph/bindings are unchanged |
| disabled parameter/option has visible semantic reason and does not mutate value | A5 | pure projection and DOM/component tests |
| summary, saved scalars, snapshot, and strict preflight agree | A8 | serialization/preflight integration test |
| failed stored-credential test retains credential and marks Needs attention | A14 | model-service test with fake credential store and validator |
| Models/Settings changes preserve card, viewport, prompt DOM, selection, and IME | A15 | DOM/component test and Electron smoke |
| exact model alone controls method set and fixed/multi presentation | A16 | pure presentation tests for zero, one, two-to-four, and long/many methods |
| model fallback follows catalog order, never attached frames | A19 | pure reconciliation test with identical inputs and different catalog order |
| model picker and Settings remain separate anchored surfaces | A15, A16 | DOM test for triggers, exclusive popovers, fixed controls, and prompt/viewport stability |
| input blocker outranks settings adjustment without losing its detail | A3, A4 | pure precedence test plus Composer DOM assertion |

Cross-package acceptance is not complete until the integration owner supplies
the graph, Composer DOM, and smoke assertions named above.

## 14. Implementation sequence

### M1 — pure projection

- add the immutable model/settings presentation module;
- derive row states, executable capability tokens, search, pinned selection,
  method control style, parameter control style, summary, and adjustments;
- cover every derivation with data-level tests.

Exit: the integration layer can render Models and Settings without provider or
model-id branches and tests do not parse localized DOM text.

### M2 — connection states

- extend the generic model service with read-only stored-credential testing and
  a durable machine-local Needs-attention projection;
- preserve credential staging, cleanup, redaction, and atomic replacement;
- harden request-matched one-shot navigation and stale completion tests;
- render Test connection, Replace key, Remove, progress, and failure states.

Exit: a process-only fake validator proves verification and revalidation never
create a generation task or change a project file.

### M3 — integration handoff

- provide the pure projection inputs/outputs and connection events to the
  Composer owner;
- integrate selection and method reconciliation in one host transaction;
- wire focus restoration and live-region semantics;
- add the cross-package DOM and smoke assertions without moving rules into the
  workbench contribution.

Exit: parent scenarios A1–A5, A7, A8, A14–A16, and A19 have recorded proof.

## 15. Verification commands

From `vscode-base/`, after compiling current sources:

```bash
npm run compile-client
npm run test-node -- --run src/vs/workbench/basehalf/test/common/basehalfVideoModelSettingsPresentation.test.ts
npm run test-node -- --run src/vs/workbench/basehalf/test/common/basehalfModelConnectionNavigation.test.ts
npm run test-node -- --run src/vs/workbench/basehalf/test/common/basehalfModelServices.test.ts
npm run test-node -- --run src/vs/workbench/basehalf/test/common/basehalfVideoModels.test.ts
npm run test-node -- --run src/vs/workbench/basehalf/test/common/basehalfVideoModelCatalogs.test.ts
npm run typecheck-client
```

After Composer integration:

```bash
npm run basehalf:smoke
```

The smoke must use its disposable workspace and process-only fake connection
validator. It must cover the locked-model round trip and choose a valid frame
method before adding inputs; it must assert that no paid task exists during
connection verification.

For the documentation gates, run from the repository root:

```bash
git diff --check
cmp -s AGENTS.md CLAUDE.md
```

Also resolve every relative Markdown link and scan the changed document for
restricted product names before handoff.
