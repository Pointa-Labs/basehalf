import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorkspaceMainService } from '../../../../platform/workspaces/electron-main/workspacesMainService.js';
import type { BadgeMainService } from '../../mirror/electron-main/badgeMainService.js';
import type {
  SearchBriefArgs,
  SearchBriefResult,
  SearchHit,
  SearchMatch,
  SearchQueryArgs,
  SearchQueryResult,
} from '../common/search.js';

export interface SearchBackendProvider {
  query(workspaceRoot: string | null, args: SearchQueryArgs): Promise<SearchQueryResult>;
  brief(workspaceRoot: string | null, args: SearchBriefArgs): Promise<SearchBriefResult>;
}

export interface WorkbenchSearchBackendProviderOptions {
  readonly workspace: Pick<WorkspaceMainService, 'listFiles' | 'readFile'>;
  readonly badges: Pick<BadgeMainService, 'list' | 'get'>;
}

const SKIP_DIRS: ReadonlySet<string> = new Set([
  '.git',
  '.bh',
  '.DS_Store',
  '.idea',
  '.vscode',
  '.turbo',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'node_modules',
  'dist',
  'build',
  'out',
  '__pycache__',
  '.pytest_cache',
  'target',
  'vendor',
]);

const DEFAULT_MAX_FILES = 50;
const DEFAULT_MAX_MATCHES_PER_FILE = 5;
const PER_FILE_MAX_CHARS = 100_000;
const SNIPPET_MAX_CHARS = 200;
const MAX_DIRS = 5_000;
const MAX_FILES_SCANNED = 20_000;
const BRIEF_MAX_FILES = 8;
const BRIEF_MAX_MATCHES_PER_FILE = 3;

interface Matcher {
  test(s: string): boolean;
  firstMatch(line: string): { readonly index: number; readonly length: number } | null;
}

/**
 * Workbench-owned content search backend. VS Code keeps search as a workbench
 * service that composes file services and model metadata; BaseHalf does the same
 * here by depending explicitly on workspace files and badge metadata through
 * typed providers.
 */
export class WorkbenchSearchBackendProvider implements SearchBackendProvider {
  constructor(private readonly opts: WorkbenchSearchBackendProviderOptions) {}

  async query(workspaceRoot: string | null, args: SearchQueryArgs): Promise<SearchQueryResult> {
    const needle = (args.query ?? '').trim();
    if (needle.length === 0) return { query: '', hits: [] };
    const needleLower = needle.toLowerCase();
    const matcher = buildMatcher(needle, {
      caseSensitive: args.caseSensitive,
      wholeWord: args.wholeWord,
      regex: args.regex,
    });
    if (matcher === null) return { query: needle, hits: [] };

    const root = requireWorkspaceRoot(workspaceRoot);
    const maxFiles = clampPositive(args.maxFiles, DEFAULT_MAX_FILES);
    const maxMatchesPerFile = clampPositive(args.maxMatchesPerFile, DEFAULT_MAX_MATCHES_PER_FILE);

    const hits: SearchHit[] = [];
    let truncated = false;
    let dirsWalked = 0;
    let filesScanned = 0;
    const visited = new Set<string>();
    const stack: Array<{ abs: string; rel: string }> = [{ abs: root, rel: '' }];

    outer: while (stack.length > 0) {
      const frame = stack.pop();
      if (frame === undefined) break;
      let realDir: string;
      try {
        realDir = await realpath(frame.abs);
      } catch (err) {
        if (frame.rel === '') throw err;
        continue;
      }
      if (visited.has(realDir)) continue;
      visited.add(realDir);
      if (++dirsWalked > MAX_DIRS) {
        truncated = true;
        break;
      }

      let listing: Awaited<
        ReturnType<WorkbenchSearchBackendProviderOptions['workspace']['listFiles']>
      >;
      try {
        listing = await this.opts.workspace.listFiles(workspaceRoot, { path: frame.abs });
      } catch (err) {
        if (frame.rel === '') throw err;
        continue;
      }

      const dirs: (typeof frame)[] = [];
      for (const entry of listing.entries) {
        const childRel = frame.rel ? `${frame.rel}/${entry.name}` : entry.name;
        const childAbs = join(frame.abs, entry.name);
        if (entry.type === 'dir') {
          if (SKIP_DIRS.has(entry.name)) continue;
          dirs.push({ abs: childAbs, rel: childRel });
          continue;
        }

        if (++filesScanned > MAX_FILES_SCANNED) {
          truncated = true;
          break outer;
        }

        let file: Awaited<
          ReturnType<WorkbenchSearchBackendProviderOptions['workspace']['readFile']>
        >;
        try {
          file = await this.opts.workspace.readFile(workspaceRoot, {
            path: childRel,
            maxChars: PER_FILE_MAX_CHARS,
          });
        } catch {
          continue;
        }
        if (file.binary) continue;
        if (file.truncated) truncated = true;
        if (!matcher.test(file.content)) continue;

        const lines = file.content.split(/\r\n|\r|\n/);
        const matches: SearchMatch[] = [];
        let total = 0;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? '';
          const match = matcher.firstMatch(line);
          if (match === null) continue;
          total++;
          if (matches.length < maxMatchesPerFile) {
            matches.push({ line: i + 1, text: snippet(line, match.index, match.length) });
          }
        }
        if (total === 0) continue;
        hits.push({
          file: childRel,
          matches,
          total,
          ...(file.truncated && { truncated: true }),
        });
      }

      for (let i = dirs.length - 1; i >= 0; i--) {
        const dir = dirs[i];
        if (dir !== undefined) stack.push(dir);
      }
    }

    const aboutFiles = await this.aboutFiles(workspaceRoot, needleLower);
    hits.sort(
      (a, b) =>
        (aboutFiles.has(a.file) ? 0 : 1) - (aboutFiles.has(b.file) ? 0 : 1) ||
        b.total - a.total ||
        a.file.localeCompare(b.file),
    );
    const capped = hits.length > maxFiles;
    const top = capped ? hits.slice(0, maxFiles) : hits;
    return { query: needle, hits: top, ...((truncated || capped) && { truncated: true }) };
  }

  async brief(workspaceRoot: string | null, args: SearchBriefArgs): Promise<SearchBriefResult> {
    const result = await this.query(workspaceRoot, {
      query: args.query,
      maxFiles: clampPositive(args.maxFiles, BRIEF_MAX_FILES),
      maxMatchesPerFile: clampPositive(args.maxMatchesPerFile, BRIEF_MAX_MATCHES_PER_FILE),
    });

    const lines: string[] = ['# bh search brief', '', `query: ${result.query}`, ''];
    if (result.hits.length === 0) {
      lines.push('results:', '  (none)');
    } else {
      lines.push('results:');
      for (const hit of result.hits) {
        lines.push(`  - ${hit.file}`);
        const badge = await this.getBadge(workspaceRoot, hit.file);
        const prompt = badge?.description?.trim();
        if (prompt !== undefined && prompt !== '') lines.push(`      description: ${prompt}`);
        for (const match of hit.matches) {
          lines.push(`      match (line ${match.line}): ${match.text}`);
        }
        const refs = badge?.references ?? [];
        if (refs.length > 0) {
          lines.push('      refs:');
          for (const ref of refs) lines.push(`        -> ${ref}`);
        }
        const inbound = badge?.referenced_by ?? [];
        if (inbound.length > 0) {
          lines.push('      referenced-by:');
          for (const from of inbound) lines.push(`        <- ${from}`);
        }
      }
    }
    lines.push(
      '',
      '# (Assembled by content search — each file inlines its human-written notes.',
      '#  Files were matched by content; those whose description is ABOUT the query',
      '#  rank first. Still retrieval, not hand-curation — treat relevance accordingly.)',
    );

    return {
      query: result.query,
      brief: `${lines.join('\n')}\n`,
      files: result.hits.map((hit) => hit.file),
      ...(result.truncated === true && { truncated: true }),
    };
  }

  private async aboutFiles(
    workspaceRoot: string | null,
    needleLower: string,
  ): Promise<Set<string>> {
    const aboutFiles = new Set<string>();
    try {
      const { badges } = await this.opts.badges.list(workspaceRoot, { query: needleLower });
      for (const badge of badges) {
        if ((badge.description ?? '').toLowerCase().includes(needleLower)) {
          aboutFiles.add(badge.path);
        }
      }
    } catch {
      /* badge layer is best-effort for search ranking */
    }
    return aboutFiles;
  }

  private async getBadge(workspaceRoot: string | null, file: string) {
    try {
      return await this.opts.badges.get(workspaceRoot, { file, kind: 'file' });
    } catch {
      return null;
    }
  }
}

function requireWorkspaceRoot(root: string | null): string {
  if (root === null) throw new Error('No workspace bound to this search operation.');
  return root;
}

function clampPositive(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMatcher(
  needle: string,
  opts: {
    caseSensitive?: boolean | undefined;
    wholeWord?: boolean | undefined;
    regex?: boolean | undefined;
  },
): Matcher | null {
  let source = opts.regex === true ? needle : escapeRegExp(needle);
  if (opts.wholeWord === true) source = `\\b(?:${source})\\b`;
  let re: RegExp;
  try {
    re = new RegExp(source, opts.caseSensitive === true ? '' : 'i');
  } catch {
    return null;
  }
  return {
    test: (s) => re.test(s),
    firstMatch: (line) => {
      const match = re.exec(line);
      return match ? { index: match.index, length: match[0].length } : null;
    },
  };
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function snippet(line: string, matchIndex: number, matchLen: number): string {
  const trimmedStart = line.length - line.trimStart().length;
  const collapsed = line.trim();
  if (collapsed.length <= SNIPPET_MAX_CHARS) return collapsed;
  const matchInTrimmed = Math.max(0, matchIndex - trimmedStart);
  const half = Math.max(0, Math.floor((SNIPPET_MAX_CHARS - matchLen) / 2));
  let start = Math.max(0, matchInTrimmed - half);
  let end = Math.min(collapsed.length, start + SNIPPET_MAX_CHARS);
  start = Math.max(0, end - SNIPPET_MAX_CHARS);
  end = Math.min(collapsed.length, start + SNIPPET_MAX_CHARS);
  if (start > 0 && isLowSurrogate(collapsed.charCodeAt(start))) start++;
  if (end < collapsed.length && isHighSurrogate(collapsed.charCodeAt(end - 1))) end--;
  const core = collapsed.slice(start, end);
  return `${start > 0 ? '…' : ''}${core}${end < collapsed.length ? '…' : ''}`;
}
