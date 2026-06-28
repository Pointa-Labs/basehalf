import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from 'react';
import { parseUnifiedPatch } from '../../multiDiffEditor/browser/parseUnifiedPatch.js';
import type { DiffRow } from '../../multiDiffEditor/browser/unifiedDiffModel.js';
import type { GhPrFile, GithubReviewArgs } from '../common/githubPullRequests.js';
import { type GithubPullRequestService, githubErrorMessage } from './githubPullRequestService.js';

const GITHUB_TOP_LEVEL_ROUTES = new Set([
  'codespaces',
  'collections',
  'events',
  'features',
  'issues',
  'join',
  'login',
  'logout',
  'marketplace',
  'new',
  'notifications',
  'orgs',
  'organizations',
  'pricing',
  'pulls',
  'settings',
  'sponsors',
  'topics',
]);

export type PullRequestReviewEvent = GithubReviewArgs['event'];

export interface PullRequestReviewSubmitResult {
  readonly ok: boolean;
  readonly message: string;
}

export interface PullRequestViewModel {
  readonly files: readonly GhPrFile[] | null;
  readonly error: string | null;
  readonly selected: string | null;
  readonly setSelected: Dispatch<SetStateAction<string | null>>;
  readonly active: GhPrFile | null;
  readonly rows: readonly DiffRow[];
  readonly reviewBody: string;
  readonly setReviewBody: Dispatch<SetStateAction<string>>;
  readonly submitting: boolean;
  readonly submitReview: (event: PullRequestReviewEvent) => Promise<PullRequestReviewSubmitResult>;
}

export function selectPullRequestFile(
  files: readonly GhPrFile[] | null,
  selected: string | null,
): GhPrFile | null {
  return files?.find((file) => file.filename === selected) ?? null;
}

export function pullRequestFileRows(file: GhPrFile | null): readonly DiffRow[] {
  return file?.patch !== undefined ? parseUnifiedPatch(file.patch) : [];
}

export function reviewSuccessMessage(event: PullRequestReviewEvent): string {
  if (event === 'APPROVE') return 'Approved.';
  if (event === 'REQUEST_CHANGES') return 'Changes requested.';
  return 'Comment submitted.';
}

export function isSafePullRequestExternalUrl(value: string, number: number): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'github.com' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    return false;
  }
  const [owner, repo, kind, prNumber, extra] = parsed.pathname.split('/').filter(Boolean);
  return (
    extra === undefined &&
    isGithubOwner(owner) &&
    isGithubRepositoryName(repo) &&
    kind === 'pull' &&
    prNumber === String(number)
  );
}

export function usePullRequestViewModel({
  number,
  remoteUrl,
  service,
}: {
  readonly number: number;
  readonly remoteUrl: string;
  readonly service: GithubPullRequestService;
}): PullRequestViewModel {
  const [files, setFiles] = useState<readonly GhPrFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [reviewBody, setReviewBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setError(null);
      setFiles(null);
      setSelected(null);
      try {
        const pullRequestFiles = await service.pullRequestFiles(remoteUrl, number);
        if (cancelled) return;
        const nextFiles = [...pullRequestFiles];
        setFiles(nextFiles);
        setSelected(nextFiles[0]?.filename ?? null);
      } catch (err) {
        if (!cancelled) setError(githubErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remoteUrl, number, service]);

  const active = useMemo(() => selectPullRequestFile(files, selected), [files, selected]);
  const rows = useMemo(() => pullRequestFileRows(active), [active]);

  const submitReview = async (
    event: PullRequestReviewEvent,
  ): Promise<PullRequestReviewSubmitResult> => {
    setSubmitting(true);
    try {
      await service.reviewPullRequest({
        remoteUrl,
        number,
        event,
        body: reviewBody,
      });
      setReviewBody('');
      return { ok: true, message: reviewSuccessMessage(event) };
    } catch (err) {
      return { ok: false, message: githubErrorMessage(err) };
    } finally {
      setSubmitting(false);
    }
  };

  return {
    files,
    error,
    selected,
    setSelected,
    active,
    rows,
    reviewBody,
    setReviewBody,
    submitting,
    submitReview,
  };
}

function isGithubOwner(value: string | undefined): boolean {
  const owner = value ?? '';
  return (
    !GITHUB_TOP_LEVEL_ROUTES.has(owner.toLowerCase()) &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)
  );
}

function isGithubRepositoryName(value: string | undefined): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value ?? '');
}
