# Video node execution, recovery, and result sealing specification

Status: active implementation work package

Last updated: 2026-08-24

Implementation readiness: reviewed; no blocking product or engineering
questions

Parent specification: [Video node development specification](video-node-development-spec.md)

Composer UI specification: [Video node Composer surface specification](video-node-composer-surface-spec.md)

Owning domain contract: [AI Video domain contract](product-contract.md)

## 1. Authority and purpose

This work package defines the executable boundary from the final Generate
preflight through one terminal Attempt and, on success, one sealed local Video
Result. It is intentionally narrower than the parent specification so its host
and plugin changes can be developed and reviewed independently from model,
settings, input, and Composer rendering work.

The domain contract remains authoritative for the universal Draft → Attempt →
Result lifecycle and host/plugin ownership. The parent specification remains
authoritative for shared vocabulary, the end-to-end user journey, and
cross-package acceptance. The Composer-surface specification owns the lower
surface and Attempts-popover geometry, presentation, and event routing. This
document owns the detailed paid
authorization, remote-task correlation, recovery, error classification, and
artifact-sealing contracts within those boundaries.

If the documents conflict, use this order:

1. the domain contract for lifecycle and ownership;
2. the parent specification for shared Video-node behavior;
3. this document for execution-package implementation detail.

## 2. Outcome

This package is complete when one explicit Generate or exact Retry action can
produce only one of these outcomes:

- no Attempt and no provider request because preflight or authorization did not
  complete;
- one inspectable terminal Attempt with structured, sanitized recovery
  evidence; or
- one successful Attempt and exactly one verified, sealed local MP4 Result.

No crash, window closure, transport timeout, polling retry, cancellation race,
or Result-write conflict may cause an unapproved replacement task, a duplicate
paid submission, a guessed remote id, or a late Result.

## 3. Scope

### 3.1 In scope

- final non-mutating and save preflight before Attempt creation;
- one-use paid-run disclosure and authorization;
- immutable Attempt payload creation before executor invocation;
- local Attempt, execution lease, and remote-task correlation;
- new submission, restart recovery, and exact Retry as distinct execution
  intents;
- durable remote-id acknowledgement before polling;
- bounded idempotent reads, polling, cancellation, and download;
- structured failure classification, terminal-state mapping, and recovery
  policy;
- restart behavior with and without a durable remote id;
- provisional-file cleanup, host integrity verification, and atomic Result
  sealing;
- provider-executor, host-service, document-contract, fake-provider smoke, and
  opt-in live-provider verification.

### 3.2 Out of scope

- model-picker, connection-form, Settings, frame-slot, and input-chip UI;
- graph or input-binding mutation;
- capability parsing or settings normalization except consuming their final
  canonical preflight result;
- a new lifecycle database or extension-owned recovery store;
- provider-specific pricing estimation not already backed by a reviewed dated
  pricing contract;
- automatic downstream execution;
- multiple successful artifacts, in-place regeneration, or replacement of a
  sealed Result;
- background reconciliation of an ambiguous submission when the provider has
  no reviewed idempotency or lookup contract.

## 4. Execution records and sources of truth

| Concern | Source of truth | Persistence |
| --- | --- | --- |
| editable prompt, Recipe, settings, and bindings | saved Draft | `.bhnode` before the Attempt |
| exact billable request being authorized | canonical preflight fingerprint | memory-only one-use grant |
| frozen prompt, Recipe, model, and input revisions | Attempt payload | `.bhnode` |
| active single-writer ownership | host execution lease | host lease store |
| accepted remote-task identity | Attempt execution envelope | `.bhnode` `providerRequestId` |
| progress message and percentage | active executor evidence | transient host state |
| terminal status, usage, cost, and recovery evidence | Attempt execution envelope | `.bhnode` |
| accepted artifact identity and digest | Result seal | `.bhnode` plus ordinary local MP4 |

An Attempt has two parts with different mutation rules:

- its **frozen payload** is `prompt`, `recipe`, `model`, and ordered `inputs`.
  These values never change after the Attempt is first committed;
- its **host-owned execution envelope** is status, timestamps, remote id,
  bounded usage/cost evidence, and structured failure evidence. These fields
  move only through the monotonic transitions in this specification.

Calling the Attempt immutable refers to the frozen payload. It does not mean
that a running Attempt cannot durably acknowledge its remote id or become a
terminal Attempt.

## 5. Global invariants

1. The host, not the plugin, owns Attempt ids, lifecycle transitions, paid-run
   authorization, execution leases, and Result seals.
2. The plugin receives one already frozen, host-validated request. It never
   reads the mutable Draft again.
3. Every provider task belongs to exactly one local Attempt. The local Attempt
   id is the host correlation key even when the provider has no idempotency-key
   facility.
4. A new paid provider create request is invoked only after its Attempt is
   durably committed and its matching one-use authorization grant is consumed.
5. A create request is never transport-retried. Only reviewed idempotent task
   reads and file lookup may retry automatically.
6. Polling begins only after the remote id is durably stored on the same
   Attempt. A repeated acknowledgement of the same id is idempotent.
7. Restart recovery never creates a replacement task. Exact Retry may create at
   most one replacement, and only after an explicit user action, applicable
   paid authorization, and a read that proves the inherited task failed or was
   cancelled.
8. Local cancellation is authoritative for the node. Remote cancellation is
   bounded best effort and cannot reopen a cancelled Attempt.
9. A terminal Attempt never returns to running. A Result is sealed only in the
   same atomic document commit that marks its Attempt succeeded.
10. A failed, cancelled, or interrupted Attempt accepts no artifact. Every
    provisional artifact from that run is removed or reported as retained
    ordinary project data when safe removal cannot be proven.
11. Secrets, credential-bearing endpoints, raw provider bodies, and untrusted
    remote markup never enter progress, errors, Attempt records, logs, or Result
    metadata.

## 6. Canonical preflight and paid authorization

### 6.1 Preflight plan

Generate first builds one immutable preflight plan without creating an Attempt
or invoking an executor. It verifies, in the parent specification's order:

- the exact editable node identity and absence of an overlapping working-copy
  conflict;
- the admitted Recipe, catalog owner, exact reviewed model revision, executable
  method, and matching verified connection;
- settings normalization equality with the Composer's canonical values;
- prompt and input readiness;
- every input's saved direct source, stable identity, kind, integrity, revision,
  and provider bounds;
- output-path and execution-lease eligibility.

The plan contains only host-owned frozen values and stable identities. It does
not contain a credential or endpoint. A changed node, model catalog,
connection identity, input revision, or settings value invalidates the plan.
The host must rerun preflight rather than patch it.

Preflight failure creates no Attempt, provider request, run directory, or
authorization record. The UI receives one actionable blocker owned by the
surface that can resolve it.

### 6.2 Request fingerprint

Paid authorization is bound to a deterministic fingerprint over:

- node id and canonical node path;
- Recipe and catalog id;
- provider, deployment, region, exact model id, and revision;
- generation method and canonical scalar settings;
- SHA-256 of the frozen prompt;
- ordered input role, source identity, and revision tuples;
- the operation kind: `generate` or `exact-retry`;
- for exact Retry, the source Attempt id and inherited remote id when present.

The fingerprint is provider-neutral, versioned, and computed by a pure host
function. It is not stored as a substitute for the frozen Attempt snapshot.

### 6.3 Disclosure and one-use grant

When provider billing may apply, the host disclosure names provider, model,
method, material settings, and whether a trustworthy estimate exists. Without
reviewed pricing evidence, it states that the provider determines the exact
charge. Confirming creates a random, memory-only grant bound to the exact
fingerprint and one Attempt id.

The grant:

- is consumed immediately before the provider create call;
- cannot authorize a different fingerprint, Attempt, node, or operation;
- is invalidated by cancellation, Draft change, failed save, preflight drift,
  execution-lease loss, or process exit;
- is never written to `.bhnode`, settings, logs, or extension state;
- authorizes at most one create call, not polling, another Retry, or downstream
  work.

Double-click, keyboard repeat, and two-window races are serialized by the node's
host execution lease. Losing the race consumes no grant and creates no Attempt.

The host exposes one two-phase boundary:

```ts
prepareProviderRun(node): Promise<{
  readonly document: IBaseHalfNodeDocument;
  readonly requestFingerprint: string;
  readonly authorizationKind: 'new' | 'replacement';
}>;

run(node, {
  providerAuthorization: {
    kind: 'new' | 'replacement';
    requestFingerprint: string;
  }
}): Promise<IBaseHalfNodeDocument>;
```

`prepareProviderRun` performs the complete read-only host preflight and returns
the exact parsed document that the confirmation surface must disclose. It
creates no Attempt, run directory, or provider request. The confirmation
surface returns the same authorization kind and fingerprint to `run`; it must
not independently reconstruct either value. `run` repeats preflight under the
execution lease and rejects a missing kind, different kind, or different
fingerprint before Attempt commit.

Authorization kind is not sufficient proof of scope by itself. Legacy
`newTaskAuthorized` and `replacementAuthorized` booleans may remain only as
fail-closed compatibility inputs while callers migrate; either boolean alone
must behave exactly like no provider authorization. The scoped authorization
applies only to the current invocation and must never be persisted or reused.
Replacement authority is never inferred from Retry, terminal-looking UI, or a
durable provider id.

The exact-Retry fingerprint is computed from the immutable operation kind,
source Attempt id, and inherited remote id. It deliberately excludes the
runtime `replacementAuthorized` boolean: setting that boolean after a matching
confirmation must not change the fingerprint it authorizes. The persisted
Attempt may record whether replacement was authorized, but that audit field is
not fingerprint input.

An exact Retry that might replace a provider-terminal task uses a new
disclosure. Its copy explains that BaseHalf will first inspect the existing
task and will use the authorization only if a replacement is proven safe. If
the existing task can be resumed or downloaded, the unused grant is invalidated
without a create call.

## 7. Attempt commit and executor handoff

After canonical Draft save and paid authorization, the host performs this
ordered transaction:

1. while holding execution ownership, resolve the exact model/connection
   identity, canonical settings, direct graph bindings, fresh input revisions,
   executor registration, output-path eligibility, execution intent, and
   provider request fingerprint without writing an Attempt or run directory;
2. recheck node identity, exact saved bytes, execution lease, and the disclosed
   preflight fingerprint;
3. append one running Attempt containing the complete frozen payload and
   execution fingerprint, then durably commit it with compare-and-swap
   semantics;
4. create and verify the run directory and immutable input snapshots;
5. recheck every copied input revision against the committed preflight plan;
6. durably attach the verified snapshot manifest and exact executor/catalog
   ownership to the same running Attempt with compare-and-swap semantics;
7. invoke the admitted executor with the frozen intent and short-lived
   credential access.

Every blocker discoverable in steps 1–2 creates zero Attempts. Steps 4–6 may
fail honestly on the already committed Attempt. Credential material remains
unavailable to preflight; failure to retrieve short-lived access after commit
is a structured `preparation` failure with locally proven non-acceptance. No
provider create call occurs until all post-commit checks succeed and the
executor consumes the exact authorization grant. No executor may be called
first and persisted later.

The request contract distinguishes three intents:

```ts
type BaseHalfProviderTaskIntent =
  | { readonly kind: 'new' }
  | {
      readonly kind: 'recover';
      readonly providerRequestId: string;
    }
  | {
      readonly kind: 'exact-retry';
      readonly sourceAttemptId: string;
      readonly providerRequestId?: string;
      readonly replacementAuthorized: boolean;
    };
```

- `new` may create one provider task after grant consumption.
- `recover` reads/polls/downloads only the existing task and never replaces it.
- `exact-retry` inspects the inherited task when one exists. It may create one
  replacement only after terminal proof and only when
  `replacementAuthorized` is true. Without an inherited id it may create a
  task only when structured source evidence proves the earlier submit was not
  accepted.

The raw executor entry point fails closed when neither an explicit intent nor a
legacy resume id is present. A legacy resume id normalizes only to `recover`.
Every `new` create and every authorized replacement must synchronously consume
the matching one-use host grant before any create transport begins; a missing
consumer is a preparation failure, never implicit authorization.

The existing ambiguous `resumeProviderRequestId` convenience must not remain
the sole signal because recovery and Retry have different billing authority.

## 8. Remote-task acknowledgement and correlation

`acknowledgeProviderRequestId(id)` is a host compare-and-swap boundary:

- the id is bounded, sanitized, and treated as opaque;
- undefined → `id` is allowed once on a running Attempt;
- `id` → the same `id` is an idempotent no-op;
- an inherited id may change once to a replacement id only for an authorized
  exact Retry after terminal proof;
- every other change fails closed;
- the callback resolves only after the `.bhnode` commit succeeds;
- polling, file lookup, download, and success return are forbidden before it
  resolves.

If the provider accepted a task but acknowledgement fails, the executor makes
the provider-specific bounded best-effort cancellation call when supported and
returns structured `remote-id-uncommitted` failure evidence. It must not poll,
guess that cancellation succeeded, or resubmit. The host stores the remote id
only if it can safely recover it in the same terminal compare-and-swap; without
a durable id, exact Retry remains blocked.

Provider request ids are not secrets, but they are still untrusted remote data:
they are length-bounded, control-character-free, never interpolated as an
unescaped path, and shown only in Attempt details.

## 9. Polling, progress, and finite waiting

- Polling uses the exact durably acknowledged id and reviewed provider route.
- Provider pending states map to transient `waiting` or `generating`
  presentation without adding new persisted node lifecycle states.
- Progress is shown only when supported by provider evidence; otherwise the UI
  remains indeterminate.
- Each request has a timeout, JSON/body cap, redirect policy, and cancellation
  hook.
- Only idempotent reads may use bounded automatic retry and backoff. A transient
  read failure never calls create or remote cancel.
- Polling has a reviewed finite attempt/deadline window. Exhaustion preserves
  the durable id and terminates locally as interrupted, so later recovery reads
  the same task.
- Unknown status, malformed success, missing output identity, unsafe URL, and
  response overflow fail closed. They never mean success and never authorize a
  replacement.
- Progress and error text pass through credential and control-character
  redaction before reaching host state.

Composer dismissal and Agent Area closure do not affect execution. Card and
Attempts presentation derive from the saved Attempt plus active host execution
state, not from the initiating UI component.

## 10. Cancellation and late completion

Cancellation has one linearization boundary with Result commit:

- before Result commit owns completion, Cancel records local intent, switches
  presentation to cancelling, aborts poll/download, and commits the Attempt as
  cancelled;
- after Result commit owns completion, Cancel returns false and the already
  verified success commit finishes;
- no asynchronous gap may exist between the final cancellation/lease checks and
  claiming Result-commit ownership.

After accepting cancellation, the host never seals a late provider success.
The executor may issue one bounded best-effort remote cancellation request only
where the reviewed adapter declares it. Unsupported, rejected, or too-late
remote cancellation does not change the local cancelled terminal state.

Any downloaded or written provisional file is rechecked after write and before
seal. A cancellation that won the boundary removes that file and all other
unsealed files in the verified artifact directory. For provider Attempts, the
verified frozen node/input manifest and run guard remain immutable so a later
safe recovery or exact Retry can use the frozen payload rather than mutable
Draft state. Cleanup never follows an unresolved path, symlink, or unverified
directory.

## 11. Restart recovery and exact Retry

### 11.1 Restart recovery

When a lease is abandoned, the host first acquires recovery ownership and
re-reads the exact node bytes.

- A running Attempt with a durable remote id and complete frozen payload resumes
  that same Attempt with `recover`. It does not append an Attempt, ask for paid
  authorization, or create a task.
- A running Attempt without a durable remote id becomes interrupted. The host
  never guesses or submits.
- A running Attempt whose frozen snapshots or executor/catalog ownership cannot
  be verified becomes interrupted with a sanitized reason.
- Recovery CAS conflicts or lease loss accept no Result. Another owner may
  recover only after acquiring the lease.

For restart recovery, a "complete frozen payload" includes a durable manifest
attached to the running Attempt before its executor can create a provider task:

```ts
interface IBaseHalfNodeAttemptSnapshotManifest {
  readonly version: 1;
  readonly nodePath: string;
  readonly frozenNodePath: string;
  readonly frozenNodeDigest: string;
  readonly executorExtensionId: string;
  readonly videoModelCatalogId: string;
  readonly inputs: readonly {
    readonly edgeId: string;
    readonly slot: string;
    readonly order: number;
    readonly revision: string;
    readonly sourceId: string;
    readonly sourcePath: string;
    readonly sourceKind: string;
    readonly snapshotPath: string;
    readonly snapshotDigest: string;
    readonly resultId: string;
    readonly resultKind: string;
    readonly sourceAttemptId?: string;
  }[];
}
```

Each tuple must exactly match the Attempt input at the same order. Every path is
portable, workspace-relative, and contained by
`outputs/<node-id>/<attempt-id>/inputs/`; every digest covers the complete file
or directory tree without following symlinks. `nodePath`, executor extension,
catalog id, source/result identities, edge id, and source Attempt id preserve
the exact execution request rather than allowing recovery to reconstruct it
from mutable graph or Draft state.

The manifest is an optional additive field in the existing version 3 document
schema. Existing version 3 Attempts remain readable. There is deliberately no
best-effort migration from legacy source paths or snapshot filenames: a running
legacy Attempt without a complete manifest is interrupted with structured
`execution-ownership` evidence and never creates a task. Newly created provider
Attempts must persist the manifest before executor handoff, so a durable remote
id implies that a recovery payload was already durable.

After taking a stale lease, recovery verifies the exact node path, Attempt id,
provider id, original request fingerprint, resolved model identity,
executor/catalog owner, frozen node digest, every tuple and snapshot digest,
run guard, real paths, and symlink-free containment. It then rebuilds the
executor request only from the Attempt and manifest, activates the exact recipe
owner, and hands off `{ kind: 'recover', providerRequestId }` for the same
Attempt id. Recovery does not read the current badge graph, direct source files,
or editable Draft settings; it has no create authorization callback. The
executor may only poll/read/download the durable task.

If any verification, activation, credential identity, CAS, or lease check
fails, the host interrupts the same Attempt with sanitized
`execution-ownership` evidence. It never guesses a path, appends an Attempt, or
submits a task. A verified remote terminal failure/cancellation maps directly
onto the same Attempt; verified success seals the same Attempt and Result.

If recovery reads a provider-terminal failure or cancellation, it maps that
terminal evidence to the existing Attempt. It never creates a replacement.

### 11.2 Exact Retry

Exact Retry appends a new Attempt only when the source Attempt has a complete
frozen payload and a non-blocked recovery policy. It copies that payload byte
for byte into the new Attempt run, revalidates current credential access and
the source manifest's frozen snapshot integrity, and never reopens editable
Draft settings.

Both authorization preflight and admitted execution derive input history and
executor inputs only from the source Attempt plus its verified manifest. They
must not read the current badge graph, source node declarations, imported
artifacts, or other mutable direct-input paths. After the new Attempt is
durably appended, the host copies each verified frozen node/input snapshot into
the new Attempt input directory, checks that the source digest stayed stable
during the copy, and attaches a new manifest with the same immutable identities
and byte-equivalent digests before executor handoff. Missing, changed, foreign,
or legacy payloads fail before a new Attempt or provider call is created.

With an inherited remote id, Retry first performs an idempotent read:

- pending/running: continue polling it;
- succeeded: download and verify its existing output;
- failed/cancelled: create at most one replacement only when the new one-use
  grant permits it;
- unknown/unreachable: preserve the id and interrupt without replacement.
  Provider status values such as `UNKNOWN` are not proof of remote failure or
  cancellation and therefore never authorize replacement.

Without an inherited id, Retry may create a task only when the persisted source
failure policy is `fresh-submit` and proves non-acceptance. Ambiguous or
uncommitted-id failures remain blocked from exact Retry. Copy Settings to New
Draft remains available, but its disclosure must not imply that the earlier
remote task was cancelled.

## 12. Structured failures and terminal mapping

The generic Attempt document adds optional host-owned structured failure
evidence while retaining `error` as sanitized user-facing copy:

```ts
type BaseHalfNodeAttemptRetryPolicy =
  | 'fresh-submit'
  | 'resume-existing'
  | 'replace-after-terminal-proof'
  | 'blocked';

interface IBaseHalfNodeAttemptFailure {
  readonly kind:
    | 'preparation'
    | 'submission-rejected'
    | 'submission-ambiguous'
    | 'remote-id-uncommitted'
    | 'poll-interrupted'
    | 'poll-window-exhausted'
    | 'remote-failed'
    | 'remote-cancelled'
    | 'protocol'
    | 'download'
    | 'artifact-invalid'
    | 'artifact-commit'
    | 'execution-ownership';
  readonly retry: BaseHalfNodeAttemptRetryPolicy;
}
```

The structure contains no raw provider payload or secret. Existing documents
without `failure` remain readable; they use conservative inference and never
gain `fresh-submit` merely because `providerRequestId` is absent.

| Evidence | Attempt terminal status | Required retry policy |
| --- | --- | --- |
| post-commit preparation failed before executor create | failed | `fresh-submit` when non-acceptance is locally proven, otherwise `blocked` |
| provider explicitly rejected create before acceptance | failed | `fresh-submit` |
| create transport ended with unknown acceptance | failed | `blocked` |
| accepted id could not be durably acknowledged | interrupted | `resume-existing` only if the id was later durably recovered; otherwise `blocked` |
| bounded polling/read transport ended with durable id | interrupted | `resume-existing` |
| polling window expired with durable id | interrupted | `resume-existing` |
| provider reports failed | failed | `replace-after-terminal-proof` |
| provider or user reports cancelled | cancelled | `replace-after-terminal-proof` |
| unknown/malformed provider status with durable id | interrupted | `resume-existing` |
| download or local artifact commit failed after remote success | interrupted | `resume-existing` |
| bytes fail MP4 or size verification | failed | `resume-existing` |
| execution lease or exact-content ownership is lost | interrupted | `resume-existing` when a durable id exists, otherwise `blocked` |

An error thrown before Attempt commit is a preflight error, not Attempt failure
evidence. The host may expose it in the Composer status region but does not
append it to history.

## 13. Download, integrity verification, and Result seal

The plugin transport boundary:

- downloads through credential-free HTTPS;
- strips authorization and provider credential headers on cross-origin
  redirects;
- caps the response at 256 MiB;
- rejects non-file, incomplete, oversized, or non-MP4 bytes;
- verifies an MP4 `ftyp` signature before returning an artifact;
- checks cancellation immediately before and after the write.

The host acceptance boundary then:

1. verifies the executor returned exactly one Video artifact in the owned run
   output directory;
2. rejects symlinks, path escape, unexpected extension, and unstable metadata;
3. computes SHA-256 and size, then rechecks both against unchanged file
   metadata;
4. rechecks execution lease, node bytes, cancellation, Attempt id, remote id,
   and Result absence;
5. claims the synchronous Result-commit boundary;
6. atomically changes the Attempt to succeeded and writes the Result containing
   artifact id, kind, portable path, digest, and size.

There is no interval in which the node is succeeded without its Result or has a
Result whose Attempt is not succeeded. A CAS conflict, integrity drift, lease
loss, or cancellation before step 5 prevents sealing and triggers bounded
provisional cleanup.

For a run directory created in the current process, the host records an
unforgeable in-memory ownership capability only after its guard and real paths
are verified. Every non-success terminal path performs bounded recursive
cleanup only while that capability and guard still match. If an executor can
outlive cancellation, the first cleanup removes provisional contents but keeps
the verified run guard and output directory as the ownership capability; full
directory cleanup runs again when that executor settles. The first cleanup must
not destroy the only capability needed to remove a non-cooperative late write.
If ownership, path containment, or symlink safety cannot be proven, the host
does not delete and the Attempt error states that unsealed run data was
retained. Abandoned directories discovered only after restart are never
deleted from a guessed path.

After sealing, playback and every Result operation verify the exact recorded
path and digest. Missing or changed output produces the existing integrity
failure state; the host never searches for or substitutes another MP4.

## 14. Presentation contract consumed by the integration package

This package exposes data; the Composer integration package renders it. The
minimum host presentation projection is:

- preparing before executor invocation;
- waiting/generating with bounded progress evidence;
- cancelling after accepted user intent and before terminal commit;
- terminal status, timestamps, exact frozen configuration, request id when
  durable, usage/cost when returned, sanitized error, and retry policy;
- Retry only when the frozen snapshot is complete and policy is not `blocked`;
- New Draft guidance for blocked ambiguity or incomplete legacy snapshots;
- playable Result controls only when fresh artifact integrity is available.

The primary action and `Cmd/Ctrl+Enter` never bypass disclosure. Attempts and
card status remain available without Agent Area and after the initiating
Composer is dismissed.

## 15. Implementation ownership and parallel boundary

### 15.1 Files owned by this work package

Host execution and document contract:

- `vscode-base/src/vs/workbench/basehalf/common/basehalfNodeDocument.ts`;
- `vscode-base/src/vs/workbench/basehalf/common/basehalfCanvasRecipes.ts`;
- `vscode-base/src/vs/workbench/basehalf/browser/basehalfNodeExecutionService.ts`;
- a new pure paid-authorization/fingerprint module under
  `vscode-base/src/vs/workbench/basehalf/common/` or `browser/`;
- matching common and browser tests, especially
  `basehalfNodeDocument.test.ts`, `basehalfCanvasRecipes.test.ts`, and
  `basehalfNodeExecutionService.test.ts`.

Plugin execution transport:

- `vscode-base/extensions/basehalf-ai-video/src/videoGeneration.ts`;
- `vscode-base/extensions/basehalf-ai-video/src/videoProviderExecution.ts`;
- `vscode-base/extensions/basehalf-ai-video/src/videoProviderAdapters.ts` only
  when request/result classification requires it;
- `vscode-base/extensions/basehalf-ai-video/src/extension.ts` only for the
  execution request/result bridge;
- matching `videoGeneration.test.ts` and `videoProviderExecution.test.ts`.

Smoke ownership:

- execution-specific fake-provider seams and execution assertions in
  `vscode-base/scripts/basehalf-smoke.mts`, coordinated with the integration
  owner defined by the Composer-surface specification because that file is shared.

### 15.2 Files this package must not touch independently

To preserve parallel development ownership, this package does not edit:

- `basehalfCanvasWorkbench.contribution.ts` or its CSS;
- `basehalfVideoModels.ts`, `basehalfVideoModelCatalogs.ts`, or their tests;
- model/provider catalog JSON;
- graph, binding, Start/End slot, and canvas-pick implementation;
- the parent specification, product contract, harness index, or sibling work
  package specifications.

Any required Composer button, Attempts popover, or card rendering change is a
small typed handoff to the integration owner after the pure execution and
document contracts land. Any shared smoke edit is serialized after the other
work packages finish their smoke changes.

## 16. Implementation sequence

### Phase E1 — durable contracts

- add structured failure evidence and conservative legacy parsing;
- replace ambiguous resume input with the three execution intents;
- add pure request fingerprint and one-use authorization-grant tests;
- preserve existing documents without weakening Retry safety.

Exit: host types can represent every new, recovery, Retry, and terminal case
without parsing error strings.

### Phase E2 — preflight and handoff

- split non-mutating preflight from Attempt commit;
- bind disclosure and grant to the exact fingerprint;
- ensure one Attempt is durable before executor invocation;
- ensure input drift after commit fails before provider create.

Exit: every failure before authorization/commit creates no Attempt, and every
executor call sees one durable frozen Attempt.

### Phase E3 — provider execution and recovery

- implement intent-specific create/resume/replacement behavior;
- map typed errors and durable acknowledgement;
- harden polling, cancellation, redirect, response, and download bounds;
- resume the same running Attempt on restart when a durable id exists.

Exit: crash, poll failure, and Retry cannot duplicate a paid task.

### Phase E4 — sealing and integration handoff

- enforce final cancellation/lease/integrity checks and atomic sealing;
- remove provisional files for all non-success terminals;
- expose typed Attempt presentation data to the integration owner;
- complete fake-provider smoke and gated live checks.

Exit: success produces one verified Result; every other path remains one
inspectable terminal Attempt with no accepted artifact.

## 17. Acceptance criteria and parent mapping

| ID | Observable acceptance | Parent mapping |
| --- | --- | --- |
| ER1 | Any failed model, connection, settings, graph, input-revision, executor, output-eligibility, fingerprint, or disclosure preflight creates no Attempt, run directory, or provider call. | sections 13.2 and 11.7 |
| ER2 | One disclosed and returned fingerprint authorizes at most one matching create call; Draft/input drift, repeated Generate, and two-window races do not duplicate or retarget it. | completion outcomes 6–7 |
| ER3 | A fake executor observes its complete frozen Attempt on disk before its first callback or network request. | section 13.2 |
| ER4 | Explicit pre-acceptance rejection leaves one failed Attempt and exact Retry may make one newly authorized create call. | A9 |
| ER5 | Ambiguous submission or uncommitted remote id leaves no Result and cannot blindly resubmit. Details show sanitized blocked recovery. | A10 |
| ER6 | The first poll occurs only after durable remote-id acknowledgement; repeated acknowledgement of the same id is harmless. | sections 14 and 13.3 |
| ER7 | Transient poll/read failure and polling-window exhaustion preserve the remote id and never create or cancel a replacement task. | sections 14 and 17.2 |
| ER8 | User cancellation wins before Result commit, remains cancelled after late provider success, and removes the provisional file. | A11 |
| ER9 | Restart with a durable id and a verified frozen-snapshot manifest resumes the same Attempt without create; without either prerequisite it marks the Attempt interrupted and never guesses. | A13 |
| ER10 | Exact Retry verifies and copies the source Attempt manifest without reading mutable inputs, reads the inherited task first, and replaces it only after failed/cancelled proof plus a new one-use authorization. | A13 and section 14 |
| ER11 | Unsafe URL, response overflow, non-MP4 data, unknown status, and malformed success all fail closed with no Result or leaked secret. | sections 14 and 17.2 |
| ER12 | Stable verified MP4 success atomically seals exactly one Result; changed/missing output never falls back to another file. | A12 |
| ER13 | Attempt details expose frozen identity, durable request id, bounded usage/cost, structured recovery, and sanitized error only. | section 13.3 |
| ER14 | Closing Composer or Agent Area does not stop progress, cancellation, terminal persistence, restart recovery, or local playback. | completion outcome 7 |

## 18. Required tests

### 18.1 Pure document and authorization tests

- frozen payload cannot change after Attempt commit;
- only legal monotonic status transitions parse and serialize;
- structured failure kind and retry policy agree with terminal status;
- legacy Attempt without failure evidence defaults to conservative Retry;
- same-id acknowledgement is idempotent and unauthorized replacement fails;
- request fingerprints change for every material model, method, setting,
  prompt, input, node, and operation difference;
- one-use grants reject wrong fingerprint, double consumption, invalidation,
  and process-local recreation.

### 18.2 Host service tests

- every parent preflight blocker occurs before Attempt and provider invocation;
- Attempt bytes exist before executor invocation;
- post-commit input drift fails before create;
- concurrent Generate owns one lease and creates one Attempt;
- cancellation/Result-commit linearization covers both race winners;
- restart recover, no-id interrupt, recovery lease conflict, and recovery CAS
  conflict;
- exact Retry succeeds from byte-equivalent Attempt-local snapshot copies after
  mutable source drift, while a changed manifest payload creates zero new
  Attempts and zero provider calls;
- exact Retry pending, success, failed, cancelled, unknown, and unreachable
  remote states;
- provisional cleanup, file-path containment, symlink rejection, stable digest,
  and atomic success/Result seal;
- errors and progress redact secrets and control characters.

### 18.3 Plugin tests

- no transport retry for create;
- durable acknowledgement precedes poll for all executable adapters;
- `recover` never replaces and exact Retry replaces at most once after proof;
- read retry bounds and polling-window termination;
- provider-specific pending/success/failure/cancelled/unknown mapping;
- best-effort remote cancellation boundaries;
- cross-origin header stripping, redirect limits, response caps, timeout, and
  cancellation;
- credential-free bounded MP4 download and signature verification;
- typed failure evidence contains no raw response or credential.

### 18.4 Smoke and release checks

The process-only fake-provider smoke covers disclosure, Attempt-before-submit,
durable id, progress, cancellation with late success, restart resume, verified
MP4 seal, and exact Retry without real credentials or billing. Test seams remain
unreachable from normal and packaged launchers.

An adapter-changing release also runs the parent specification's opt-in live
check under an explicit credential and spending cap. Skipping that check blocks
release when provider request, polling, cancellation, or download behavior
changed.

## 19. Verification commands

Documentation gate:

```bash
git diff --check
cmp -s AGENTS.md CLAUDE.md
test -f vscode-base/extensions/basehalf-ai-video/docs/video-node-development-spec.md
test -f vscode-base/extensions/basehalf-ai-video/docs/product-contract.md
```

Plugin typecheck and focused tests:

```bash
cd vscode-base
npx tsc -p extensions/basehalf-ai-video/tsconfig.json
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test \
  extensions/basehalf-ai-video/test/videoGeneration.test.ts \
  extensions/basehalf-ai-video/test/videoProviderExecution.test.ts
```

Host typecheck and tests:

```bash
cd vscode-base
npm run typecheck-client
npm run test-node -- --grep "BaseHalf node execution|BaseHalf node document|BaseHalf canvas recipe"
```

Smoke delivery gate, always against its disposable fixture workspace:

```bash
cd vscode-base
node --experimental-strip-types scripts/basehalf-smoke.mts --plugin-only
npm run basehalf:smoke
```

Run `./scripts/test.sh` as the broader pre-delivery suite after the focused
checks. Record the opt-in live-provider result separately; never add a real
secret or paid request to ordinary CI.

## 20. Definition of done

- ER1–ER14 have automated coverage or an explicitly recorded manual check;
- the host and plugin share typed execution intent and failure contracts rather
  than parsing localized strings;
- no ordinary CI path can make a paid call;
- no failed, cancelled, interrupted, or integrity-invalid run leaves an
  accepted artifact or substitute Result;
- all scoped tests, typecheck, compile-backed smoke, and adversarial spec review
  are green;
- changed provider adapters have a passing opt-in live check before release;
- the implementation diff contains no credential, raw response, unrelated
  workspace initialization, or edit to another parallel work package.
