/**
 * Scroll the first rendered element under `root` whose text contains `query`
 * (case-insensitive) into view, and briefly flash it — so opening a file from a
 * content-search hit LANDS on the passage instead of the top.
 *
 * Walks rendered text nodes rather than knowing the viewer's structure, so it's
 * agnostic to how the content is laid out — but it only reads as a clean
 * "jump to this paragraph" when the matched text node sits in a SMALL element
 * (one block), which the block-based MD editor gives us. Callers scope it to
 * that viewer; a single huge `<pre>` would resolve the match's parent to the
 * whole body, which isn't a useful target.
 *
 * Returns true when a match was found + scrolled (so the caller can stop
 * retrying while async content is still rendering), false otherwise.
 */
export function scrollToFirstMatch(root: HTMLElement, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent;
    if (text === null || !text.toLowerCase().includes(needle)) continue;
    const el = node.parentElement;
    if (el === null) continue;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    flashElement(el);
    return true;
  }
  return false;
}

// Soft accent-tinted highlight, ~1s, then restored. Only the two inline props we
// touch are saved/restored, so the viewer's own styling is never clobbered.
const FLASH_BG = 'rgba(120, 160, 240, 0.28)';

function flashElement(el: HTMLElement): void {
  const prevBg = el.style.backgroundColor;
  const prevTransition = el.style.transition;
  el.style.transition = 'background-color 140ms ease';
  el.style.backgroundColor = FLASH_BG;
  window.setTimeout(() => {
    el.style.backgroundColor = prevBg;
    window.setTimeout(() => {
      el.style.transition = prevTransition;
    }, 220);
  }, 850);
}
