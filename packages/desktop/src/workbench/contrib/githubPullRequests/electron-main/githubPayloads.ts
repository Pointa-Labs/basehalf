import type { GithubReviewArgs } from '../common/githubPullRequests.js';

export function parsePrPayload(payload: unknown): { remoteUrl: string; number: number } {
  if (typeof payload !== 'object' || payload === null) throw new Error('Invalid pull request.');
  const p = payload as { remoteUrl?: unknown; number?: unknown };
  if (typeof p.remoteUrl !== 'string') throw new Error('Invalid GitHub remote URL.');
  if (!Number.isInteger(p.number) || (p.number as number) <= 0) {
    throw new Error('Invalid pull request number.');
  }
  return { remoteUrl: p.remoteUrl, number: p.number as number };
}

export function parseReviewArgs(payload: unknown): GithubReviewArgs {
  const { remoteUrl, number } = parsePrPayload(payload);
  const p = payload as { event?: unknown; body?: unknown };
  if (p.event !== 'APPROVE' && p.event !== 'REQUEST_CHANGES' && p.event !== 'COMMENT') {
    throw new Error('Invalid review event.');
  }
  return {
    remoteUrl,
    number,
    event: p.event,
    ...(typeof p.body === 'string' && { body: p.body }),
  };
}
