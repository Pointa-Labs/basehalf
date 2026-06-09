/**
 * fuzzyScore — a self-contained fuzzy matcher modeled on the quick-open
 * scorers found in modern code editors.
 *
 * Why this instead of substring `.includes()`: the command palette used to
 * filter by literal case-insensitive substring, which can neither match
 * non-contiguous initials (typing `cmdpal` → `CommandPalette`) nor RANK
 * results by how good the match is. The editor quick-open pattern is the gold
 * standard for "type a few characters, get the closest thing first", so we
 * follow its scoring — dynamic-programming alignment that rewards
 * word-boundary, separator, camelCase and prefix hits and penalizes gaps.
 *
 * Implementation note: the emoji-as-separator branch some scorers carry is
 * dropped — file names and command labels here are ASCII-dominant, so the
 * extra emoji table isn't worth the weight. Everything else (the table
 * arrows, the backwards-diagonal overturn, the full-match boost, the
 * skipped-char penalty) is kept so the ranking matches what users expect from
 * an editor-style palette.
 *
 * Note on the `cell`/`at` accessors: the renderer's tsconfig sets
 * `noUncheckedIndexedAccess`, which would force a
 * `| undefined` through every read of the DP tables and the lowercased
 * strings. These tables are pre-sized and fully zero-initialized, so every
 * in-range access IS a real number — the accessors encode that invariant once
 * instead of littering casts through the hot loop.
 *
 * The `FuzzyScore` shape is `[score, wordStart, ...matchPositions]`, exactly
 * as upstream — `createMatches` turns it into `{start,end}` ranges for
 * highlighting the characters that matched.
 */

/** A contiguous run of matched characters, as char offsets into the word. */
export interface IMatch {
  start: number;
  end: number;
}

/**
 * An array representing a fuzzy match.
 *
 * 0. the score
 * 1. the offset at which matching started
 * 2. `<match_pos_N>` … `<match_pos_0>` (descending)
 */
export type FuzzyScore = [score: number, wordStart: number, ...matches: number[]];

interface FuzzyScoreOptions {
  readonly firstMatchCanBeWeak: boolean;
  readonly boostFullMatch: boolean;
}

const DEFAULT_OPTIONS: FuzzyScoreOptions = { boostFullMatch: true, firstMatchCanBeWeak: false };

/** Read a guaranteed-in-range element of a pre-sized 1-D table. */
function at(arr: number[], i: number): number {
  return arr[i] as number;
}

/** Read a guaranteed-in-range element of a pre-sized 2-D table. */
function cell(t: number[][], r: number, c: number): number {
  return (t[r] as number[])[c] as number;
}

/** Write a guaranteed-in-range element of a pre-sized 2-D table. */
function setCell(t: number[][], r: number, c: number, v: number): void {
  (t[r] as number[])[c] = v;
}

/** Turn a `FuzzyScore` into highlight ranges (matched-char runs). */
export function createMatches(score: undefined | FuzzyScore): IMatch[] {
  if (typeof score === 'undefined') {
    return [];
  }
  const res: IMatch[] = [];
  const wordPos = score[1];
  for (let i = score.length - 1; i > 1; i--) {
    const pos = (score[i] as number) + wordPos;
    const last = res[res.length - 1];
    if (last && last.end === pos) {
      last.end = pos + 1;
    } else {
      res.push({ start: pos, end: pos + 1 });
    }
  }
  return res;
}

const _maxLen = 128;

function initArr(maxLen: number): number[] {
  const row: number[] = [];
  for (let i = 0; i <= maxLen; i++) {
    row[i] = 0;
  }
  return row;
}

function initTable(): number[][] {
  const table: number[][] = [];
  const row = initArr(_maxLen);
  for (let i = 0; i <= _maxLen; i++) {
    table.push(row.slice(0));
  }
  return table;
}

const _minWordMatchPos = initArr(2 * _maxLen);
const _maxWordMatchPos = initArr(2 * _maxLen);
const _diag = initTable();
const _table = initTable();
// Stores `Arrow` enum values (numbers); typed as number[][] to share the cell
// accessors with the score tables.
const _arrows = initTable();

// Char codes treated as word separators (the usual editor set, sans emoji).
const SEPARATORS = new Set<number>([
  95, // _
  45, // -
  46, // .
  32, // space
  47, // /
  92, // \
  39, // '
  34, // "
  58, // :
  36, // $
  60, // <
  62, // >
  40, // (
  41, // )
  91, // [
  93, // ]
  123, // {
  125, // }
]);

function isSeparatorAtPos(value: string, index: number): boolean {
  if (index < 0 || index >= value.length) {
    return false;
  }
  const code = value.codePointAt(index);
  return code !== undefined && SEPARATORS.has(code);
}

function isWhitespaceAtPos(value: string, index: number): boolean {
  if (index < 0 || index >= value.length) {
    return false;
  }
  const code = value.charCodeAt(index);
  return code === 32 /* space */ || code === 9 /* tab */;
}

function isUpperCaseAtPos(pos: number, word: string, wordLow: string): boolean {
  return word[pos] !== wordLow[pos];
}

function isPatternInWord(
  patternLow: string,
  patternStart: number,
  patternLen: number,
  wordLow: string,
  wordStart: number,
  wordLen: number,
  fillMinWordPosArr = false,
): boolean {
  let patternPos = patternStart;
  let wordPos = wordStart;
  while (patternPos < patternLen && wordPos < wordLen) {
    if (patternLow[patternPos] === wordLow[wordPos]) {
      if (fillMinWordPosArr) {
        _minWordMatchPos[patternPos] = wordPos;
      }
      patternPos += 1;
    }
    wordPos += 1;
  }
  return patternPos === patternLen;
}

enum Arrow {
  Diag = 1,
  Left = 2,
  LeftLeft = 3,
}

function _fillInMaxWordMatchPos(
  patternLen: number,
  wordLen: number,
  patternStart: number,
  wordStart: number,
  patternLow: string,
  wordLow: string,
): void {
  let patternPos = patternLen - 1;
  let wordPos = wordLen - 1;
  while (patternPos >= patternStart && wordPos >= wordStart) {
    if (patternLow[patternPos] === wordLow[wordPos]) {
      _maxWordMatchPos[patternPos] = wordPos;
      patternPos--;
    }
    wordPos--;
  }
}

function _doScore(
  pattern: string,
  patternLow: string,
  patternPos: number,
  patternStart: number,
  word: string,
  wordLow: string,
  wordPos: number,
  wordLen: number,
  wordStart: number,
  newMatchStart: boolean,
  outFirstMatchStrong: boolean[],
): number {
  if (patternLow[patternPos] !== wordLow[wordPos]) {
    return Number.MIN_SAFE_INTEGER;
  }

  let score = 1;
  let isGapLocation = false;
  if (wordPos === patternPos - patternStart) {
    // common prefix: `foobar <-> foobaz`
    score = pattern[patternPos] === word[wordPos] ? 7 : 5;
  } else if (
    isUpperCaseAtPos(wordPos, word, wordLow) &&
    (wordPos === 0 || !isUpperCaseAtPos(wordPos - 1, word, wordLow))
  ) {
    // hitting upper-case: `foo <-> forOthers`
    score = pattern[patternPos] === word[wordPos] ? 7 : 5;
    isGapLocation = true;
  } else if (
    isSeparatorAtPos(wordLow, wordPos) &&
    (wordPos === 0 || !isSeparatorAtPos(wordLow, wordPos - 1))
  ) {
    // hitting a separator: `. <-> foo.bar`
    score = 5;
  } else if (isSeparatorAtPos(wordLow, wordPos - 1) || isWhitespaceAtPos(wordLow, wordPos - 1)) {
    // post separator: `foo <-> bar_foo`
    score = 5;
    isGapLocation = true;
  }

  if (score > 1 && patternPos === patternStart) {
    outFirstMatchStrong[0] = true;
  }

  if (!isGapLocation) {
    isGapLocation =
      isUpperCaseAtPos(wordPos, word, wordLow) ||
      isSeparatorAtPos(wordLow, wordPos - 1) ||
      isWhitespaceAtPos(wordLow, wordPos - 1);
  }

  if (patternPos === patternStart) {
    // first character in pattern
    if (wordPos > wordStart) {
      score -= isGapLocation ? 3 : 5;
    }
  } else if (newMatchStart) {
    score += isGapLocation ? 2 : 0;
  } else {
    score += isGapLocation ? 0 : 1;
  }

  if (wordPos + 1 === wordLen) {
    // pretend there is a gap after the last character to normalize things
    score -= isGapLocation ? 3 : 5;
  }

  return score;
}

function fuzzyScore(
  pattern: string,
  patternLow: string,
  patternStart: number,
  word: string,
  wordLow: string,
  wordStart: number,
  options: FuzzyScoreOptions = DEFAULT_OPTIONS,
): FuzzyScore | undefined {
  const patternLen = pattern.length > _maxLen ? _maxLen : pattern.length;
  const wordLen = word.length > _maxLen ? _maxLen : word.length;

  if (
    patternStart >= patternLen ||
    wordStart >= wordLen ||
    patternLen - patternStart > wordLen - wordStart
  ) {
    return undefined;
  }

  // Quick reject: do the pattern characters occur (in order) in the word?
  if (!isPatternInWord(patternLow, patternStart, patternLen, wordLow, wordStart, wordLen, true)) {
    return undefined;
  }

  _fillInMaxWordMatchPos(patternLen, wordLen, patternStart, wordStart, patternLow, wordLow);

  let row = 1;
  let column = 1;
  let patternPos = patternStart;
  let wordPos = wordStart;

  const hasStrongFirstMatch = [false];

  for (row = 1, patternPos = patternStart; patternPos < patternLen; row++, patternPos++) {
    const minWordMatchPos = at(_minWordMatchPos, patternPos);
    const maxWordMatchPos = at(_maxWordMatchPos, patternPos);
    const nextMaxWordMatchPos =
      patternPos + 1 < patternLen ? at(_maxWordMatchPos, patternPos + 1) : wordLen;

    for (
      column = minWordMatchPos - wordStart + 1, wordPos = minWordMatchPos;
      wordPos < nextMaxWordMatchPos;
      column++, wordPos++
    ) {
      let score = Number.MIN_SAFE_INTEGER;
      let canComeDiag = false;

      if (wordPos <= maxWordMatchPos) {
        score = _doScore(
          pattern,
          patternLow,
          patternPos,
          patternStart,
          word,
          wordLow,
          wordPos,
          wordLen,
          wordStart,
          cell(_diag, row - 1, column - 1) === 0,
          hasStrongFirstMatch,
        );
      }

      let diagScore = 0;
      if (score !== Number.MIN_SAFE_INTEGER) {
        canComeDiag = true;
        diagScore = score + cell(_table, row - 1, column - 1);
      }

      const canComeLeft = wordPos > minWordMatchPos;
      const leftScore = canComeLeft
        ? cell(_table, row, column - 1) + (cell(_diag, row, column - 1) > 0 ? -5 : 0)
        : 0;

      const canComeLeftLeft = wordPos > minWordMatchPos + 1 && cell(_diag, row, column - 1) > 0;
      const leftLeftScore = canComeLeftLeft
        ? cell(_table, row, column - 2) + (cell(_diag, row, column - 2) > 0 ? -5 : 0)
        : 0;

      if (
        canComeLeftLeft &&
        (!canComeLeft || leftLeftScore >= leftScore) &&
        (!canComeDiag || leftLeftScore >= diagScore)
      ) {
        setCell(_table, row, column, leftLeftScore);
        setCell(_arrows, row, column, Arrow.LeftLeft);
        setCell(_diag, row, column, 0);
      } else if (canComeLeft && (!canComeDiag || leftScore >= diagScore)) {
        setCell(_table, row, column, leftScore);
        setCell(_arrows, row, column, Arrow.Left);
        setCell(_diag, row, column, 0);
      } else if (canComeDiag) {
        setCell(_table, row, column, diagScore);
        setCell(_arrows, row, column, Arrow.Diag);
        setCell(_diag, row, column, cell(_diag, row - 1, column - 1) + 1);
      } else {
        throw new Error('not possible');
      }
    }
  }

  if (!hasStrongFirstMatch[0] && !options.firstMatchCanBeWeak) {
    return undefined;
  }

  row--;
  column--;

  const result: FuzzyScore = [cell(_table, row, column), wordStart];

  let backwardsDiagLength = 0;
  let maxMatchColumn = 0;

  while (row >= 1) {
    let diagColumn = column;
    do {
      const arrow = cell(_arrows, row, diagColumn);
      if (arrow === Arrow.LeftLeft) {
        diagColumn = diagColumn - 2;
      } else if (arrow === Arrow.Left) {
        diagColumn = diagColumn - 1;
      } else {
        break;
      }
    } while (diagColumn >= 1);

    if (
      backwardsDiagLength > 1 &&
      patternLow[patternStart + row - 1] === wordLow[wordStart + column - 1] &&
      !isUpperCaseAtPos(diagColumn + wordStart - 1, word, wordLow) &&
      backwardsDiagLength + 1 > cell(_diag, row, diagColumn)
    ) {
      diagColumn = column;
    }

    if (diagColumn === column) {
      backwardsDiagLength++;
    } else {
      backwardsDiagLength = 1;
    }

    if (!maxMatchColumn) {
      maxMatchColumn = diagColumn;
    }

    row--;
    column = diagColumn - 1;
    result.push(column);
  }

  if (wordLen - wordStart === patternLen && options.boostFullMatch) {
    result[0] += 2;
  }

  const skippedCharsCount = maxMatchColumn - patternLen;
  result[0] -= skippedCharsCount;

  return result;
}

/**
 * Convenience wrapper: fuzzy-match `pattern` against `target`, returning the
 * raw `FuzzyScore` (or `undefined` for no match). Empty pattern → a neutral
 * zero-score match so callers can treat "" as "everything matches".
 *
 * Uses `firstMatchCanBeWeak: true` (so `roadmap` still matches `roadmap.md`
 * even though the first hit isn't a strong word-boundary) and
 * `boostFullMatch: true` (so an exact full-string hit floats to the top).
 */
export function fuzzyMatch(pattern: string, target: string): FuzzyScore | undefined {
  if (pattern.length === 0) {
    return [0, 0];
  }
  return fuzzyScore(pattern, pattern.toLowerCase(), 0, target, target.toLowerCase(), 0, {
    firstMatchCanBeWeak: true,
    boostFullMatch: true,
  });
}
