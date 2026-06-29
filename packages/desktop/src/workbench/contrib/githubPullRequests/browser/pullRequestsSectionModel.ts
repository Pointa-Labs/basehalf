import { useCallback, useEffect, useState } from 'react';
import {
  type AuthenticationService,
  authenticationService,
} from '../../../services/authentication/browser/authenticationService.js';
import {
  GITHUB_AUTH_PROVIDER_ID,
  type PublicAuthenticationSession,
} from '../../../services/authentication/common/authentication.js';
import { useWorkspaceStore } from '../../../services/workspace/browser/workspaceStore.js';
import type { PullRequestEditorInput } from '../../../services/workspace/common/workspaceModel.js';
import { openSettings } from '../../preferences/browser/Settings.js';
import type { GhPullRequest, GithubRemoteRepository } from '../common/githubPullRequests.js';
import {
  type GithubPullRequestProvider,
  githubErrorMessage,
  githubPullRequestProvider,
} from './githubPullRequestService.js';

export interface PullRequestLoadResult {
  readonly pullRequests: GhPullRequest[];
  readonly error: string | null;
}

export interface PullRequestsSectionModel {
  readonly repository: GithubRemoteRepository | null | undefined;
  readonly login: string | null | undefined;
  readonly pullRequests: readonly GhPullRequest[] | null;
  readonly error: string | null;
  readonly open: boolean;
  readonly count: number;
  readonly toggleOpen: () => void;
  readonly openSettings: () => void;
  readonly openPullRequest: (pullRequest: GhPullRequest) => void;
}

export interface UsePullRequestsSectionModelOptions {
  readonly provider?: GithubPullRequestProvider;
  readonly authService?: AuthenticationService;
  readonly openSettingsCommand?: () => void;
  readonly openPullRequestCommand?: (pullRequest: PullRequestEditorInput) => void;
}

export async function resolvePullRequestRepository(
  provider: GithubPullRequestProvider,
): Promise<GithubRemoteRepository | null> {
  try {
    return await provider.provideRepository();
  } catch {
    return null;
  }
}

export function loginFromAuthenticationSessions(
  sessions: readonly PublicAuthenticationSession[],
): string | null {
  return sessions[0]?.account.label ?? null;
}

export function shouldLoadPullRequests(
  repository: GithubRemoteRepository | null | undefined,
  login: string | null | undefined,
  open: boolean,
): repository is GithubRemoteRepository {
  return (
    repository !== null && repository !== undefined && login !== null && login !== undefined && open
  );
}

export async function loadPullRequests(
  provider: GithubPullRequestProvider,
  remoteUrl: string,
): Promise<PullRequestLoadResult> {
  try {
    return {
      pullRequests: [...(await provider.providePullRequests(remoteUrl))],
      error: null,
    };
  } catch (err) {
    return {
      pullRequests: [],
      error: githubErrorMessage(err),
    };
  }
}

export function pullRequestEditorInput(
  repository: GithubRemoteRepository,
  pullRequest: GhPullRequest,
): PullRequestEditorInput {
  return {
    number: pullRequest.number,
    title: pullRequest.title,
    remoteUrl: repository.remoteUrl,
    url: pullRequest.url,
  };
}

export function usePullRequestsSectionModel({
  provider = githubPullRequestProvider,
  authService = authenticationService,
  openSettingsCommand = openSettings,
  openPullRequestCommand,
}: UsePullRequestsSectionModelOptions = {}): PullRequestsSectionModel {
  const [open, setOpen] = useState(true);
  const [login, setLogin] = useState<string | null | undefined>(undefined);
  const [repository, setRepository] = useState<GithubRemoteRepository | null | undefined>(
    undefined,
  );
  const [pullRequests, setPullRequests] = useState<readonly GhPullRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const storeOpenPullRequest = useWorkspaceStore((s) => s.openPr);
  const openPullRequestAction = openPullRequestCommand ?? storeOpenPullRequest;

  useEffect(() => {
    let cancelled = false;
    const refreshContext = (): void => {
      setPullRequests(null);
      setError(null);
      void (async () => {
        const [nextRepository, sessions] = await Promise.all([
          resolvePullRequestRepository(provider),
          authService.getSessions(GITHUB_AUTH_PROVIDER_ID).catch(() => []),
        ]);
        if (cancelled) return;
        setRepository(nextRepository);
        setLogin(loginFromAuthenticationSessions(sessions));
      })();
    };
    refreshContext();
    const unsubscribe = authService.onDidChangeSessions((event) => {
      if (event.providerId === GITHUB_AUTH_PROVIDER_ID) refreshContext();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [authService, provider]);

  useEffect(() => {
    if (!shouldLoadPullRequests(repository, login, open)) {
      return;
    }
    let cancelled = false;
    void (async () => {
      setError(null);
      const result = await loadPullRequests(provider, repository.remoteUrl);
      if (cancelled) return;
      setError(result.error);
      setPullRequests(result.pullRequests);
    })();
    return () => {
      cancelled = true;
    };
  }, [repository, login, open, provider]);

  const toggleOpen = useCallback(() => setOpen((value) => !value), []);
  const openPullRequest = useCallback(
    (pullRequest: GhPullRequest) => {
      if (repository === null || repository === undefined) return;
      openPullRequestAction(pullRequestEditorInput(repository, pullRequest));
    },
    [openPullRequestAction, repository],
  );

  return {
    repository,
    login,
    pullRequests,
    error,
    open,
    count: pullRequests?.length ?? 0,
    toggleOpen,
    openSettings: openSettingsCommand,
    openPullRequest,
  };
}
