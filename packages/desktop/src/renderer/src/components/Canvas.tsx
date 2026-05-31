import type {
  BadgeFile,
  BadgeListResult,
  ViewportState,
  WorkspaceGetViewportResult,
} from '@basehalf/core';
import {
  Background,
  type Connection,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  type Viewport,
  applyNodeChanges,
  useNodesInitialized,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { color, font, motion, radius, shadow, space, transition } from '../design.js';
import { createDemoAtDefault, promptForNewNote } from '../lib/actions.js';
import { subscribeBadgeChange } from '../lib/badgeBus.js';
import { briefForClipboard } from '../lib/focusBrief.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { BadgeNode, type BadgeNodeData } from './BadgeNode.js';
import { BriefPreview } from './BriefPreview.js';
import { CanvasControls } from './CanvasControls.js';
import { Onboarding } from './Onboarding.js';
import { ReferenceEdge } from './ReferenceEdge.js';
import { Button } from './primitives/Button.js';
import { usePopover } from './primitives/Popover.js';

const NODE_TYPES: NodeTypes = { badge: BadgeNode };
const EDGE_TYPES: EdgeTypes = { reference: ReferenceEdge };
const DRAG_DEBOUNCE = 300;
const VIEWPORT_DEBOUNCE = 1000;

function badgeToNode(
  badge: BadgeFile,
  fallbackIndex: number,
  total: number,
  override?: { x?: number; y?: number },
): Node<BadgeNodeData> {
  // Auto-layout grid for badges without a saved position. Content TILES are
  // taller than bare labels, so rows need vertical room. Column count ADAPTS to
  // the badge count: a fixed 6 columns stays a tidy few rows for a small folder
  // but grows into a 25-row ribbon for a 150-file one — too tall to frame in a
  // landscape window, so fit-to-view clamps to minZoom and strands rows
  // off-screen. Target a grid whose pixel aspect (~220x250 cells) matches the
  // landscape viewport (~1.54 = viewport-aspect x cell h/w) so the whole
  // workspace frames itself. max(6, …) preserves the tuned small/medium look
  // (<=~23 badges keep 6 columns) and only widens for big folders. Saved
  // positions always win.
  const cols = Math.max(6, Math.ceil(Math.sqrt(1.54 * Math.max(1, total))));
  const x = override?.x ?? badge.canvas?.x ?? 60 + (fallbackIndex % cols) * 220;
  const y = override?.y ?? badge.canvas?.y ?? 60 + Math.floor(fallbackIndex / cols) * 250;
  return {
    id: badge.file,
    type: 'badge',
    position: { x, y },
    data: {
      label: badge.file,
      kind: badge.kind,
      ...(badge.orphan === true && { orphan: true }),
      ...(badge.prompt !== undefined && { prompt: badge.prompt }),
    },
  };
}

function badgesToEdges(badges: readonly BadgeFile[]): Edge[] {
  const out: Edge[] = [];
  const known = new Set(badges.map((b) => b.file));
  for (const badge of badges) {
    for (const ref of badge.references) {
      // Only draw edges to badges we can render — silently skip orphan refs
      // until view-level "broken ref" surfacing lands.
      if (!known.has(ref.to)) continue;
      out.push({
        id: `${badge.file}__${ref.to}`,
        source: badge.file,
        target: ref.to,
        animated: false,
        ...(ref.note !== undefined && { label: ref.note }),
      });
    }
  }
  return out;
}

function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  ms: number,
): (...args: TArgs) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const Canvas = (): JSX.Element => {
  const current = useWorkspaceStore((s) => s.current);
  const currentReachable = useWorkspaceStore((s) => s.currentReachable);
  const setCurrentFile = useWorkspaceStore((s) => s.setCurrentFile);
  const folderScope = useWorkspaceStore((s) => s.folderScope);
  const setFolderScope = useWorkspaceStore((s) => s.setFolderScope);
  const [nodes, setNodes] = useState<Node<BadgeNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [error, setError] = useState<string>('');
  // The FULL workspace focus set (from focus.md / focus.get), independent of the
  // current folder scope. The focus chip reports from THIS — node-derived counts
  // under-report inside a scope (focused files outside the scoped folder aren't
  // rendered), which would break the "see exactly what the agent reads"
  // contract. The per-node `data.focused` flag still drives the on-canvas rings
  // (you can only ring a badge that's actually on screen).
  const [focusActive, setFocusActive] = useState<readonly string[]>([]);
  // Persisted viewport for the current workspace, lifted into state so
  // CanvasFramer (rendered inside <ReactFlow>) frames the canvas once per
  // CONTEXT (workspace + view + folder-scope, captured in `key`): it RESTORES
  // the saved viewport on the main canvas, and FITS to the visible badges when
  // there's no saved viewport (fresh workspace / demo) OR we're inside a view /
  // folder scope (whose badges live in a different coordinate space than the
  // per-workspace saved viewport — applying it there would strand them
  // off-screen). Keying by context frames on ENTER but never yanks the canvas
  // out from under a within-context refresh (e.g. a watcher file event).
  // react-flow's defaultViewport is read ONCE on mount, before refresh
  // resolves; relying on it alone snapped users to (0,0,1) and left first-run
  // badges spilling past the right edge. `vp` is resolved for THAT refresh, so
  // a saved viewport is never mistaken for "none" mid-load.
  const [frame, setFrame] = useState<{ key: string; vp: ViewportState | null } | null>(null);
  // Two views of focus, deliberately distinct: each node's `data.focused` flag
  // drives the on-canvas ring/dot (you can only ring a badge that's on screen),
  // while `focusActive` above holds the FULL workspace focus set that the chip
  // reports — so inside a view/folder scope the chip still names every file the
  // agent reads, even ones not currently rendered.

  const refresh = useCallback(async () => {
    try {
      const result = (await window.bh.run('badge.list')) as BadgeListResult;
      let badges = result.badges;

      if (folderScope !== null) {
        // Scoping INTO a folder shows its CONTENTS — not the folder's own badge
        // (which would read as a sibling of its children, and would suppress the
        // "this folder is empty" hint for a folder with no children). The
        // folder's own prompt/refs are edited via the "Edit folder prompt"
        // toolbar action. Nested child folders still match the prefix and show.
        const prefix = `${folderScope}/`;
        badges = badges.filter((b) => b.file.startsWith(prefix));
      }

      const focusResult = (await window.bh.run('focus.get', {})) as { active: string[] };
      setFocusActive(focusResult.active); // chip reports the full set, not scope-filtered nodes
      const focusedSet = new Set(focusResult.active);
      setNodes(
        badges.map((b, i) => {
          const node = badgeToNode(b, i, badges.length);
          node.data.focused = focusedSet.has(b.file);
          return node;
        }),
      );
      setEdges(badgesToEdges(badges));
      // Inside a folder scope, the per-workspace saved viewport doesn't frame
      // this filtered subset (the folder's badges may sit anywhere) — fit
      // instead (vp:null). On the main canvas, restore the saved viewport.
      const vp =
        folderScope !== null
          ? null
          : ((await window.bh.run('workspace.getViewport', {})) as WorkspaceGetViewportResult);
      setFrame({ key: `${current}|${folderScope ?? ''}`, vp });
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [current, folderScope]);

  useEffect(() => {
    if (current && currentReachable) {
      void refresh();
    } else {
      setNodes([]);
      setEdges([]);
    }
  }, [current, currentReachable, refresh]);

  // Live-update the canvas when files are added / removed / renamed on disk
  // (Finder, the `bh` CLI, an AI agent writing a file). Without this the
  // canvas went stale until a manual reload while the sidebar already
  // refreshed — the hero surface silently lagged reality. The watcher
  // already ignores `.bh/`, so these are real user-file events only. Skip
  // 'change' (content edits don't alter the badge set).
  //
  // The delay must clear the watcher's add path: it buffers ~600ms to detect
  // renames, THEN materializes the badge, so a refresh before ~800ms would
  // hit a badge.list that doesn't include the new file yet (and nothing
  // re-triggers it). A single trailing timer (cleared on each event to
  // coalesce bursts, and on unmount/reload) fires safely past that window.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = window.bh.onFileEvent((event) => {
      if (event.type === 'change') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 1100);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [refresh]);

  // Live-update when a badge's metadata (prompt / references) is edited in the
  // editor's badge panel. Those writes land in `.bh/`, which the watcher above
  // ignores, so the canvas would otherwise show a stale prompt or miss a
  // panel-added edge until reload. The panel emits on each successful mutation
  // (see lib/badgeBus); re-deriving nodes + edges keeps the hero surface honest.
  //
  // COALESCED: refresh() re-walks every badge JSON (badge.list) + focus.get +
  // viewport over IPC, so a burst of edits (rapid prompt saves / ref edits) must
  // not trigger a full re-walk each. A trailing timer collapses a burst into one
  // refresh (canvas is behind the editor overlay, so a small delay is invisible).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = subscribeBadgeChange(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 250);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [refresh]);

  const onNodeDoubleClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      // Cancel the deferred single-click focus collapse — opening a badge must
      // not first wipe the curated focus set.
      if (clickTimer.current) {
        clearTimeout(clickTimer.current.timeout);
        clickTimer.current = null;
      }
      const data = node.data as unknown as BadgeNodeData;
      if (data.kind === 'folder') {
        // Double-clicking a folder badge scopes INTO it — the canvas shows just
        // that folder's contents, and the toolbar offers "Focus this folder".
        setFolderScope(node.id);
        return;
      }
      // File badge → open the full editor overlay. Single-click only sets
      // focus (keeps the canvas + focus viz visible so you can assemble a
      // focus set by clicking around); opening the big editor is the
      // deliberate double-click, matching the desktop select-vs-open idiom.
      setCurrentFile(node.id);
    },
    [setFolderScope, setCurrentFile],
  );

  const persistPosition = useMemo(
    () =>
      debounce((file: string, x: number, y: number) => {
        // A drag updates the badge's canonical canvas position via badge.set
        // (on the main canvas and inside a folder scope alike).
        void window.bh
          .run('badge.set', { file, patch: { canvas: { x, y, collapsed: false } } })
          .catch(() => undefined);
      }, DRAG_DEBOUNCE),
    [],
  );

  const persistViewport = useMemo(
    () =>
      debounce((viewport: ViewportState) => {
        void window.bh.run('workspace.setViewport', { viewport }).catch(() => undefined);
      }, VIEWPORT_DEBOUNCE),
    [],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<BadgeNodeData>>[]) => {
      setNodes((prev) => applyNodeChanges(changes, prev));
      for (const change of changes) {
        if (change.type === 'position' && change.dragging === false && change.position) {
          persistPosition(change.id, change.position.x, change.position.y);
        }
      }
    },
    [persistPosition],
  );

  const onConnect = useCallback(async (conn: Connection) => {
    if (!conn.source || !conn.target) return;
    // A self-drag (source handle back to the same badge's target) is a
    // meaningless no-op, not an error — core rejects self-refs, so without
    // this guard an accidental loop-back would flash a red error banner.
    // Silently ignore it; the gesture just doesn't draw anything.
    if (conn.source === conn.target) return;
    try {
      await window.bh.run('badge.addRef', { file: conn.source, to: conn.target });
      // Refresh so the new edge shows + inbound index updates ripple to other views.
      const result = (await window.bh.run('badge.list')) as BadgeListResult;
      setEdges(badgesToEdges(result.badges));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Edge deletion: react-flow selects-then-Delete-key flow gives us the
  // removed edges here. Each edge's id is `${source}__${target}` (see
  // badgesToEdges) so we can derive the badge.removeRef args from id alone.
  const onEdgesDelete = useCallback(async (deleted: Edge[]) => {
    try {
      for (const e of deleted) {
        await window.bh.run('badge.removeRef', { file: e.source, to: e.target });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Pending deferred single-click focus: the badge id, its timer, and the apply
  // closure (so a click on a DIFFERENT badge can commit it before proceeding).
  const clickTimer = useRef<{
    id: string;
    timeout: ReturnType<typeof setTimeout>;
    apply: () => void;
  } | null>(null);
  // Serialize focus mutations: each apply() chains onto the previous one's
  // promise so they land in click order. Without this, committing a pending
  // plain-click (focus.set([A])) and then a shift-toggle (toggleActiveFile(B))
  // would race two IPC round-trips and could drop A or B non-deterministically.
  const focusChain = useRef<Promise<void>>(Promise.resolve());

  const onNodeClick = useCallback<NodeMouseHandler>(
    (event, node) => {
      const additive = event.shiftKey;
      // The workspace this click was issued against. A deferred timer or a
      // committed-but-in-flight chain link can outlive a workspace switch; focus
      // mutations resolve their target workspace LAZILY at execution time, so a
      // stale apply would otherwise write THIS workspace's badge into whatever
      // workspace is current when its IPC finally runs. We snapshot it here and
      // bail if it no longer matches.
      const issuedFor = useWorkspaceStore.getState().current;
      // Single-click manages FOCUS only — it never opens the editor. Opening is
      // the double-click (onNodeDoubleClick). This keeps the canvas + focus viz
      // visible while you assemble a focus set by clicking badges.
      const apply = (): void => {
        // Enqueue onto the focus-mutation chain so this apply runs only AFTER any
        // previously-committed one resolves (committed-pending-A then toggle-B
        // can't interleave). Each link catches internally, so the chain never
        // rejects and a failed mutation doesn't stall later clicks.
        focusChain.current = focusChain.current.then(async () => {
          // Workspace switched out from under this click → drop it (no IPC, no
          // repaint). This closes the common window (a deferred timer/chain link
          // that runs AFTER the switch settled). NOTE: a residual race remains
          // when the link runs DURING a switch — the main-process config flips to
          // the new root before the renderer's `current` does, and focus.set
          // resolves its workspace lazily; the full fix is an explicit
          // target-workspace arg on focus.set (tracked for a follow-up).
          if (useWorkspaceStore.getState().current !== issuedFor) return;
          try {
            let after: { active: readonly string[] };
            if (additive) {
              // Shift+click TOGGLES membership — add if absent, remove if present
              // — so curating a multi-file set never forces a Clear-and-rebuild
              // (matches Finder / browser / spreadsheet multi-select). Routed
              // through focus.toggleActiveFile so REFINING a folder-sourced focus
              // keeps the turn intent + `# source-folder:` provenance (a bare
              // focus.set({files}) would silently drop both — severing the
              // folder→brief refresh link and losing the curated intent).
              after = (await window.bh.run('focus.toggleActiveFile', { file: node.id })) as {
                active: string[];
              };
            } else {
              // Plain click = focus JUST this file: a fresh files-focus that
              // intentionally starts clean (no prior intent / view provenance).
              await window.bh.run('focus.set', { files: [node.id] });
              after = (await window.bh.run('focus.get', {})) as { active: string[] };
            }
            // Reflect the authoritative focus set on the canvas so the human SEES
            // exactly what the agent now reads.
            setFocusActive(after.active); // keep the chip's full-set count live on click
            const set = new Set(after.active);
            setNodes((prev) =>
              prev.map((n) => ({ ...n, data: { ...n.data, focused: set.has(n.id) } })),
            );
          } catch (err) {
            // The focus set is the trust contract ("I see what the agent reads").
            // A silent failure would desync the canvas from .bh/focus.md, so
            // surface it rather than swallow it.
            setError(err instanceof Error ? err.message : String(err));
          }
        });
      };
      // Resolve a still-pending deferred plain-click before handling this one:
      //  - SAME badge re-clicked → it's a double-click; DROP the pending single
      //    so opening the editor never collapses focus.
      //  - DIFFERENT badge → the prior plain-click wasn't a double-click, so
      //    COMMIT it first (e.g. plain-click A then shift-click B → {A, B}).
      //    Both go through focusChain, so A's focus.set lands before B's toggle
      //    (no IPC race), and A's stale timer can't fire later to drop B.
      const pending = clickTimer.current;
      if (pending) {
        clearTimeout(pending.timeout);
        clickTimer.current = null;
        if (pending.id !== node.id) pending.apply();
      }
      // Shift+click is unambiguous (no shift+double-click gesture) → apply now.
      if (additive) {
        apply();
        return;
      }
      // The SECOND click of a double-click carries detail>=2 and fires before
      // onNodeDoubleClick — bail so a double-click never runs the plain-click
      // focus replace, and let onNodeDoubleClick open the editor.
      if (event.detail >= 2) return;
      // First plain click: DEFER the focus replace. A double-click would
      // otherwise run it first (DOM click before dblclick), collapsing a curated
      // multi-file focus set (+ its intent/provenance) before the editor opens.
      // 320ms comfortably spans a normal double-click interval; the same-badge
      // cancel + detail guard + onNodeDoubleClick make it robust regardless.
      clickTimer.current = {
        id: node.id,
        apply,
        timeout: setTimeout(() => {
          clickTimer.current = null;
          apply();
        }, 320),
      };
    },
    // setNodes / setFocusActive / setError are stable; nothing else external.
    [],
  );

  // Drop a pending deferred single-click focus — used by anything that should
  // SUPERSEDE the click (Clear-focus, a workspace switch, unmount), so a stale
  // timer can't fire afterward and undo the explicit action / write into the
  // wrong workspace.
  const cancelPendingClick = useCallback(() => {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current.timeout);
      clickTimer.current = null;
    }
  }, []);

  // Drop a pending deferred click on unmount AND whenever the active workspace
  // changes: Canvas stays mounted across a switch but window.bh re-points at the
  // new root, so a stale timer could otherwise fire and write the old
  // workspace's badge into the new one's focus brief (or undo an explicit Clear).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `current` is a trigger — re-run (cleanup cancels) when the workspace changes.
  useEffect(() => () => cancelPendingClick(), [current, cancelPendingClick]);

  const clearFocus = useCallback(() => {
    cancelPendingClick(); // an explicit clear must win over a still-deferred click
    const issuedFor = useWorkspaceStore.getState().current;
    // Route the clear through the SAME focusChain as the clicks, so a committed
    // apply() that's still in flight can't repaint the rings AFTER the clear
    // (the clear's setNodes runs strictly after it). Persist FIRST, then reflect;
    // on failure surface the error instead of leaving the canvas showing "empty
    // focus" while .bh/focus.md still feeds the agent stale files.
    focusChain.current = focusChain.current.then(async () => {
      if (useWorkspaceStore.getState().current !== issuedFor) return; // workspace switched away
      try {
        await window.bh.run('focus.clear', {});
        setFocusActive([]);
        setNodes((prev) =>
          prev.map((n) => (n.data.focused ? { ...n, data: { ...n.data, focused: false } } : n)),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }, [cancelPendingClick]);

  // Copy the turn brief (.bh/focus.md verbatim) to the clipboard so the user can
  // paste exactly what their agent reads into ANY chat — making the otherwise
  // invisible payoff of curation tangible and portable (not just the
  // Claude-Code-auto-read-in-repo path). Transient "Copied" confirmation.
  const [briefCopied, setBriefCopied] = useState(false);
  // The focus chip's text expands into a read-only preview of the assembled
  // brief (BriefPreview) — so "your agent reads …" is something you can actually
  // SEE, not just a file count.
  const briefPopover = usePopover({ align: 'left', gap: 6 });
  const copyResetTimer = useRef<number | null>(null);
  const copyBrief = useCallback(() => {
    void (async () => {
      try {
        const { brief } = (await window.bh.run('focus.brief', {})) as { brief: string };
        // Strip bh-internal noise (provenance marker + the .bh/-pointing footer)
        // so what lands in a chat is just the self-contained brief.
        const clean = briefForClipboard(brief);
        // Nothing to copy (focus.md absent under a still-visible chip) — don't
        // write an empty string or flash a misleading "Copied ✓".
        if (clean.length === 0) return;
        await navigator.clipboard.writeText(clean);
        setBriefCopied(true);
        // Reset the confirmation; clear any prior timer so a rapid re-click
        // doesn't let an earlier timer flip the label back early.
        if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
        copyResetTimer.current = window.setTimeout(() => setBriefCopied(false), 1600);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);
  useEffect(
    () => () => {
      if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
    },
    [],
  );

  const onMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => {
      persistViewport({ offsetX: viewport.x, offsetY: viewport.y, scale: viewport.zoom });
    },
    [persistViewport],
  );

  if (!current || currentReachable === false) {
    return (
      <Onboarding
        onAddFolder={() => void useWorkspaceStore.getState().pickAndAdd()}
        onTryDemo={() => void createDemoAtDefault()}
      />
    );
  }

  // Pick the empty-canvas hint based on why nothing's showing: a folder scope
  // with no children vs a freshly-opened workspace with no supported files.
  // (We don't show the hint if a badge exists; the canvas speaks for itself.)
  // The main-canvas case also surfaces a "Create a note" CTA so the user
  // has a single-click path out of the empty state instead of having to
  // discover Cmd+N or the topbar.
  type EmptyHint = { readonly text: string; readonly cta?: 'new-note' };
  const emptyHint: EmptyHint | null =
    nodes.length === 0
      ? folderScope !== null
        ? {
            text: `No badges inside ${folderScope}/ yet. Drop files into this folder; they'll appear automatically.`,
          }
        : {
            text: "This workspace has no files yet. Drop files in the folder and they'll appear as badges — or create one now:",
            cta: 'new-note',
          }
      : null;

  // Derived from the FULL focus set (focusActive), NOT the rendered nodes —
  // inside a view/folder scope the focus set can include files that aren't on
  // screen, and the chip must still name everything the agent reads (its whole
  // reason for existing is "see exactly what your agent reads"). Naming the
  // files — not just counting — makes the witness concrete.
  const focusedFiles = focusActive;
  const focusedCount = focusedFiles.length;
  const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1);
  const focusedNames = focusedFiles.map(baseName);
  const focusedLabel =
    focusedCount === 1
      ? (focusedNames[0] ?? '')
      : `${focusedNames.slice(0, 3).join(', ')}${
          focusedNames.length > 3 ? ` +${focusedNames.length - 3} more` : ''
        }`;

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {focusedCount > 0 && (
        // Witnessed payoff: name the context the human handed the agent. The
        // focus set was previously a write-only side effect with no visible
        // trace — now the human can SEE (and clear) what their agent reads.
        <div
          data-testid="focus-chip"
          style={{
            position: 'absolute',
            top: space[3],
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 8,
            display: 'flex',
            alignItems: 'center',
            gap: space[2],
            background: color.surface,
            border: `1px solid ${color.accentSoft}`,
            borderRadius: radius.pill,
            padding: `${space[1]}px ${space[1]}px ${space[1]}px ${space[3]}px`,
            boxShadow: shadow.raised,
            fontFamily: font.sans,
            fontSize: font.size.caption,
            color: color.textSecondary,
            animation: `bh-banner-in ${motion.normal}`,
          }}
        >
          <button
            type="button"
            ref={briefPopover.triggerRef}
            onClick={briefPopover.toggle}
            title="See exactly what your agent reads"
            aria-expanded={briefPopover.open}
            data-testid="focus-chip-trigger"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: space[1.5],
              minWidth: 0,
              maxWidth: 460,
              border: 'none',
              background: 'transparent',
              padding: 0,
              margin: 0,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 'inherit',
              color: 'inherit',
              textAlign: 'left',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: color.accent,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              <strong style={{ color: color.textPrimary, fontWeight: font.weight.semibold }}>
                {focusedCount}
              </strong>{' '}
              {focusedCount === 1 ? 'file' : 'files'} in focus — your agent reads{' '}
              <span style={{ color: color.textPrimary }}>{focusedLabel}</span>
            </span>
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                color: color.textTertiary,
                fontSize: 10,
                transform: briefPopover.open ? 'rotate(180deg)' : 'none',
                transition: transition(['transform']),
              }}
            >
              ▾
            </span>
          </button>
          {/* Copy lives INSIDE the preview panel ("look, then send") — so a copy
              always reflects the brief you're looking at, including a just-typed
              intent. The chip is summary + open + clear. */}
          <button
            type="button"
            onClick={clearFocus}
            title="Clear focus"
            data-testid="focus-clear"
            style={{
              border: 'none',
              background: 'transparent',
              color: color.textTertiary,
              fontFamily: font.sans,
              fontSize: font.size.caption,
              cursor: 'pointer',
              padding: `${space[0.5]}px ${space[2]}px`,
              borderRadius: radius.pill,
            }}
          >
            Clear
          </button>
          <BriefPreview controller={briefPopover} onCopy={copyBrief} copied={briefCopied} />
        </div>
      )}
      {error && (
        <div
          style={{
            position: 'absolute',
            top: space[3],
            right: space[3],
            background: color.surface,
            border: `1px solid ${color.danger}33`,
            padding: `${space[2]}px ${space[3]}px`,
            fontSize: font.size.caption,
            fontFamily: font.sans,
            color: color.danger,
            borderRadius: radius.md,
            boxShadow: shadow.raised,
            zIndex: 10,
            animation: `bh-banner-in ${motion.normal}`,
            maxWidth: 360,
          }}
        >
          {error}
        </div>
      )}
      {emptyHint && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            maxWidth: 380,
            padding: `${space[4]}px ${space[5]}px`,
            background: color.surface,
            border: `1px dashed ${color.borderStrong}`,
            borderRadius: radius.lg,
            fontFamily: font.sans,
            fontSize: font.size.body,
            color: color.textSecondary,
            textAlign: 'center',
            lineHeight: 1.55,
            zIndex: 5,
            // pointerEvents:'none' when there's no CTA so the dot grid
            // behind stays draggable for panning; flip to 'auto' when
            // the CTA button needs to be clickable.
            pointerEvents: emptyHint.cta ? 'auto' : 'none',
          }}
        >
          {emptyHint.text}
          {emptyHint.cta === 'new-note' && (
            <div style={{ marginTop: space[3] }}>
              <Button variant="primary" onClick={() => void promptForNewNote()}>
                New note
              </Button>
            </div>
          )}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        deleteKeyCode={['Delete', 'Backspace']}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onMoveEnd={onMoveEnd}
        // All edges render through ReferenceEdge (see EDGE_TYPES): the line is
        // always visible, the note reveals on hover/selection — no colliding
        // always-on midpoint labels. Animation off; the custom edge owns its
        // stroke + accent-on-interaction styling.
        defaultEdgeOptions={{ type: 'reference', animated: false }}
        // Drawing a reference is the core "compound thinking" gesture, so the
        // live drag should preview the relationship in the brand accent (the
        // same color a hovered/selected edge takes) rather than React Flow's
        // default grey — the line you're dragging IS the connection-to-be.
        connectionLineStyle={{ stroke: color.accent, strokeWidth: 2 }}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        minZoom={0.2}
        maxZoom={4}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color={color.border} />
        <CanvasControls />
        <CanvasFramer frame={frame} />
      </ReactFlow>
    </div>
  );
};

// Re-export useReactFlow so children can re-center programmatically later.
export { useReactFlow };

/**
 * Frames the canvas after each refresh. Rendered inside <ReactFlow> so the
 * hooks have a provider. For every refresh (identified by `frame.seq`) it
 * applies exactly once, but only after `useNodesInitialized` reports the
 * current nodes have measured dimensions — `fitView` needs real node sizes
 * to compute the bounding box.
 *
 *   - saved viewport present → RESTORE it (reload / re-open keeps your place).
 *   - no saved viewport (fresh workspace / demo) → FIT to all badges so the
 *     whole graph is visible instead of spilling past the right edge.
 *
 * maxZoom:1 stops a lone badge from blowing up to fill the screen; the guard
 * on `appliedSeq` keeps node drags (which re-flip nodesInitialized) from
 * re-framing and yanking the canvas out from under the user.
 */
const CanvasFramer = ({
  frame,
}: { frame: { key: string; vp: ViewportState | null } | null }): null => {
  const { setViewport, fitView, getNodes } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const framedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!frame || !nodesInitialized) return;
    // Frame once per context. A same-key refresh (a watcher file event, a
    // focus change) must NOT re-frame — that would yank the canvas out from
    // under the user mid-work.
    if (framedKey.current === frame.key) return;
    framedKey.current = frame.key;
    if (frame.vp) {
      setViewport({ x: frame.vp.offsetX, y: frame.vp.offsetY, zoom: frame.vp.scale });
    } else if (getNodes().length > 0) {
      void fitView({ padding: 0.2, maxZoom: 1, duration: 0 });
    }
  }, [frame, nodesInitialized, setViewport, fitView, getNodes]);
  return null;
};
