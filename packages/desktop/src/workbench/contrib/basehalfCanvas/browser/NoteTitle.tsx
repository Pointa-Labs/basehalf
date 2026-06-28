import { type JSX, useEffect, useRef, useState } from 'react';
import { color, font, space } from '../../../browser/style/design.js';
import { isImeComposing } from '../../../browser/ui/imeGuard.js';
import { noteTitleOf } from '../../../services/editor/browser/noteTitleModel.js';
import { useWorkspaceStore } from '../../../services/workspace/browser/workspaceStore.js';

/**
 * The note's title, shown at the top of the panel editor's content
 * column. The title IS the filename (minus `.md`) — typing it renames the file;
 * nothing is written into the body. It commits on blur / Enter (not per
 * keystroke), so the disk file moves once per edit while the input itself stays
 * instantly responsive. The body editor remounts on the rename, but only AFTER
 * focus has left here, so typing is never interrupted.
 *
 * Lives as its own component (filename concern) beside the body editor (content
 * concern); MdEditor only positions it in the column.
 */
// BlockNote's panel editor indents its content by this much (its left
// side-menu / drag-handle gutter). The title matches it so their left edges
// line up; revisit if a BlockNote upgrade changes the default gutter.
const BN_GUTTER = 54;

export const NoteTitle = ({ file }: { file: string }): JSX.Element => {
  const [value, setValue] = useState(() => noteTitleOf(file));
  const inputRef = useRef<HTMLInputElement>(null);
  const titleFocusPath = useWorkspaceStore((s) => s.titleFocusPath);
  const consumeTitleFocus = useWorkspaceStore((s) => s.consumeTitleFocus);

  // Mirror the on-disk name when it changes underneath us — a committed rename
  // or a switch to another note. (Typing never triggers this; `file` only moves
  // once the rename lands.)
  useEffect(() => {
    setValue(noteTitleOf(file));
  }, [file]);

  // New-note flow: focus + select so the user types straight over "Untitled".
  useEffect(() => {
    if (titleFocusPath !== file) return;
    inputRef.current?.focus();
    inputRef.current?.select();
    consumeTitleFocus();
  }, [titleFocusPath, file, consumeTitleFocus]);

  // Blur is the single commit path: Enter blurs (committing once, then focus
  // falls to the body), a click-away blurs, and Escape blurs WITH this flag set
  // to cancel. Routing every exit through one commit avoids the double-rename a
  // separate Enter-commit would cause (the second call racing before openFile
  // rebinds, then failing on the already-moved source).
  const cancelRef = useRef(false);
  const toBodyRef = useRef(false);

  return (
    <input
      ref={inputRef}
      className="bh-note-title"
      value={value}
      placeholder="Untitled"
      aria-label="Note title"
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={async () => {
        if (cancelRef.current) {
          cancelRef.current = false;
          toBodyRef.current = false;
          setValue(noteTitleOf(file)); // discard the edit
          return;
        }
        const toBody = toBodyRef.current;
        toBodyRef.current = false;
        const landed = await useWorkspaceStore.getState().renameOpenFile(value);
        // Enter → hand the cursor to that note's body (keyed by its landing path,
        // so the editor that remounts on the new name is the one that takes it).
        if (toBody && landed !== null) useWorkspaceStore.getState().requestBodyFocus(landed);
      }}
      onKeyDown={(e) => {
        if (isImeComposing(e)) return; // mid-IME (e.g. pinyin) — let it compose
        if (e.key === 'Enter') {
          // Commit, then drop the cursor into the body. Space stays a literal
          // space — titles routinely contain them ("My Great Note").
          e.preventDefault();
          toBodyRef.current = true;
          inputRef.current?.blur(); // → onBlur commits, then requests body focus
        } else if (e.key === 'Escape') {
          cancelRef.current = true; // tell onBlur to discard rather than rename
          inputRef.current?.blur();
        }
      }}
      style={{
        // The panel BlockNote body indents its content by its left side-menu
        // (drag-handle) gutter; mirror that inline padding so the title's text
        // lines up exactly with the paragraphs below it.
        width: '100%',
        boxSizing: 'border-box',
        border: 'none',
        outline: 'none',
        background: 'transparent',
        padding: `0 ${BN_GUTTER}px`,
        marginBottom: space[6],
        fontFamily: font.sans,
        fontSize: 40,
        fontWeight: font.weight.bold,
        lineHeight: 1.15,
        letterSpacing: 0,
        color: color.textPrimary,
      }}
    />
  );
};
