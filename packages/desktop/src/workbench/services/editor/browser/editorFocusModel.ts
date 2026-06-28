export * from '../common/editorFocusModel.js';

/** The id of the topmost block the user can see: the first `[data-id]` element
 *  whose box reaches below the scroll viewport's top edge. DOM-bound, so it stays
 *  in browser while source-line/block projection lives in common. */
export function firstVisibleBlockId(
  editorRoot: HTMLElement | null | undefined,
  scrollEl: HTMLElement | null | undefined,
): string | null {
  if (!editorRoot || !scrollEl) return null;
  const top = scrollEl.getBoundingClientRect().top;
  for (const el of editorRoot.querySelectorAll<HTMLElement>('[data-id]')) {
    // +1px tolerance so a block flush with the top edge counts as visible.
    if (el.getBoundingClientRect().bottom > top + 1) {
      const id = el.getAttribute('data-id');
      if (id) return id;
    }
  }
  return null;
}
