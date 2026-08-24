# Video node development specification

Status: active umbrella implementation specification, version 3

Last updated: 2026-08-24

Implementation readiness: reviewed; no blocking product or engineering questions

Owning product contract: [AI Video domain contract](product-contract.md)

Implementation work packages:

- [Model selection and settings](video-node-model-settings-spec.md)
- [Inputs and frame roles](video-node-inputs-spec.md)
- [Execution, recovery, and Result sealing](video-node-execution-recovery-spec.md)

This document owns the shared vocabulary, end-to-end journey, lifecycle,
surface architecture, cross-package invariants, release gate, and integration
acceptance scenarios. Each work-package specification owns the detailed
behavior and implementation boundary named by its title. A work package may be
implemented and verified independently, but it is not a separate product
feature and must continue to consume the shared contracts defined here.

When documents appear to disagree, apply this authority order: the domain
contract for lifecycle and durable ownership; this umbrella specification for
shared Video-node behavior; then the applicable work-package specification for
details inside its declared scope. An implementation discovery that crosses a
package boundary must update this document before either package changes its
public interface.

## 1. Purpose

This document defines the product and engineering behavior required to finish
the BaseHalf Video node. It is an implementation specification: a developer
must be able to derive code boundaries, state transitions, test cases, and
acceptance work from it without inventing missing product behavior.

The first priority is the end-to-end path from choosing a reviewed video model,
through configuring and verifying its connection, to configuring a Draft,
submitting an Attempt, observing progress, and inspecting either a sealed local
Result or a recoverable failure. The second priority is the canvas interaction
quality of the card, node-adjacent Composer, and their child popovers.

The domain contract remains authoritative for lifecycle, local-file, graph,
plugin, and provider boundaries. This document owns the detailed Video-node
interaction and implementation behavior inside those boundaries.

## 2. Completion outcome

The Video node is complete only when all of the following are true:

1. A new Video Draft can preserve a prompt before a model or connection exists.
2. The user chooses a reviewed model directly; Recipe and provider transport
   remain implementation details.
3. A locked model routes to the one matching provider-connection form, verifies
   the credential without creating a paid task, and returns to the same Draft
   with the same prompt and canvas context.
4. Model, generation method, input roles, and parameters are derived from one
   reviewed capability catalog and never from renderer-specific branches.
5. Changing a model or generation method preserves compatible values, reports
   every incompatible value it changes, and never silently removes a graph edge
   or input binding, or silently changes an input role.
6. The primary action always explains the next blocker. When ready, the same
   action saves the Draft, freezes one Attempt, and submits at most one paid
   provider task.
7. Waiting, running, cancellation, failure, interruption, Retry, and sealed
   Result behavior survive Composer dismissal, Agent Area closure, and restart.
8. Automated tests cover the complete connection-to-Result path without a real
   secret or paid provider call. A separately gated live-provider check covers
   production transport before release.

Visual polish alone does not satisfy this outcome. A screenshot-perfect model
picker with an incomplete state, persistence, execution, or test path is not a
finished Video node.

## 3. Scope

### 3.1 In scope

- empty Video Draft creation and selection;
- the Video card's Draft, Attempt, failure, and Result presentation;
- the node-adjacent Composer;
- model, settings, inputs, and Attempts child popovers;
- the global Models & Providers connection flow entered from the model picker;
- reviewed model capability resolution and settings normalization;
- input selection, role assignment, ordering, and readiness;
- paid-run disclosure, submission, progress, cancellation, failure, Retry, and
  sealed Result presentation;
- keyboard, focus, screen-reader, viewport, and narrow-window behavior;
- unit, integration, Electron smoke, and opt-in live-provider verification.

### 3.2 Out of scope

- a second workflow canvas or extension-owned scene;
- a permanent right-side node inspector;
- free-form provider endpoints or model IDs in the Video Composer;
- a canvas-level Run action or automatic downstream execution;
- multiple successful files inside one Video Result;
- replacing or regenerating a sealed Result in place;
- timeline editing, trimming, compositing, color work, enhancement, or final
  movie assembly;
- reference, edit, extension, or custom-audio modes whose reviewed local
  transport is not executable;
- a hidden “test generation” that can create a billable provider task.

Unavailable future capabilities may appear only when the reviewed catalog has
an actionable reason and the UI can distinguish them from missing credentials.
They must never appear as inert Result-toolbar controls.

## 4. Ownership and sources of truth

| Concern | Owner | Durable source |
| --- | --- | --- |
| card, Composer placement, selection, canvas viewport | BaseHalf host | canvas and host interaction state |
| Draft, Attempt, Result, prompt, Recipe, model snapshot, input bindings | BaseHalf host | `.bhnode` |
| reference edge | BaseHalf host | main reference graph |
| provider, deployment, region, exact model revision, modes, parameters, constraints | reviewed plugin contribution | video model catalog |
| connection form, fixed/allowlisted endpoint policy | reviewed plugin contribution, rendered by host | provider-connection catalog |
| credentials | BaseHalf host | system credential store |
| provider request construction and polling | reviewed Recipe executor | immutable Attempt plus short-lived credential access |
| generated MP4 | BaseHalf host | ordinary local project file sealed by the Result |
| transient popover, search, hover, and pending reconciliation state | BaseHalf host | memory only |

The renderer must not maintain a second model matrix. The model picker, settings
popover, readiness evaluator, persisted snapshot, execution preflight, and
executor must consume the same reviewed capability data.

## 5. Product vocabulary

- **Draft**: editable Video node before its first Attempt.
- **Model**: one exact reviewed provider/deployment/region/model/revision entry.
- **Generation method**: a model-scoped mode such as text-to-video,
  first-frame-to-video, or first-last-frame-to-video.
- **Frame input role**: the semantic use of an Image input as a start frame or
  end frame. A frame role is not a model setting.
- **Connection**: one verified machine-local provider credential and its
  non-secret endpoint scope.
- **Input binding**: the target-owned role assigned to one direct reference.
- **Selection validity**: whether an exact model and generation method exist and
  are reviewed for the selected connection.
- **Input readiness**: whether the selected method currently has the required
  prompt and media inputs.
- **Settings normalization**: deterministic preservation or repair of parameter
  values under the selected capability matrix.
- **Attempt**: one immutable submission snapshot.
- **Result**: one sealed local Video artifact.

Selection validity and input readiness are separate. A user must be able to
select first-frame-to-video before attaching a first frame. The method is valid
while the Draft is incomplete; the Generate action explains the missing input.

**Start + End Frames is a model-scoped generation method, not a global boolean
setting.** It is selectable only when the selected exact model declares the
`first-last-frame-to-video` capability. Selecting it requires exactly one Start
frame and one End frame before Generate; missing either frame is an input
readiness problem, not an unsupported-model problem. A model may instead offer
Start Frame only, both frame methods, neither frame method, or a single fixed
method.

## 6. End-to-end user journey

### 6.1 Create and author before setup

1. Creating an empty Video node immediately creates a saved `.bhnode` Draft and
   a visible card.
2. Selecting the card mounts one Composer centered below it when the pair fits.
3. The prompt receives focus on first Composer mount.
4. Prompt edits remain in the stable textarea DOM while child popovers open,
   close, or update.
5. The user may leave for model setup before the Recipe is complete. BaseHalf
   checkpoints only the valid title, role, and prompt; it never persists a
   half-valid provider identity or capability snapshot.

### 6.2 Choose a model

1. The model trigger opens the model popover. It does not open Quick Input or a
   generic settings page.
2. The popover lists reviewed models contributed by installed, admitted video
   generators, including models whose connection is not configured.
3. Selecting an available model updates the in-memory Draft, keeps the popover
   open, focuses the selected row, and exposes a concise reconciliation notice.
4. Selecting a locked model starts the connection-return transaction in
   section 10.
5. Selecting a catalog-unavailable model is impossible. The row stays visible
   and exposes the catalog reason on screen and through accessibility text.

### 6.3 Configure generation

1. The settings trigger opens a schema-driven settings popover for the selected
   exact model.
2. The generation-method choices are derived only from that exact model. The
   user may choose a method even when its required inputs are not present.
3. Settings are rendered in catalog order and update the in-memory Draft
   immediately. There is no nested Apply button.
4. Any automatic repair is shown as an old-to-new adjustment before the notice
   can disappear.
5. The Composer footer summary updates from the same canonical in-memory values.

The UI uses distinct user-facing labels for distinct semantics:

- **Text to Video**: no frame role;
- **Start Frame**: exactly one required Start frame and no End-frame slot;
- **Start + End Frames**: exactly one required Start frame and one required End
  frame;
- **References**: one or more catalog-declared reference inputs, not temporal
  endpoints.

The renderer must not use “Start + End Frames” as an umbrella label for a
Start-Frame-only capability.

### 6.4 Attach inputs

Inputs can enter through either path:

- create or reconnect a normal reference edge into the Video node, then assign
  its target-owned role; or
- choose **Add input** in the Composer, enter canvas-pick mode, and select one
  compatible saved source node. BaseHalf creates the edge and binding as one
  undoable transaction.

The Composer displays assigned inputs as ordered, removable chips. A chip shows
its role, source identity, content kind, and integrity/readiness problem when
one exists. Changing or removing a chip is explicit and undoable.

### 6.5 Generate and observe

1. The primary action opens the surface for the first blocker until the Draft
   is ready.
2. For a ready Draft it saves the canonical configuration, obtains any required
   paid-run authorization, and begins one Attempt.
3. The Attempt is durable before provider submission.
4. The card and Composer show preparing, waiting, generating, and cancelling
   states independently of Agent Area.
5. Success seals exactly one verified MP4 Result. Failure or cancellation keeps
   the Attempt inspectable without creating a fake Result.

### 6.6 Continue after completion

- A sealed Result plays in the card and exposes the Result toolbar defined by
  the domain contract.
- **Copy Settings to New Draft** is the path for changed prompt, model,
  parameters, or inputs.
- Exact Retry appears only for a failed, cancelled, or interrupted Attempt with
  a complete frozen snapshot. Retry does not reopen editable settings.
- Output missing or changed never falls back to another successful file.

## 7. State model and primary action

The UI derives state from the saved node document, the local Composer draft,
the active execution lease, connection availability, graph verification, and
Result integrity. It must not infer lifecycle from transient button state.

| State | Required presentation | Primary action |
| --- | --- | --- |
| empty Draft, no model | blank Video card; prompt remains editable | **Choose model** |
| locked model intent | model row says connection required | **Connect provider** from the row |
| selected model, missing prompt/input | exact missing requirement is visible | **Add input** or **Write prompt** |
| selected model, invalid setting matrix | adjustment/error notice is visible | **Review settings** |
| ready with unsaved edits | card remains Draft; footer marks unsaved | **Generate**, which saves first |
| preparing | immutable Attempt exists; no provider id may exist yet | disabled progress action |
| waiting | remote task accepted and durably acknowledged | **Cancel** |
| generating | progress when provider evidence exists, otherwise indeterminate | **Cancel** |
| cancelling | cancellation request is in progress | disabled **Cancelling** |
| failed with complete snapshot | error and Attempt details remain | **Retry** |
| failed without complete snapshot | error explains why exact Retry is unsafe | **New Draft** |
| cancelled or interrupted with complete snapshot | terminal status remains visible | **Retry** |
| sealed Result, integrity available | playable local artifact | **Open video** or Result toolbar action |
| sealed Result, file missing/changed | integrity failure, no alternate file | **Locate details** / **New Draft** |

Only one primary action is shown. A disabled action must expose its blocking
reason in `title`, `aria-label`, and the Composer status region. Hover is not
the only way to discover a blocker.

## 8. Surface architecture

### 8.1 Card

The card owns only:

- Video identity and title caption;
- blank state or in-card playback;
- lifecycle status and bounded progress;
- selection and graph ports.

The resting card must not show provider, model, parameter, cost, prompt, or
input chips. Those belong to the Composer or Attempt details. The Result card
does not expose Draft settings as editable controls.

### 8.2 Node-adjacent Composer

The Composer is fixed in screen space while the canvas zooms. Its compact
anatomy is, from top to bottom:

1. an input-chip strip with **Add input**;
2. one stable multiline prompt field or frozen prompt copy;
3. a footer containing the model trigger, settings summary trigger, Attempts
   trigger when Attempts exist, and one primary action.

The Composer is not a dialog and is not modal. It remains selected-node chrome,
not another Card Detail page. It must not resize into a full settings form.

On first mount, the canvas may pan only enough to keep the card/Composer pair
visible. Opening or changing a child popover must preserve:

- the selected card;
- the canvas viewport transform;
- card and Composer bounds;
- the prompt DOM node, value, selection, and IME composition;
- the popover scroll position and focused logical option after a schema rerender.

If the entire pair cannot fit, clamp the Composer horizontally inside the
canvas and allow the card to be partially off-screen. Do not resize the card or
pan the canvas merely to fit a popover.

### 8.3 Child popovers

Exactly one of these Composer-owned child popovers may be open:

- Models;
- Settings;
- Inputs;
- Attempts.

They are non-modal dialogs anchored to their trigger. They may temporarily
cover the card. They scroll or clamp internally at the canvas viewport edge and
never cause a second canvas pan.

Pointer and keyboard behavior:

- clicking another trigger switches popovers in place;
- clicking within the selected card or Composer does not dismiss the Composer;
- clicking blank canvas closes the child popover, saves a valid mutable Draft,
  then dismisses selection according to the host selection contract;
- first `Escape` closes the child popover and returns focus to its trigger;
- second `Escape` returns focus to the selected card without discarding edits;
- tab order stays inside ordinary document order; there is no modal focus trap.

### 8.4 Result toolbar

The Result toolbar remains above a selected, verified Result and contains only:

1. Copy Settings to New Draft;
2. Show Details;
3. More Actions;
4. Open Full Preview.

It does not appear for Drafts, active Attempts, failures without a Result, or
unverified artifacts.

Once one exact sealed artifact has been verified, an unrelated canvas render
or a corrected node-file stat must retain its verified media and toolbar while
fresh verification runs in the background. This retention is keyed by the
complete sealed-artifact identity, not only its path. A changed artifact
identity or a fresh missing/changed verdict removes Result-only controls.

## 9. Model picker

### 9.1 User-facing model abstraction

The user chooses a model, not a Recipe plus connection plus free-form model ID.
Each model row maps internally to exactly one tuple:

```ts
interface VideoModelChoice {
  recipeId: string;
  catalogId: string;
  providerId: string;
  deploymentId: string;
  region: string;
  modelId: string;
  revision: string;
  connectionSpecId?: string;
  connectionServiceId?: string;
}
```

The tuple is resolved from admitted extension contributions. None of these
fields are typed manually in the Video Composer.

### 9.2 Row anatomy

Every row shows:

- model label;
- concise capability summary derived from executable modes, such as maximum
  resolution, duration range, native-audio support, and available method
  families such as Text, Start Frame, Start + End Frames, or References;
- provider or deployment label only when it disambiguates identical names;
- exactly one state: Selected, Available, Connect, Unavailable, or Needs review.

The capability summary must not claim a value merely because it exists in an
unavailable mode. It summarizes only executable reviewed capabilities.

The selected row uses both a check state and `aria-pressed="true"`. Color alone
does not communicate selection. Locked rows remain clickable because they own
the connection flow. Catalog-unavailable rows are disabled and include the
reason as visible secondary copy, `title`, and accessibility description.

### 9.3 Ordering, grouping, and search

- Preserve catalog order within a provider deployment; this is reviewed product
  order, not alphabetical model-id order.
- Group by provider and connection scope only when more than one scope is
  present.
- When more than twelve models are visible, render an in-popover search field.
  Search matches model, provider, deployment label, and executable capability
  labels. Search is transient and does not change the Draft.
- The selected model remains findable even if it no longer matches the current
  search text; show it in a pinned Selected section until the query clears.

### 9.4 Selection transaction

Selecting an available model performs one in-memory transaction:

1. resolve the exact Recipe/catalog/model/connection tuple;
2. preserve the current generation method when the new model declares it;
3. otherwise choose the first executable method in reviewed catalog order;
4. preserve settings with the same parameter id, scalar type, and legal value;
5. default new settings and constrain incompatible settings deterministically;
6. preserve prompt and every graph edge;
7. preserve input bindings until the user explicitly resolves any incompatible
   roles; never delete or relabel them automatically;
8. record a reconciliation result for the UI;
9. leave the Draft unsaved until normal Composer save or Generate.

The transaction never infers a method from the number or kind of currently
attached inputs. In particular, two image edges do not automatically select
Start + End Frames, and a missing End frame does not automatically downgrade
Start + End Frames to Start Frame. The catalog order supplies a deterministic
fallback when the previous method is unavailable; the reconciliation notice
must name both the previous and selected methods.

```ts
interface VideoDraftReconciliation {
  choice: VideoModelChoice;
  mode: BaseHalfVideoGenerationMode;
  settings: BaseHalfVideoSettings;
  adjustments: readonly {
    parameterId: string;
    label: string;
    kind: 'defaulted' | 'constrained' | 'removed';
    previousValue?: BaseHalfVideoModelScalar;
    value?: BaseHalfVideoModelScalar;
    reason: string;
  }[];
  inputProblems: readonly VideoInputProblem[];
}
```

The model popover shows a compact summary such as “2 settings updated; first
frame still required.” The Settings popover shows the full old-to-new list.
Notices persist until the user changes another model/method, explicitly
dismisses the notice, or successfully saves the reviewed configuration.

## 10. Connection and verification loop

### 10.1 Entering setup from a locked model

Clicking a locked row creates a one-shot return intent containing:

- scene key;
- node path and immutable node id;
- Recipe and catalog id;
- exact model key;
- provider-connection spec id;
- a random request id.

Before leaving the canvas, BaseHalf saves a valid Draft. If model state is still
incomplete, it checkpoints only title, role, and prompt. Pending input removals,
unverified model state, endpoints, and credentials never enter the node file.

The connection editor opens directly on the matching provider and service
scope. It must not ask the user to choose the same provider or model again.

### 10.2 Provider form

The form renders only reviewed fields from the connection catalog. The user
does not see internal provider id, deployment id, authorization type, or a
fixed endpoint. An allowlisted host field appears only for providers whose
official regional contract requires it.

The screen explains:

- which provider and region the credential must belong to;
- which reviewed models the connection unlocks;
- that the credential stays in the system credential store;
- that **Verify & Connect** makes a read-only provider request and never starts
  video generation.

### 10.3 Verification states

| State | Behavior |
| --- | --- |
| validating local fields | focus the first invalid field; make no request |
| verifying | disable fields and actions; announce progress |
| accepted | atomically stage, encrypt, commit, and expose the connection |
| rejected credential | keep the secret only in the live field; do not save it |
| provider unavailable | do not save a new credential; give a retryable error |
| storage failure | fail closed and clean staged credential state |
| existing connection verified | allow **Test connection**, **Replace key**, and **Remove** |

**Test connection** is a read-only revalidation of the stored credential. It
does not change project files, model selections, or billing state. A failed
test marks the machine-local connection as needing attention but does not erase
the credential; the user may replace or remove it. Nodes using that connection
remain non-runnable until a later successful test or replacement.

### 10.4 Returning to the Draft

After a successful connection, BaseHalf consumes the one-shot intent and closes
the connection editor. It returns to the same scene and node only when all
immutable target fields still match and the node is still an editable Draft.

On an exact match:

- restore the prior canvas viewport and selected card;
- mount one Composer with the same prompt and input bindings;
- select only the model that initiated setup;
- open Settings;
- show “Connection verified. Review settings before generating.”

If the target changed, do not apply the model to another node or reused path.
Return to the canvas, open Models for the current Draft when possible, and
explain that the previous setup target is stale.

Cancelling setup returns without selecting the locked model. The prompt
checkpoint remains saved.

## 11. Settings popover

### 11.1 Structure

The popover renders, in this order:

1. exact selected model heading and connection status;
2. generation method;
3. catalog parameters in declared order;
4. full reconciliation notice;
5. readiness problem relevant to model/settings;
6. reviewed source link and verification date in a low-priority disclosure.

Common parameter labels include Aspect ratio, Resolution, Duration, Generate
audio, and provider-neutral advanced switches. The UI does not hard-code their
presence or order.

### 11.2 Model-scoped generation methods

Generation method is the first setting group because it changes both the
parameter schema and the input-role schema. Its options come from the selected
exact model's executable reviewed modes:

- zero executable methods makes the model unavailable rather than selectable;
- one executable method renders as a fixed value with explanatory copy, not a
  one-item segmented control that implies choice;
- two to four short methods render as a segmented radio group;
- more or longer methods render as a listbox.

Frame methods have these provider-neutral contracts:

| Method id | User label | Frame slots | Ready condition |
| --- | --- | --- | --- |
| `text-to-video` | Text to Video | none | catalog prompt rule passes |
| `first-frame-to-video` | Start Frame | one Start frame | exactly one accepted Start frame plus the catalog prompt rule |
| `first-last-frame-to-video` | Start + End Frames | one Start frame and one End frame | exactly one accepted image in each role plus the catalog prompt rule |

Reference, edit, and extension methods use their own catalog-declared roles and
must not be presented as frame methods merely because they accept images.
Prompt optionality also comes from the selected capability; it is not inferred
from the presence of a frame.

Changing the method immediately updates the visible parameter controls and
active input slots. It does not wait for Apply and does not submit anything.
The selected method remains valid while a required slot is empty.

### 11.3 Selectable is not ready

Capability resolution must be split into two stages:

```ts
interface ResolvedVideoCapability {
  descriptor: IBaseHalfVideoModelDescriptor;
  capability: IBaseHalfVideoModeCapability;
  selection: Omit<IBaseHalfVideoModelSelection, 'inputs'>;
}

interface VideoInputEvaluation {
  counts: BaseHalfVideoInputState;
  problems: readonly VideoInputProblem[];
  ready: boolean;
}
```

The first stage exact-matches model identity, revision, connection scope, mode,
and catalog availability. It does not reject a mode merely because its required
inputs are not attached yet. The second stage evaluates current input counts,
prompt limits, media kind, source integrity, and provider transport limits.

Settings normalization consumes the resolved capability plus current input
counts for conditional visibility and constraints. Execution requires both a
supported capability and an input evaluation with no problems.

The existing all-in-one resolver may remain as an execution convenience, but
the Composer must use the split model so incomplete Drafts are configurable.

### 11.4 Control types

- Enum with at most eight short options: segmented radio group.
- Enum with more options or long labels: select/listbox.
- Numeric range with at most fifteen discrete values: segmented radio group.
- Larger numeric range: slider plus editable numeric value and unit.
- Boolean: On/Off radio group unless the catalog label describes a conventional
  independent toggle.

Each control exposes a programmatic label, selected state, disabled state, and
reason. Arrow keys follow native radio/listbox behavior. Rebuilding the schema
after a choice restores focus to the same logical parameter or its replacement.

### 11.5 Hidden and disabled settings

- `visibleWhen === false`: omit the setting because it does not participate in
  the current request.
- visible but disabled parameter: keep the group visible and show the declared
  reason directly below it.
- unavailable enum option: keep it visible, disabled, and expose its reason.
- selected value made invalid by another setting: move to the deterministic
  legal value and record an old-to-new adjustment.
- setting not declared by the new model/method: remove it from canonical values
  and record a removed adjustment.

Grey text alone is never sufficient explanation. No disabled control may rely
only on a hover tooltip.

### 11.6 Summary trigger

The Composer settings trigger shows, when available:

1. generation method;
2. aspect ratio;
3. resolution;
4. duration;
5. audio state only when it differs from a clear model default.

It uses option labels from the resolved schema, never raw internal values. If
the Draft has a capability or normalization problem, the trigger gains a
warning state without replacing the summary with a long error.

### 11.7 Cost and paid-run language

Do not show a numeric cost or credit count unless it comes from a reviewed,
dated pricing contract with explicit currency, unit, region, and uncertainty.
Catalog capability metadata alone is not pricing evidence.

Before the first paid submission for an exact Draft, the host disclosure shows
provider, model, method, material settings, and whether provider billing
applies. If no trustworthy estimate exists, it says that the exact charge is
determined by the provider. The user confirmation authorizes one Attempt, not
future runs or automatic downstream work.

## 12. Inputs

### 12.1 Frame-slot interaction

The Composer renders frame roles as named temporal slots before the prompt, not
as generic image chips:

- Start Frame shows a Start label, thumbnail or empty placeholder, and
  Replace/Remove actions when filled;
- End Frame shows an End label, thumbnail or empty placeholder, and
  Replace/Remove actions when filled;
- Start + End Frames places the two slots left-to-right with a directional
  connector so their temporal order is visible without relying on color;
- Start Frame shows only the Start slot; Text to Video shows neither slot;
- both slots expose their role in accessibility name and description.

Choosing an empty slot enters role-specific canvas-pick mode. Its banner says
**Select Start Frame Image** or **Select End Frame Image**, and only compatible
saved Image sources are eligible. Returning from the picker fills only the
requested role. Cancelling preserves the existing method, parameters, edges,
bindings, and focus.

For Start + End Frames, Start and End are independently required. With only
Start filled, the End placeholder remains actionable and the primary blocker
is **Add End Frame**. With only End filled, it is **Add Start Frame**. A filled
slot is never discarded merely because the other slot is empty.

The role-specific picker is an exclusive Composer child state. One `Escape`
must cancel it and restore the originating slot; cancellation or success must
never fall through to generic graph-connection mode. Input selection is
request/epoch-scoped and exactly once. The owning input specification defines
the complete asynchronous state machine, Draft checkpoint, cancellation, and
watcher-acknowledgement requirements.

When both roles are filled, **Swap Start and End** is available. Swap is one
explicit undoable transaction that exchanges the two target-owned roles while
preserving source nodes and graph edges. It is unavailable when either role is
empty. Thumbnail preview, Replace, Remove, and Swap have separate controls and
accessible names.

### 12.2 Composer chip strip

Assigned inputs appear before the prompt in binding order. Each chip includes:

- thumbnail or content-kind icon;
- role label;
- compact source title/path;
- missing/changed/unverified indicator when applicable;
- remove action.

For roles with multiple items, drag or Move Earlier/Later changes only order
within that role. Ordering is persisted through the normal binding `order` and
is included in the Attempt snapshot.

Unresolved bindings that are not accepted by the current method appear in a
separate **Needs review** group after the active slots. They never disappear
because the active slot layout changed.

### 12.3 Add-input flow

The Inputs popover first lists already connected, compatible context. It also
offers **Pick from canvas** when an input slot has remaining capacity.

Canvas-pick mode:

1. closes the Inputs popover but keeps the Video node selected;
2. shows a small fixed banner naming the requested role and **Cancel**;
3. dims ineligible nodes without changing their selection or graph state;
4. lets the user choose one saved, compatible source node;
5. creates edge plus target binding atomically;
6. returns focus to the new input chip and reopens Inputs;
7. cancels with `Escape` or banner action without mutation.

No file chooser appears unless the user explicitly chooses an import action on
an eligible empty media Draft.

### 12.4 Model and mode changes

A model or method change never removes an existing edge, binding, or user file.
After reconciliation, each binding is classified as:

- accepted by the current method;
- accepted by the Recipe but unused by the current method;
- incompatible with the current method;
- missing or integrity-failed.

The latter three block Generate and appear in Inputs with an explicit action:
choose another role, choose another method, or remove the input. Removing a
binding from Inputs removes its direct edge in the same undoable transaction,
because an edge exists only for a real target input.

Role conversion is never automatic. For example, switching from Start + End
Frames to Start Frame keeps Start active and places the End-frame binding in
Needs review with **Use Start + End Frames** and **Remove End Frame** actions.
If a future executable method offers another compatible role, the UI may
suggest a conversion, but only the user's explicit action changes the
target-owned role. That action is one undoable binding transaction and its
confirmation copy names the old and new roles. Switching back before any
conversion restores the binding to the active End slot without changing graph
state.

The current host binding schema permits one target-owned role per direct source
path. A source already bound as Start is therefore ineligible for End in the
same Draft, and vice versa; canvas-pick mode shows that reason instead of
creating a duplicate edge or silently moving the existing role. Supporting one
source in multiple simultaneous roles requires a separately versioned binding
contract and is outside this specification.

Likewise, selecting a new model may preserve Start + End Frames only when the
new exact model declares that same method. Otherwise the deterministic fallback
method is selected, existing frame roles remain unchanged in Needs review, and
the reconciliation notice names the method change and every unresolved role.

## 13. Draft persistence and execution preflight

### 13.1 Saved Draft

The saved Recipe contains:

- exact Recipe id;
- exact model service id and official model id;
- canonical provider-neutral scalar settings;
- one host-owned `videoModelSnapshot`;
- ordered input bindings.

The model snapshot contains catalog id, provider/deployment/region, official
model id, revision, method, and derived input counts. It contains no endpoint,
secret, service label, price, transient notice, or popover state.

An incomplete Draft may persist a valid model/method selection and its current
input counts. Missing inputs are readiness problems, not corrupt selection.

### 13.2 Generate transaction

Generate performs these checks in order:

1. node is still the same editable Draft;
2. no working-copy or external-configuration conflict exists;
3. selected Recipe and catalog owner are installed and admitted;
4. connection is configured, verified, and matches exact service scope;
5. exact model revision and generation method are still reviewed and executable;
6. settings normalize to the same canonical values shown in the Composer;
7. prompt and input evaluation have no problem;
8. every input is a saved direct source with matching identity, kind, integrity,
   and size/format bounds;
9. paid-run authorization, when required, covers this exact request;
10. canonical Draft save succeeds;
11. one immutable running Attempt is written;
12. executor activation and provider submission begin.

Failure in steps 1–10 creates no Attempt and no provider request. Failure after
step 11 terminates the Attempt honestly. No code path may submit first and try
to persist the Attempt later.

### 13.3 Attempt disclosure

Attempt details expose:

- status and timestamps;
- frozen prompt;
- Recipe and exact model identity;
- canonical settings;
- ordered input source identities and revisions;
- provider request id when durably acknowledged;
- bounded usage and cost evidence when returned;
- sanitized error and recovery action;
- Result artifact identity for a successful Attempt.

Secrets, endpoints containing credentials, provider response bodies, and
untrusted remote markup never appear.

## 14. Execution, cancellation, and recovery

- Paid task creation is never automatically retried after an ambiguous submit.
- The remote task id is durably acknowledged before the first poll.
- Poll reads may retry within reviewed bounds; a transient poll error never
  creates a replacement task.
- Cancellation changes the local Attempt to terminal even when remote
  cancellation is unavailable or too late. Late success cannot seal a Result.
- Restart recovery resumes a durably identified remote task or marks an
  unidentifiable active Attempt interrupted. It never guesses a task id.
- Exact Retry reads the frozen task first. It may submit a replacement only
  after proving the old task failed or was cancelled and the provider contract
  permits replacement.
- Download is credential-free HTTPS, bounded to 256 MiB, and verified as MP4
  before the project artifact is written.
- The final cancellation/integrity check happens after writing and before
  sealing. A late cancellation removes the provisional file.

## 15. Keyboard, focus, and accessibility

- Card `Enter`: mount/focus Composer.
- Composer `Cmd/Ctrl+Enter`: Generate or exact Retry only when that action is
  ready; never bypass paid-run disclosure.
- `Escape`: close the innermost child surface first, then return focus to card.
- Model and segmented setting groups expose native radio semantics and selected
  state.
- Provider rows and model rows support Arrow keys, Home, and End.
- Status changes use one polite live region; terminal provider/connection errors
  use an alert only when immediate attention is required.
- IME composition suppresses rerender/save work until composition ends.
- Focus restoration uses stable logical keys, not stale DOM references.
- Reduced-motion preference removes popover and attached-chrome transitions.
- At 200% text zoom and a 320 CSS-pixel canvas width, all controls remain
  reachable without horizontal page scrolling.

### 15.1 Shared status and primary-action precedence

Every Composer child surface projects semantic problems into one deterministic
priority order:

1. current transaction failure or stale/external conflict;
2. terminal Attempt, recovery, or artifact-integrity problem;
3. invalid exact model, capability, or connection;
4. input readiness or retained-binding blocker, with Start before End;
5. model/settings adjustment history;
6. neutral reviewed-source or informational metadata.

Only the highest current blocking problem controls the Composer primary action
and disabled reason. Lower-priority items remain visible in their owning
details section; they are not discarded. A settings adjustment is non-blocking
and cannot replace **Add Start Frame**, **Add End Frame**, **Review inputs**, or
an execution/recovery error merely because its asynchronous update arrived
later. Composer, Settings, Inputs, and paid-run preflight consume the same
semantic problem ordering rather than comparing localized text or DOM order.

## 16. Implementation boundaries

### 16.1 Pure model layer

`basehalfVideoModels.ts` owns provider-neutral parsing, exact selection,
settings normalization, input evaluation, and reconciliation data. It contains
no provider/model id branches and no DOM code.

Split the current resolution responsibilities so UI selection can resolve a
valid but incomplete method. Keep an execution helper that combines capability
resolution with strict input readiness when useful.

Do not add a renderer-owned `supportsFirstLastFrame` flag or a global
`useFrames` boolean. The selected descriptor's `modes` collection is the only
source for method availability, and each resolved mode's `inputs` collection is
the only source for Start/End slot presence and required counts.

### 16.2 Testable presentation model

Extract a pure Video Composer presentation model from the workbench
contribution. It should derive:

- model rows and their five states;
- selected model summary;
- generation-method rows;
- rendered parameter controls;
- reconciliation notice;
- input chips/problems;
- primary action, disabled reason, and Attempt/result actions.

The workbench layer renders this model and coordinates services. Tests must not
need to parse localized DOM strings to prove every state transition.

### 16.3 Host workbench

The host owns:

- Composer and child-popover lifecycle;
- selection, geometry, viewport, focus, and draft merge behavior;
- graph/binding transactions and undo;
- connection-return intent;
- save, preflight, Attempt lifecycle, paid authorization, and Result integrity.

### 16.4 Plugin

The video plugin owns:

- reviewed connection and model catalogs;
- official documentation links and verification dates;
- connection validators;
- provider request adapters, polling, cancellation, and download parsing.

The plugin never renders the Composer, stores credentials, or maintains a
parallel lifecycle database.

## 17. Testing strategy

### 17.1 Pure contract tests

Required cases for the model layer:

- strict catalog parsing, limits, duplicate identity, and unknown fields;
- exact provider/deployment/region/model/revision matching;
- valid-but-incomplete generation method selection;
- exact model controls which generation methods exist;
- Start Frame and Start + End Frames remain distinct capabilities;
- method fallback never depends on attached input counts;
- separate input min/max/readiness diagnostics;
- mode change before inputs exist;
- deterministic compatible-value preservation;
- every defaulted, constrained, and removed adjustment;
- impossible constraint intersection fails closed;
- hidden, disabled, and unavailable parameter semantics;
- prompt limit and input media bounds;
- stale snapshot, foreign catalog, changed connection scope, and catalog
  revision behavior;
- stable capability summary derived only from executable modes.

### 17.2 Host service tests

Required cases:

- prompt-only provisional save before locked setup;
- one-shot connection intent exact return, cancellation, stale node id, reused
  path, changed Recipe, and changed scene;
- successful and failed stored-credential revalidation;
- credential staging, replacement, failure cleanup, and secret redaction;
- model change preserves graph and reports incompatible bindings;
- method change preserves roles and requires explicit role conversion;
- Start/End swap exchanges roles without changing edges or source paths;
- input pick creates edge plus binding atomically; cancellation creates neither;
- removing an input removes edge plus binding in one undo unit;
- external Agent edit merges non-overlapping fields and blocks overlapping
  configuration changes;
- preflight failure before Attempt and provider invocation;
- immutable Attempt before provider invocation;
- ambiguous submit, durable provider id, poll retry, cancellation, restart,
  exact Retry, late success, bounded download, MP4 verification, and one Result.

### 17.3 DOM/component tests

Required behavior:

- exactly one Composer and one child popover;
- prompt DOM/value/selection/IME survives model and settings changes;
- selected/locked/unavailable model row semantics;
- single-method fixed presentation and multi-method radio/listbox presentation;
- Start, End, missing-frame, Replace, Remove, and Swap slot states;
- disabled setting has visible and accessible reason;
- reconciliation shows old and new values;
- switching popovers preserves card/Composer/viewport bounds;
- Escape and focus return order;
- search threshold, filtering, pinned selected row, and keyboard navigation;
- 200% text zoom, reduced motion, narrow canvas, and high-contrast theme.

### 17.4 Electron smoke

The compile-backed smoke must use a disposable workspace and process-only fake
provider seams. It exercises this complete path:

1. create/open an empty Video Draft;
2. type a prompt;
3. open Models and choose a locked reviewed model;
4. verify a fixed non-secret fake credential;
5. return to the exact Draft and model;
6. choose Start + End Frames before adding an input and observe the
   missing-Start blocker;
7. pick a Start frame and observe the missing-End blocker without losing Start;
8. pick an End frame and verify two role bindings and two graph edges;
9. change a setting and verify summary/persistence;
10. approve the fake paid-run disclosure;
11. save, create Attempt, receive fake progress, download a bounded fake MP4,
    and seal one Result;
12. restart and verify playback identity and Attempt disclosure;
13. copy settings to a new Draft and verify the old Result is unchanged.

The fake seam is unavailable to normal launchers and packaged applications. It
accepts only fixed non-secret markers and must exercise the same host state
machine as production.

### 17.5 Opt-in live-provider release check

Live checks are never part of ordinary CI. A maintainer explicitly supplies a
provider-scoped test credential and spending cap. The check uses the smallest
reviewed text-to-video request, records no secret or response body, downloads
one MP4, and deletes only its disposable fixture workspace afterward.

Run at least one live check per executable provider adapter before a release
that changes its connection validator, request mapping, polling, cancellation,
or download behavior. A passing mock smoke does not substitute for this gate.

## 18. Acceptance scenarios

### A1. Prompt survives locked setup

Given an empty Video Draft with an unsaved prompt, when the user chooses a
locked model, verifies the matching provider credential, and returns, then the
same node is selected, the prompt is unchanged, the exact model is selected,
Settings is open, and no paid task has been created.

### A2. Setup target becomes stale

Given a pending connection intent, when the original node is deleted or its
path is reused before verification completes, then the credential may be saved
machine-locally but the model is not applied to the new node. The canvas
explains that the setup target changed.

### A3. Method selected before input

Given an available Start-Frame-capable model and no image input, when the user
selects Start Frame, then the method stays selected and settings remain
editable. Generate is blocked with **Add Start Frame**, not “model
unsupported.”

### A4. Model switch reports repairs

Given a Draft with a legal high-resolution, long-duration combination, when the
user chooses a model that supports neither value, then the new model is selected,
canonical defaults are applied, the full old-to-new adjustment list is visible,
and the graph and inputs are unchanged.

### A5. Disabled option explains itself

Given a visible catalog option disabled by a constraint or rollout, then its
reason is visible on screen, available to assistive technology, and tested. A
click does not change the canonical value.

### A6. Input picked from canvas

Given a selected method requiring one first frame, when the user chooses Pick
from canvas and selects a compatible Image Result, then exactly one reference
edge and one first-frame binding are committed in one undo unit. Undo removes
both; cancel creates neither.

### A7. Model change does not delete input

Given an assigned input incompatible with a newly selected model/method, when
the model changes, then the edge and binding remain, Inputs identifies the
problem, and Generate stays blocked until the user explicitly resolves it.

### A8. Canonical save matches presentation

Given a ready Draft, when it is saved, then the settings summary, persisted
scalar values, model snapshot, input counts, and executor preflight represent
the same canonical configuration.

### A9. Submit failure before remote acceptance

Given a ready saved Draft, when provider submission fails unambiguously before
acceptance, then one failed Attempt remains, no Result exists, and no automatic
paid retry occurs.

### A10. Ambiguous submit

Given a transport failure whose provider acceptance is unknown, then the
Attempt fails closed, Retry does not blindly resubmit, and Attempt details
explain the ambiguity without exposing untrusted response content.

### A11. Cancel and late success

Given a running Attempt, when the user cancels and the provider later reports
success, then the node remains Cancelled, no Result is sealed, and any
provisional file is removed.

### A12. Successful Result

Given a successful provider task and a verified MP4 download, then the same
node becomes one sealed Result, the file plays locally, the Result toolbar is
available, and changing settings requires Copy Settings to New Draft.

### A13. Restart recovery

Given a running Attempt with a durable provider id, when BaseHalf restarts,
then recovery resumes polling that task without resubmitting. Given no durable
id, the Attempt becomes Interrupted and does not guess.

### A14. Connection test failure

Given a previously connected provider, when Test connection is rejected, then
no project file changes, the credential is not echoed or deleted, the
connection becomes Needs attention, and affected Drafts are non-runnable until
repair or a later successful test.

### A15. Popover does not move the canvas

Given a selected Video card and Composer, when the user opens Models, switches
to Settings, changes a parameter, and opens Inputs, then the card bounds,
Composer bounds, canvas viewport, prompt DOM, prompt value, and selection range
remain unchanged.

### A16. Frame methods follow the exact model

Given a model that declares Text to Video and Start + End Frames, when Settings
opens, then both methods are selectable. Given a different model that declares
only Text to Video, Start + End Frames is absent rather than disabled by missing
inputs. Given a model with one executable method, that method is shown as a
fixed value rather than a fake choice.

### A17. Start and End are distinct required roles

Given Start + End Frames with no inputs, when the user picks one Start frame,
then the Start thumbnail remains visible, the End slot remains empty and
actionable, and Generate reports **Add End Frame**. Adding End produces exactly
one binding for each role. Removing End does not remove or relabel Start.

### A18. Method change never silently relabels a frame

Given Start and End bindings, when the user changes from Start + End Frames to
Start Frame, then Start remains active, End remains an End-frame binding in
Needs review, and both graph edges remain. Generate is blocked until the user
returns to Start + End Frames or explicitly removes End. Switching back restores
End directly to its slot without changing graph state.

### A19. Model change does not infer a frame method

Given two attached Image inputs and a selected method, when the user changes to
a model that lacks that method, then the fallback is determined by reviewed
catalog order, not by the two images. The notice names the old and new methods;
both bindings remain unchanged until the user resolves them.

## 19. Implementation sequence

### Phase 1 — state and capability split

- separate exact capability resolution from input readiness;
- model Start Frame and Start + End Frames as distinct model-scoped methods;
- add pure input evaluation and Draft reconciliation results;
- extract a testable Composer presentation model;
- update catalog and model-layer tests.

Exit: a valid incomplete method can persist and every automatic setting repair
is represented as data.

### Phase 2 — model and connection loop

- finish model-row capability summaries, state taxonomy, search, and focus;
- implement stored-credential Test connection and Needs attention state;
- harden one-shot return behavior and cancellation;
- add host service and smoke coverage.

Exit: locked-model selection returns to the exact Draft without a paid call.

### Phase 3 — settings and inputs

- render the split capability/readiness model;
- show full adjustment notices and disabled reasons;
- add Composer input chips and canvas-pick transaction;
- add named Start/End slots, missing-frame blockers, and explicit Swap;
- add Needs review and explicit role-conversion transactions;
- preserve bindings on model/method changes;
- complete keyboard, narrow-window, and high-contrast behavior.

Exit: a Draft can be configured in any sensible order without silent mutation.

### Phase 4 — paid execution and recovery

- connect paid-run authorization to exact preflight;
- complete fake-provider async generation smoke;
- verify cancellation, ambiguous submit, restart, exact Retry, download, and
  Result sealing;
- run gated live-provider checks.

Exit: one explicit Generate action produces either one inspectable terminal
Attempt or one sealed local Result with no duplicate paid submission.

### Phase 5 — release gate

- run scoped unit and Electron tests;
- run `npm run typecheck-client`;
- run compile-backed `npm run basehalf:smoke`;
- perform an in-session adversarial review against this specification;
- record any skipped live-provider check and block release when its adapter
  changed.

## 20. Explicit delete/keep boundary

Keep:

- the host Draft → Attempt → sealed Result lifecycle;
- the reviewed provider/model catalogs;
- encrypted machine-local credentials;
- catalog-driven normalization and immutable snapshots;
- one node-adjacent Composer and one child popover;
- the ordinary reference graph and target-owned input roles.

Delete or do not reintroduce:

- free-form model-service and model-id fields in the Video Composer;
- provider/model branches in UI rendering;
- mode selection disabled only because required inputs are not attached;
- silent parameter repair or automatic edge deletion;
- Quick Input as the main model-picker or connection-return surface;
- a second inspector, workflow Run, mutable Result selector, or multi-success
  history inside one node;
- test seams reachable from packaged product launch paths.
