# Video node Composer surface specification

Status: active implementation work package, version 4

Last updated: 2026-08-25

Implementation readiness: reviewed; no blocking product or engineering questions

Parent specification: [Video node development specification](video-node-development-spec.md)

Owning product contract: [AI Video domain contract](product-contract.md)

Sibling work packages:

- [Model selection and settings](video-node-model-settings-spec.md)
- [Model picker surface](video-node-model-picker-spec.md)
- [Inputs and frame roles](video-node-inputs-spec.md)
- [Execution, recovery, and Result sealing](video-node-execution-recovery-spec.md)

## 1. Authority and delivery boundary

This work package owns the desktop UI and interaction contract for the compact
surface beneath a selected Video node. It defines the Composer's screen-space
geometry, anatomy, appearance and dismissal, plus the generic anchoring and
stacking of its Models, Settings, Inputs, and Attempts popovers. The dedicated
model-picker specification owns the Models trigger, Models-popover dimensions,
internal layout, focus, and activation.

The parent specification remains authoritative for the shared Video-node
journey and lifecycle. The sibling packages own semantic model rows, settings
schemas, input transactions, and Attempt operations. This package consumes
their immutable presentation models and decides how those models are composed
and positioned. It must not duplicate their capability, graph, persistence, or
execution rules in DOM event handlers.

When requirements overlap, apply this order:

1. the domain contract owns host/plugin, graph, lifecycle, and Result boundaries;
2. the parent specification owns shared Video-node behavior;
3. the semantic sibling package owns the data and mutation for its control;
4. the model-picker package owns Models trigger and picker internals;
5. this package owns main Composer geometry plus generic child placement,
   stacking, and show/dismiss behavior.

The measurements in this document are product tokens and acceptance targets.
They are not canvas coordinates and do not scale with canvas zoom.

## 2. Required outcome

This package is complete when a developer can prove all of the following:

- selecting one editable Video Draft reveals one compact, stable Composer near
  the selected card, canonically centered beneath it;
- the Composer is 512 by 160 CSS pixels in its canonical desktop state and
  remains the same screen-space size while the canvas zooms;
- the input rail, prompt, model trigger, settings summary, optional trailing
  metadata, and primary action form one surface rather than stacked cards;
- Models and Settings are visually distinct, adjacent triggers and mutually
  exclusive anchored popovers;
- Models satisfies the dedicated 224-pixel picker contract and Settings is a
  compact 256-pixel schema surface that grows only upward or downward;
- a popover flips above or below according to available viewport space without
  resizing the Composer, moving the selected node, or panning the canvas;
- pointer, keyboard, IME, outside-click, selection, drag, and canvas-pick paths
  close exactly the intended interaction layer;
- node move, node resize, canvas pan/zoom, and window resize preserve the same
  Composer Draft and resolve a reachable anchor without fighting the gesture;
- opening or updating a popover never recreates the prompt DOM or loses its
  value, selection, composition, scroll position, or undo history;
- narrow windows, long labels, 200% text zoom, disabled options, asynchronous
  metadata, and reduced motion remain usable and testable;
- no visible control is shipped before its complete product operation exists.

## 3. Scope

### 3.1 In scope

- Draft/Attempt Composer visibility and disappearance;
- screen-space sizing and card-relative placement;
- node-move, node-resize, canvas-pan, canvas-zoom, viewport-resize, and
  off-screen-anchor behavior;
- main-surface anatomy, spacing, theme tokens, overflow, and responsive rules;
- settings trigger density, summaries, truncation, and states;
- Settings, Inputs, and Attempts popover chrome;
- generic placement and stacking for Models, Settings, Inputs, and Attempts;
- child-surface exclusivity, outside click, Escape, focus restoration, and IME;
- the visible canvas-pick layer initiated by an input slot;
- primary-action and trusted metadata placement in the footer;
- pure layout/presentation state, DOM/component tests, and Electron smoke.

### 3.2 Out of scope

- catalog admission, exact model identity, row-state calculation, settings
  normalization, and provider connection;
- input compatibility, role conversion, graph mutation, and undo semantics;
- paid authorization, Attempt creation, provider submission, polling,
  cancellation, Retry semantics, download, and Result sealing;
- changing the resting card, Result toolbar, canvas graph, or Card Detail;
- a permanent inspector, modal configuration dialog, or full-height drawer;
- numeric cost guessed from capability metadata;
- a variation-count control that does not create and own every resulting Draft,
  Attempt, node, and artifact end to end.

## 4. Surface state and ownership

The Composer is selected-node chrome owned by the host. Its transient state is
not part of the `.bhnode` document.

```ts
type VideoComposerChildSurface = 'models' | 'settings' | 'inputs' | 'attempts';
type VideoComposerPlacement = 'below' | 'above' | 'clamped-below' | 'clamped-above';
type VideoComposerDirectManipulation = 'node-move' | 'node-resize';

interface VideoComposerSurfaceState {
  sceneKey: string;
  nodePath: string;
  nodeId: string;
  mode: 'editable-draft' | 'frozen-attempt';
  child?: VideoComposerChildSurface;
  childPlacement?: 'above' | 'below';
  placement: VideoComposerPlacement;
  manipulating?: VideoComposerDirectManipulation;
  suspended?: 'anchor-offscreen';
  focusKey?: string;
  pickRequestId?: string;
}
```

Only `sceneKey`, immutable node identity, and the current selection authorize a
mounted surface. The child surface, focus key, hover, type-ahead, scroll position,
and placement are in-memory UI state. Prompt and configuration values remain in
the existing Composer Draft model and normal saved node document.

The surface does not own model capability truth, binding identity, or lifecycle
truth. It renders the sibling packages' semantic projections and dispatches
typed intents back to the host.

## 5. Visibility and lifecycle matrix

| Selected node state | Lower Composer | Prompt | Primary control |
| --- | --- | --- | --- |
| editable Video Draft | visible | stable editable textarea | blocker action or Generate |
| preparing/waiting/generating Video Attempt | visible | frozen Attempt prompt copy | progress or Cancel |
| cancelling Attempt | visible | frozen | disabled Cancelling |
| failed/cancelled/interrupted Attempt with exact Retry | visible | frozen snapshot | Retry |
| terminal Attempt without safe Retry | visible | frozen snapshot | New Draft/details action |
| verified sealed Video Result | hidden | none | Result toolbar above card |
| imported verified Video Result | hidden | none | Result toolbar above card |
| selected node during move/resize | visible, mounted, and inert while following the card | preserved in the same DOM | none during gesture |
| selected node fully outside the viewport | mounted but visually suspended | preserved in the same DOM | none until anchor returns |
| unselected or multi-selected node set | unmounted | none | none |
| non-Video node | governed by that node kind | n/a | n/a |

A single pointer click selects a Video node and mounts its Composer after the
selection gesture finishes. `Enter` on a focused Video card does the same and
focuses the prompt when editable. Mounting must not occur during pointer move,
box selection, node drag, or a pending double-click decision.

The Composer is dismissed after a successful Draft checkpoint when the user:

- selects another node or a multi-selection;
- clicks blank canvas;
- navigates to another scene, Card Detail, or workbench surface;
- explicitly closes the selected-node editing state.

If checkpointing fails, the selection and Composer remain, one actionable save
error is shown, and the original user action does not silently discard edits.
Opening and closing a child popover never checkpoints or dismisses the Composer.
Moving or resizing the selected node makes the surface temporarily inert while
keeping it visible and attached, without checkpointing, unmounting, or clearing
its Draft; section 6.2 owns that state.

## 6. Canonical geometry

All values are CSS pixels at 100% text zoom.

| Token | Value | Contract |
| --- | ---: | --- |
| Composer width | 512 px | fixed desktop target, not derived from card width |
| Composer height | 160 px | fixed compact target in the normal state |
| card-to-Composer gap | 10 px | canonical below/above placement; clamped state may reduce it |
| viewport safe margin | 12 px | minimum reachable margin for the main surface |
| outer radius | 14 px | one continuous surface |
| horizontal inset | 10 px | input/prompt/footer content alignment |
| input rail height | 34 px | thumbnails, slots, chips, Add input |
| footer height | 38 px | one non-wrapping control row |
| compact control height | 28 px | model, settings, metadata, and utility triggers |
| primary action | 32 px | circular button |
| popover gap | 6 px | trigger edge to popover edge |
| popover viewport margin | 8 px | final clamped child-surface margin |
| Models width / maximum height | 224 / 320 px | internal list scrolls |
| Settings width / maximum height | 256 / 360 px | natural height below the maximum |
| Inputs width / maximum height | 288 / 360 px | semantic input package content |
| Attempts width / maximum height | 320 / 420 px | history may need more vertical space |

The canonical Composer uses `box-sizing: border-box`. Border and shadow are
inside the acceptance measurement. The card may be any canvas-scaled size; the
Composer does not multiply by canvas zoom and does not inherit the card's
transform.

The Composer's horizontal center resolves from the selected card's live
screen-space bounding box, not saved canvas coordinates. Below is the canonical
placement. On first mount only, the host may pan the minimum distance required
to keep the pair below and visible, capped independently on each axis at the
smaller of 96 pixels or 25% of that canvas-viewport dimension. The pan must not
change zoom. If that cap cannot make the pair fit, do not pan.

After the optional first-mount pan, and after every user-authored geometry or
viewport change, resolve main-surface placement in this order:

1. center 10 pixels below the card when the Composer fits within the 12-pixel
   viewport margin;
2. otherwise center 10 pixels above the card when that position fits;
3. otherwise choose the side with more usable vertical area and clamp the
   Composer inside all viewport margins;
4. allow the card to be partially outside the viewport or temporarily covered;
   never resize the card or the canonical Composer to manufacture space.

The main Composer does not use left/right side placement. A clamped placement
may reduce the visual card gap or cover part of an exceptionally large card,
but every Composer control remains reachable. Explicit node move, node resize,
canvas pan, canvas zoom, and window resize never trigger a compensating canvas
pan.

Child popovers never trigger the first-mount pan. Nearby nodes may be covered;
the graph is not reflowed and no reserved canvas space is created.

### 6.1 Responsive exception

Below 536 CSS pixels of available canvas width, Composer width becomes
`available width - 24 px`. The footer remains one row. It preserves, in order:

1. primary action;
2. current blocker/status affordance;
3. model trigger;
4. settings trigger;
5. Attempts and optional trusted metadata.

Lower-priority labels truncate before a control disappears. Every truncated
control retains its complete accessible name and focus tooltip. There is no
horizontal page scroll.

At 200% text zoom or when the viewport cannot hold 160 pixels plus margins, the
surface may grow vertically only up to `viewport height - 24 px`; its middle
content scrolls while the footer remains reachable. This accessibility
exception does not change canonical desktop screenshot measurements.

### 6.2 Anchor reflow and direct manipulation

The Composer portal has four distinct states: visible, visible-but-inert during
direct manipulation, hidden-but-mounted while its anchor is off-screen, and
unmounted. Direct geometry manipulation keeps the spatial relationship visible
while preserving the stable prompt and in-memory Draft.

| Event | During the event | After settle |
| --- | --- | --- |
| move selected node | close child popover; keep Composer visible, mounted, and inert; translate it with the card while locking the current side/gap | remeasure committed card bounds, resolve below/above/clamped placement, and restore interaction on the next animation frame |
| resize selected node | same as move; card resize handles retain pointer capture; Composer stays 512 by 160 and follows the changing card center/edge | resolve from the final card bounds and restore interaction |
| cancel move/resize | keep following until pointer cancellation is acknowledged | restore prior card geometry and Composer placement; restore interaction; do not reopen a child popover |
| keyboard nudge/resize repeat | close child on the first geometry key; keep Composer visible/inert and follow each committed card rect | settle 100 ms after the last repeat, resolve placement, and retain card focus |
| canvas pan or kinetic scroll | close child popover; keep the main Composer visible and translate it with the live card on animation frames | settle at the latest anchor without changing canvas transform |
| canvas zoom or pinch | close child popover; keep Composer dimensions fixed while the card scales; translate from the live card rect | restore the canonical 10-pixel gap on the resolved side |
| window/canvas resize | close a child only when it no longer fits; keep main Composer mounted | apply responsive width and rerun placement without moving the canvas |
| geometry undo/redo, snap, or programmatic layout | close child before the anchor changes; keep the same Composer and update position only | resolve from the final committed rect; do not touch the Video Draft |
| lifecycle-only card resize | keep prompt and Draft; child may stay when its trigger remains stable | remeasure and re-anchor without animation or save |

Direct-manipulation state uses `pointer-events: none`, `inert`, and an
inaccessible subtree state while leaving the Composer visually present at full
surface opacity. Off-screen suspension additionally uses `visibility: hidden`.
Neither state may use `display: none`, detach the textarea, recreate the surface,
blur a still-active IME composition before it commits, or save merely because
geometry changed. Node geometry remains owned by the canvas and its normal undo
unit; Composer re-anchoring creates no undo entry.

Node move/resize begins only from the card's canvas-owned drag or resize target.
Pointer activity inside the prompt, input rail, footer, or a child popover never
initiates node movement. Crossing the old Composer rectangle during a captured
card gesture cannot activate an inert control.

During a move/resize gesture, keep the placement side selected at pointer down
and update only translation from the live card bounds. This prevents the
Composer from flipping above/below under the pointer. Temporary viewport
clipping is allowed during the gesture. Canvas-owned edge auto-pan may continue,
but the Composer neither starts nor accelerates it. At pointer up, pointer
cancel, or lost capture, wait for the scene to commit its final card transform,
read the card rectangle on the next animation frame, and then resolve the final placement.
Focus returns to the selected card, not the prompt or a closed child. A child
popover never reopens automatically after geometry work.

During canvas pan/zoom, position-only updates must not rerender semantic
Composer content. Use the scene-owned overlay transform or equivalent
position-only path so textarea identity, selection, scroll, native undo, and
IME state remain unchanged.

If the selected card has no viewport intersection of at least 24 by 24 pixels,
suspend the Composer as `anchor-offscreen`. Do not leave a floating editor with
no visible owner and do not pan the canvas back. If the same selected card
re-enters the viewport, remeasure and reveal the same mounted Composer. If
selection or immutable node identity changes while suspended, unmount it and
apply the ordinary checkpoint/exit contract.

## 7. Main-surface anatomy

The Composer has no visible title bar, section cards, or close button. From top
to bottom it contains three aligned regions.

### 7.1 Input rail

The first row is a 34-pixel horizontal rail. It appears when the selected
method declares media roles or when a retained binding needs review. It is
omitted for a clean text-only method so the prompt receives the space.

- Temporal slots use 32-pixel square thumbnails/placeholders.
- Start and End carry a small visible role tag; their accessible names include
  the role, source title, state, and action.
- Start + End places one directional connector between slots. Swap is a
  separate control and appears only when both roles are filled.
- Empty slots use a plus affordance and role label; they do not render as large
  form fields.
- Ordinary references render as one-line thumbnail chips in binding order.
- The rail scrolls horizontally when needed and never adds a second row.
- Add input is the final 28-pixel utility button when the method has remaining
  capacity.
- Remove, Replace, preview, and Swap remain distinct actions even when their
  icons share a thumbnail overlay.

Changing method may replace the active slot projection, but unresolved bindings
remain reachable in the Inputs popover. The surface must never silently relabel
an existing Start, End, or reference binding to imitate a newly selected mode.

### 7.2 Prompt region

The prompt is one stable multiline textarea in an editable Draft and one stable
text copy in a frozen Attempt. It has no visible field label, border, or nested
card; a visually hidden label supplies its accessible name.

- Editable placeholder: **Describe the video you want to generate. Use @ to
  reference canvas material.**
- The textarea fills the space between the rail and footer, uses 13-pixel body
  text and approximately 1.5 line height, and does not show a resize handle.
- With an input rail, two prompt lines remain visible; without it, three lines
  remain visible.
- Prompt scrolling stays inside the textarea.
- Opening, switching, updating, or closing a child surface must not replace the
  textarea element.
- During IME composition, model/settings refresh, save, and primary shortcuts
  are deferred until `compositionend`.

### 7.3 Footer

The footer is one 38-pixel row with two flex zones:

- left/flexible: model trigger followed by settings trigger;
- right/fixed: Attempts when present, trustworthy billing metadata when
  available, and the primary action.

There is no separator line above the footer. Controls are transparent at rest
and gain a low-contrast rounded hover/focus surface. The model and settings
triggers read as one compact sentence rather than toolbar buttons in separate
boxes.

The current release does not show a variation-count trigger because one Video
node seals one artifact. A future count may appear only after one explicit
operation creates and owns every sibling Draft/Attempt/Result transaction and
defines partial failure, cancellation, authorization, and undo.

Numeric cost or credits appear only from the reviewed pricing contract defined
by the parent specification. While that evidence is recomputed after a model or
setting change, show an em dash in the same reserved width rather than stale
pricing or layout shift. Pricing completion never controls readiness.

The primary action is a 32-pixel circular icon button. Enabled Generate uses the
strong foreground/background pair; disabled Generate uses the same geometry at
reduced contrast. Its complete action and blocker are always present in
`aria-label`, `title`, and the Composer status region.

## 8. Model trigger and Models popover

The [Model picker surface specification](video-node-model-picker-spec.md) is
authoritative for this entire surface. The summary below preserves the
Composer integration boundary and does not replace its exact width-budget,
overflow, state, focus, and activation requirements.

### 8.1 Trigger

The model trigger is the footer's leading control:

- 28 pixels high, maximum width 152 pixels, and minimum content width 72 pixels;
- leading 14-pixel model-family mark, one-line model label, no chevron;
- **Choose model** when no exact model is selected;
- ellipsis for overflow with the complete label in its accessible name;
- low-contrast pill on hover, focus, or `aria-expanded="true"`;
- warning/lock state conveyed by icon plus accessible text, never color alone.

The model label is display data only. It never becomes persisted execution
identity.

### 8.2 Models popover chrome

The Models popover is 224 pixels wide and at most 320 pixels high. It has no
redundant visible title, search field, or footer buttons. Scope headings appear
only when more than one scope must be disambiguated. The list scrolls internally
and supports prefix type-ahead without changing its visible rows.

Each normal row is 48 pixels high and contains:

1. an 18-pixel model/provider mark;
2. a one-line model label;
3. a compact second line of executable capability tokens;
4. optional concise badge, lock, or unavailable icon;
5. one trailing affordance: check for an available selected row, lock for a
   connection-required row, or unavailable icon for a disabled row.

Capability tokens are quiet metadata pills and may show resolution, duration,
method family, or native-audio support. They come only from the semantic model
projection. Long secondary reasons wrap inside an exceptional
Connection-required or Unavailable row; that row may grow, but ordinary rows
remain 48 pixels.

Every selected row receives a full-row low-contrast fill; an available selected
row also receives the check. Hover uses a different fill.
Connection-required rows remain actionable. Disabled rows retain a
visible reason and cannot be activated.

Opening Models scrolls the selected row fully into view. Arrow navigation may
scroll the list but never the canvas. Selecting an available row updates the
Draft immediately, closes Models, returns focus to the model trigger, and
updates the Settings summary. Connection-required rows open their exact Connect
or Reconnect flow. An unavailable current selection asks the user to choose
another row; it does not expose a generic corrective action.

## 9. Settings trigger and Settings popover

### 9.1 Trigger

The Settings trigger follows Models, takes the remaining footer width, and is
28 pixels high. It displays canonical summary tokens in this order:

1. generation method;
2. aspect ratio when declared;
3. resolution when declared;
4. duration when declared;
5. audio state when the semantic package says it is material.

Tokens use their display labels and are separated by a middle dot. The summary
is one line and truncates at the trailing edge. A warning icon may precede it
without replacing the summary. When no exact settings schema exists, show
**Choose model settings** and route the primary blocker to Models.

### 9.2 Settings popover chrome

Settings is 256 pixels wide, uses natural content height, and is capped at 360
pixels before its content scrolls. It has no visible title bar, close button,
Apply, Cancel, or sticky footer. The exact model is supplied in the popover's
accessible name and remains visible in the adjacent model trigger. A
connection/capability problem may add visible status copy at the top because it
is actionable; a healthy connection consumes no row.

Content uses this visual structure:

- 10- or 11-pixel muted group labels;
- 6-pixel label-to-control gap and 10-pixel group-to-group gap;
- 29-pixel full-width fixed or segmented control rows;
- equal-width segments when their labels fit, otherwise a listbox;
- 8-pixel control radius and a low-contrast selected segment;
- inline disabled reason below the affected group when required;
- adjustment and availability-message sections after controls;
- one collapsed **Model details** disclosure for the reviewed source and date.

The semantic Settings section order remains method, declared parameters,
adjustments, current availability message, then Model details. A method or parameter with one
legal value renders as a full-width fixed row. It looks selected but is not
focusable as a fake choice.

Generation methods are model-owned capabilities. Start + End Frames appears
only for an exact model that declares it; it is not a global Composer option.
When a catalog-declared method is visible but unavailable, the control is
disabled and exposes its reason. Switching models rebuilds the method and
parameter sections instead of carrying the previous model's controls forward.

Selecting an enabled option commits to Composer memory immediately and keeps
Settings open. The summary and conditional controls update in the same render
transaction. Trusted pricing may show its reserved loading placeholder until
an asynchronous result arrives. Clicking a disabled option does nothing, keeps
Settings open, and makes its reason available without a toast.

Method changes never mutate input roles. Active slot projection and Needs
review state update from the input package after the method transaction.

## 10. Popover placement and stacking

Every Composer child popover uses the same screen-space placement algorithm:

1. measure the live trigger, Composer, and canvas viewport after layout;
2. prefer above the footer for a Composer below its card;
3. prefer below the footer when the Composer itself is near the top edge;
4. calculate desired natural height capped by the surface maximum;
5. if the preferred side cannot provide `min(desired height, 160 px)` and the
   other side has more room, flip to the other side;
6. clamp the chosen surface to the 8-pixel viewport margin;
7. cap available height and scroll the surface's content, not the page/canvas.

Models and Settings align their leading edge with the trigger when possible.
Inputs use the Composer's leading inset. Attempts aligns its trailing edge with
the primary-control group. Horizontal clamping may change that alignment but
never the width unless the canvas is narrower than the width plus 16 pixels.

Popovers render in a Composer-owned overlay root and do not participate in its
height. They may cover the selected card or nearby nodes. They have no backdrop
and do not dim or disable the canvas. Their z-index is above cards and the
Composer, but below workbench dialogs, Quick Input, notifications, and menus.

Exactly one child popover exists at a time. Opening a second trigger replaces
the first popover in one state transition; it does not briefly render both.

## 11. Pointer, dismissal, and focus contract

| Action | Required result |
| --- | --- |
| click selected Video card | keep Composer; close child popover |
| click prompt/input/footer non-trigger content | keep Composer; close child popover |
| click the open trigger | close only that popover; restore trigger focus when keyboard-initiated |
| click another Composer trigger | replace current child with requested child |
| click inside child popover | keep child and Composer unless the chosen action explicitly navigates |
| click blank canvas | close child, checkpoint valid Draft, dismiss selection/Composer |
| select another node | close child, checkpoint, move Composer after selection settles |
| begin moving/resizing selected node | close child; keep Composer visible, inert, fixed-size, and following the card; preserve Draft/prompt DOM |
| commit or cancel node move/resize | resolve final placement and restore the same Composer; never reopen the child or steal prompt focus |
| begin canvas pan/zoom | close child; keep main Composer fixed-size and follow the visible anchor |
| selected card leaves/re-enters viewport | suspend without floating; reveal the same Composer when the exact anchor returns |
| first Escape with child open | close child only; stop propagation; focus trigger |
| Escape with canvas pick active | cancel pick only; stop propagation; focus originating slot |
| Escape with Composer and no child | focus selected card; do not discard edits |

Escape and pointer-outside handlers must be owned by one routing layer. An
inner dismissal cannot fall through and also dismiss the Composer or canvas
selection in the same event.

Model rows, segmented settings, Inputs actions, and Attempts use ordinary
document tab order. Popovers are non-modal and have no focus trap. On open,
focus goes to the selected model row, selected/current setting, first Inputs
problem/action, or current Attempt respectively. On schema refresh, focus is
restored by stable logical key rather than DOM identity.

Wheel/trackpad scrolling that begins in a scrollable prompt, input rail, model
list, Settings body, or Attempts body stays in that surface. Its
`overscroll-behavior` contains the terminal delta so reaching the first/last row
does not pan or zoom the canvas. A canvas pan/zoom gesture begins only outside
editable Composer controls; no pointer gesture originating in the Composer may
move or resize the node.

## 12. Canvas-pick presentation

Starting canvas pick from an empty slot or Inputs closes the child popover but
keeps the Composer and target selected.

- A fixed top-center banner names the requested role and includes **Cancel**.
- The banner is at most 360 pixels wide, at least 32 pixels high, and stays in
  screen space while the canvas pans.
- Ineligible canvas content receives a uniform dim layer; eligible saved nodes
  retain normal opacity, a focus outline, and a compact **Select** label.
- The target Video card and Composer remain legible and are not candidates.
- A local **Esc to cancel** hint may appear near the target but is never the
  only cancellation affordance.
- Target and candidate node move/resize gestures are disabled while pick is
  active; a candidate click means Select, not drag. Canvas pan and zoom remain
  available so the user can reach other saved sources, while the fixed banner
  and role request remain stable.
- Pan/zoom recomputes candidate hit regions and Composer anchoring without
  restarting the pick request. If the target goes off-screen, the Composer may
  suspend under section 6.2 while the banner remains available.
- Success creates the typed input transaction defined by the input package,
  removes the dim layer/banner exactly once, and restores focus to the filled
  slot or chip.
- Cancel removes only pick UI and restores the originating slot. It does not
  change method, settings, bindings, graph, viewport, or prompt.

The picker overlay is the only Composer operation that dims canvas content.
Opening Models, Settings, Inputs, or Attempts never dims the canvas.

## 13. Appearance and motion

The Composer and child popovers use workbench theme tokens. Hard-coded dark
surfaces or provider colors are forbidden.

- Surface background: card/menu surface token.
- Border: one-pixel strong card/widget border.
- Main shadow: restrained 10-to-30-pixel soft shadow plus optional one-pixel
  inner highlight.
- Popover shadow: slightly stronger than the Composer so stacking is clear.
- Resting controls: transparent background and description foreground.
- Selected/hover controls: toolbar/menu selection tokens.
- Warning/error: editor warning/error tokens plus icon/text, never color alone.
- Focus: visible workbench focus border with at least one-pixel separation.

On first mount, the Composer may fade and translate upward by 4 pixels over 120
milliseconds after any compensating pan completes. Popovers fade/translate by
4 pixels from their anchor over 120 milliseconds. Switching child popovers does
not animate the main Composer. Dismissal completes within 100 milliseconds.

With reduced motion, translation is removed and opacity changes are immediate.
No animation delays focus, selection, saving, or pointer hit testing.

## 14. Failure and asynchronous update behavior

- A failed model/settings projection leaves the last canonical summary visible,
  adds one warning state, and offers only a concrete action the user can
  complete: retry loading, connect again, adjust an enabled setting, or choose
  another model. It does not render an empty popover or reset the Draft.
- A catalog refresh preserves the open popover and focused logical row when the
  node and choice still exist. A vanished choice remains selected but
  unavailable through the model package until the user chooses another model.
- A settings schema refresh preserves popover placement and the Composer bounds.
- Price/usage evidence clears to the reserved em dash before asynchronous
  recomputation. Late results are request-keyed and cannot overwrite a newer
  model/settings choice.
- A Draft save conflict or failure prevents Composer dismissal and exposes the
  existing retry/discard/keep-open flow.
- Pointer cancel, lost pointer capture, window blur, or an interrupted resize
  must end direct-manipulation state exactly once. The host remeasures the
  committed card instead of leaving a visible but permanently inert Composer.
- A transient zero-size or disconnected anchor postpones reveal for at most two
  animation frames. If the exact card still has no measurable rectangle, treat
  it as off-screen/removed and keep the Composer suspended or unmount it
  according to current selection identity.
- Geometry updates are request/epoch-scoped. A late measurement from an earlier
  move, resize, pan, zoom, or scene render cannot reposition the current
  Composer.
- Move, resize, pan, zoom, and responsive reflow never recompute model
  selection, settings, input readiness, pricing, or the primary action.
- If the anchor card is removed, replaced, or no longer the exact node, the
  Composer closes and ignores all late child-surface results.

## 15. Accessibility contract

- The Composer is a named non-modal region associated with the selected Video
  card; child popovers are named non-modal dialogs owned by their triggers.
- Trigger `aria-expanded` and `aria-controls` match the one active child.
- Models uses listbox/radio semantics from the model package; Settings uses
  fixed text, radio groups, listboxes, sliders, and switches as appropriate.
- Icon-only input, utility, Attempts, Cancel, and primary controls have complete
  accessible names and visible focus.
- A manipulating or suspended Composer is inert and absent from the
  accessibility tree. Ending manipulation or revealing after re-entry restores
  the prior semantic region without moving focus away from the card.
- Pure anchor movement is not announced as status. Only a meaningful blocker,
  lifecycle, or transaction change reaches the live region.
- Status changes share the parent Composer's polite live region. Terminal
  transaction errors alone may use an alert.
- Disabled reasons are available in visible copy and accessibility description;
  hover-only explanations are forbidden.
- At 200% text zoom and 320 CSS-pixel canvas width, every control remains
  reachable without horizontal page scrolling.

## 16. Implementation boundary and parallel ownership

This work package owns the integration files that compose the sibling packages:

- `src/vs/workbench/basehalf/common/basehalfVideoComposerPresentation.ts`
  (new DOM-free surface projection and control-priority helpers);
- `src/vs/workbench/basehalf/test/common/basehalfVideoComposerPresentation.test.ts`
  (new pure presentation tests);
- `src/vs/workbench/basehalf/browser/basehalfNodeLocalSurface.ts` and its browser
  test, only for reusable Composer/popover placement contracts;
- `src/vs/workbench/basehalf/browser/basehalfCanvasReactScene.ts`, only for the
  scene-owned Composer portal and layout event;
- `src/vs/workbench/basehalf/browser/basehalfCanvasWorkbench.contribution.ts`,
  only for Composer integration, event routing, and sibling presentation intents;
- `src/vs/workbench/basehalf/browser/media/basehalfCanvasWorkbench.css`, only for
  Composer, child popover, and canvas-pick selectors;
- `scripts/basehalf-smoke.mts`, only for the cross-package Composer smoke.

Within those shared integration files, Models trigger, row, type-ahead, overflow,
focus, and activation changes are governed by the dedicated model-picker
surface specification. This package must not add an alternate Models layout.

Sibling lanes own their common semantic modules and tests. During parallel
implementation they must not edit the integration files above. They expose the
smallest immutable projection or typed intent required by this package. If a
shared interface is missing, update the owning specification before either lane
duplicates state or parsing in the workbench contribution.

The Composer integration must remove superseded renderer-specific branches and
CSS in the same change. It must not leave a hidden second footer, legacy 520/172
geometry, card-width ratio sizing, or alternate popover widths as fallback UI.

## 17. Acceptance matrix

| Scenario | Required proof |
| --- | --- |
| C1 canonical Draft Composer is 512 by 160 and centered 10 below the card | DOM geometry test plus Electron screenshot/measurement |
| C2 canvas zoom changes card geometry but not Composer CSS-pixel bounds | placement unit test plus Electron smoke at two zoom values |
| C3 first mount pans only within the defined cap, never changes zoom, and otherwise falls back to above/clamped | placement unit test and smoke near every viewport edge |
| C4 narrow viewport keeps all controls reachable in one footer row | DOM test at 320 CSS pixels and 200% text zoom |
| C5 Models is 224 by at most 320 with selected row scrolled into view | component geometry/scroll test |
| C6 Settings is 256 wide, natural height, no Apply/Cancel/title bar | component DOM/geometry test for short and long schemas |
| C7 top-edge Composer opens Models/Settings below and normal Composer opens them above | placement unit test plus smoke screenshots |
| C8 opening/switching popovers does not move card/canvas/Composer or recreate prompt | DOM identity and bounding-rect assertions |
| C9 same trigger toggles, another switches, outside content closes one layer | pointer-routing component tests |
| C10 Escape closes exactly pick, child, then Composer focus layer | keyboard propagation tests plus Electron smoke |
| C11 model choice updates summary and closes Models; setting choice updates summary and keeps Settings open | cross-package component test |
| C12 disabled setting has reason and produces no mutation | settings integration DOM test |
| C13 method change never silently relabels an existing input role | cross-package presentation/mutation assertion |
| C14 canvas pick keeps Composer, dims only ineligible content, and cancels without mutation | DOM test plus Electron smoke |
| C15 asynchronous metadata uses a stable placeholder and rejects stale completion | request-keyed integration test |
| C16 Result selection shows Result toolbar and no lower Composer | lifecycle/selection integration smoke |
| C17 node move keeps the Composer visible, inert, fixed-size, and attached without unmounting its prompt | DOM identity and live-geometry test across pointer down, move, up, and cancel |
| C18 node resize changes card bounds while Composer remains 512 by 160, follows live, and resolves from the final card | placement/component test at minimum, normal, and oversized card bounds |
| C19 move/resize with an open child closes the child and never reopens it automatically | pointer-routing test plus Electron smoke |
| C20 move/resize near a viewport edge resolves below, above, then clamped without canvas pan | pure placement cases plus screenshot smoke |
| C21 pan and zoom preserve prompt DOM, fixed Composer dimensions, and a 10-pixel resolved-side gap | animation-frame placement test plus smoke at two zooms |
| C22 fully off-screen anchor suspends the Composer and exact re-entry reveals the same DOM | intersection/identity component test |
| C23 lost pointer capture, pointer cancel, window blur, and zero-size anchor never leave hidden focusable UI | event-race component tests |
| C24 window/canvas resize applies responsive geometry without semantic recomputation | resize-observer test with projection call counters |
| C25 scrolling to a prompt/list boundary never leaks wheel delta into canvas pan/zoom | nested-scroll DOM test plus trackpad smoke |
| C26 canvas pick permits pan/zoom but disables node move/resize and preserves one request epoch | input-pick routing test plus Electron smoke |
| C27 keyboard nudge/repeat and geometry undo/redo keep card focus, prompt DOM, fixed size, and one final placement | keyboard/event-timing component test plus smoke |

## 18. Implementation sequence

### C1 — pure surface projection and layout

- add canonical tokens and a DOM-free presentation model;
- replace card-width-ratio sizing with fixed screen-space geometry;
- cover below/above/clamped placement, bounded first-mount pan, narrow viewport,
  and popover flip decisions with pure tests;
- add geometry epochs, anchor intersection, and visible/suspended/unmounted
  transitions.

Exit: C1-C4, C17-C18, C20-C24, and the placement half of C7 pass without
rendering semantic model or input data.

### C2 — Composer anatomy and appearance

- render the one-row input rail, stable prompt, and one-row footer;
- apply the canonical dimensions, visual tokens, truncation, loading reserve,
  focus, and reduced-motion rules;
- keep the mounted Composer visible/inert and following during move/resize, and
  follow the live anchor through pan/zoom without semantic rerender;
- remove superseded Composer/footer CSS and renderer branches.

Exit: C1, C4, C8, C15-C24 pass at component level.

### C3 — Models and Settings integration

- render adjacent triggers from immutable sibling projections;
- consume the model-picker package for exact Models width, row density,
  selection-close, and focus restoration;
- implement Settings width, control density, exclusive state, generic
  above/below placement, internal scrolling, and focus restoration;
- preserve prompt DOM and viewport through every choice and registry refresh.

Exit: C5-C12 pass without a real provider connection or paid request.

### C4 — Inputs, pick, Attempts, and smoke

- integrate compact temporal slots/chips and role-specific canvas pick;
- integrate frozen Attempt controls without changing lifecycle ownership;
- extend the disposable-workspace Electron smoke across edge placement, Escape,
  move/resize, pan/zoom, nested scrolling, pick navigation, method/input
  preservation, Result selection, and zero-paid-request assertions.

Exit: C13-C27 pass and every parent/sibling cross-package assertion has proof.

## 19. Verification commands

From `vscode-base/`, after compiling current sources:

```bash
npm run compile-client
npm run test-node -- --run src/vs/workbench/basehalf/test/common/basehalfVideoComposerPresentation.test.ts
npm run test-node -- --run src/vs/workbench/basehalf/test/browser/basehalfNodeLocalSurface.test.ts
npm run test-node -- --run src/vs/workbench/basehalf/test/common/basehalfVideoModelSettingsPresentation.test.ts
npm run test-node -- --run src/vs/workbench/basehalf/test/common/basehalfVideoInputs.test.ts
npm run typecheck-client
npm run basehalf:smoke
```

The smoke must use a disposable fixture workspace and process-only fake model
services. It must never initialize the repository root or `vscode-base/`, use a
real credential, request paid authorization, or create a provider task.

For the documentation gate, run from the repository root:

```bash
git diff --check
cmp -s AGENTS.md CLAUDE.md
```

Also resolve every new relative Markdown link and scan changed files for
restricted product names before handoff.

## 20. Explicit delete/keep boundary

Delete or replace:

- card-width-ratio Composer sizing and the 520/172 fallback geometry;
- competing footer layouts, visible Composer headers, and nested settings cards;
- model/settings popover widths that bypass the canonical 224/256 tokens;
- handlers that let Escape or outside click dismiss more than one layer;
- drag/resize handlers that hide, unmount, or recreate the Composer/prompt,
  leave it interactive during manipulation, or apply a stale anchor measurement;
- model/method branches that silently relabel inputs for presentation;
- placeholder variation or cost controls without their reviewed end-to-end
  operation/evidence.

Keep and integrate:

- the scene-owned Composer portal and live selected-card anchoring;
- canvas-owned node move/resize/pan/zoom and their normal geometry undo;
- the stable prompt Draft and save/conflict coordinator;
- model/settings and input pure presentation modules;
- the one host reference graph and target-owned binding transactions;
- Attempt lifecycle, Result sealing, and Result-toolbar contracts;
- workbench theme, focus, accessibility, credential, and disposable-smoke
  infrastructure.
