import { useEffect, useState } from 'react';
import { workspaceService } from '../../../platform/workspaces/browser/workspaceService.js';
import { gitScmService } from '../../contrib/scm/browser/gitScmService.js';
import type { GitLogResult, GitRefInfo } from '../../contrib/scm/common/git.js';
import { badgeService } from '../../services/mirror/browser/badgeService.js';
import { searchService } from '../../services/search/browser/searchService.js';
import type { SearchQueryResult } from '../../services/search/common/search.js';
import type { CommandPaletteFileEntry } from './commandPaletteModel.js';

export function useCommandPaletteFiles(
  open: boolean,
  current: string | null,
): {
  files: readonly CommandPaletteFileEntry[];
  filesWorkspace: string | null;
} {
  const [files, setFiles] = useState<readonly CommandPaletteFileEntry[]>([]);
  const [filesWorkspace, setFilesWorkspace] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFiles([]);
    setFilesWorkspace(null);
    if (current === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const [files, badges] = await Promise.all([
          workspaceService.listSupportedFiles(null),
          badgeService.list(),
        ]);
        if (cancelled) return;
        const prompts = new Map(
          badges
            .filter((b) => b.description !== undefined)
            .map((b) => [b.path, b.description as string]),
        );
        setFiles(
          files.map((file) => {
            const prompt = prompts.get(file);
            return prompt !== undefined ? { file, prompt } : { file };
          }),
        );
        setFilesWorkspace(current);
      } catch {
        // Palette should still show workspaces / chrome actions on transient IO errors.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, current]);

  return { files, filesWorkspace };
}

export function useCommandPaletteContentSearch(
  open: boolean,
  current: string | null,
  query: string,
): {
  contentHits: SearchQueryResult['hits'];
  hitsQuery: string;
  hitsWorkspace: string | null;
} {
  const [contentHits, setContentHits] = useState<SearchQueryResult['hits']>([]);
  const [hitsQuery, setHitsQuery] = useState('');
  const [hitsWorkspace, setHitsWorkspace] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (current === null || q.length < 3) {
      setContentHits([]);
      setHitsQuery('');
      setHitsWorkspace(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const res = await searchService.query({
            query: q,
            maxFiles: 8,
            maxMatchesPerFile: 1,
          });
          if (cancelled) return;
          setContentHits(res.hits);
          setHitsQuery(q);
          setHitsWorkspace(current);
        } catch {
          if (!cancelled) {
            setContentHits([]);
            setHitsQuery('');
            setHitsWorkspace(null);
          }
        }
      })();
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, query, current]);

  return { contentHits, hitsQuery, hitsWorkspace };
}

export function useCommandPaletteGitState(
  open: boolean,
  current: string | null,
): {
  gitRepo: boolean;
  gitBranches: readonly GitRefInfo[];
  gitCommits: readonly GitLogResult['commits'][number][];
  gitWorkspace: string | null;
} {
  const [gitRepo, setGitRepo] = useState(false);
  const [gitBranches, setGitBranches] = useState<GitRefInfo[]>([]);
  const [gitCommits, setGitCommits] = useState<GitLogResult['commits']>([]);
  const [gitWorkspace, setGitWorkspace] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setGitRepo(false);
    setGitBranches([]);
    setGitCommits([]);
    setGitWorkspace(null);
    if (current === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const status = await gitScmService.status();
        if (cancelled) return;
        setGitRepo(status.isRepo);
        if (!status.isRepo) {
          setGitWorkspace(current);
          return;
        }
        const [branches, log] = await Promise.all([
          gitScmService.refs({ includeRemote: true }),
          gitScmService.log({ maxCount: 60 }),
        ]);
        if (cancelled) return;
        setGitBranches(
          branches.refs.filter((ref) => ref.type === 'head' || ref.type === 'remoteHead'),
        );
        setGitCommits(log.commits);
        setGitWorkspace(current);
      } catch {
        // A non-repo / transient git error just leaves the Git rows empty.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, current]);

  return { gitRepo, gitBranches, gitCommits, gitWorkspace };
}
