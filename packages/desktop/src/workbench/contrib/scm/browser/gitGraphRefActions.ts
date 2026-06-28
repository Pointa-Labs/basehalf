import type { ContextMenuItem } from '../../../browser/parts/contextmenu/contextMenuStore.js';
import type { GitGraphActionDeps } from './gitGraphActionTypes.js';
import type { FullGraphRefKind } from './gitGraphViewModel.js';

export function fullGraphRefMenu(
  ref: { readonly name: string; readonly kind: FullGraphRefKind; readonly targetRef?: string },
  deps: GitGraphActionDeps,
): ContextMenuItem[] {
  const { name, kind } = ref;
  const targetRef = ref.targetRef ?? defaultTargetRef(name, kind);
  if (kind === 'tag') {
    return [
      {
        id: 'checkout',
        label: `Checkout tag ${name}`,
        run: () => deps.runGit(() => deps.git.checkout(targetRef)),
      },
      {
        id: 'delete',
        label: 'Delete Tag',
        danger: true,
        run: () =>
          void deps
            .confirm({
              title: `Delete tag ${name}?`,
              confirmText: 'Delete',
              destructive: true,
            })
            .then((ok) => {
              if (ok) deps.runGit(() => deps.git.tagDelete(name));
            }),
      },
    ];
  }

  const items: ContextMenuItem[] = [
    {
      id: 'checkout',
      label: `Checkout ${name}`,
      run: () =>
        deps.runGit(() =>
          deps.git.checkout(
            kind === 'remote' ? targetRef : name,
            kind === 'remote' ? { track: true } : {},
          ),
        ),
    },
    {
      id: 'merge',
      label: 'Merge into Current Branch',
      run: () =>
        deps.runGit(async () => {
          const result = await deps.git.merge(targetRef);
          if (result.conflicts)
            deps.toastError('The merge hit conflicts — resolve them in Merge Changes.');
        }),
    },
  ];

  if (kind === 'branch') {
    items.push(
      {
        id: 'rename',
        label: 'Rename Branch…',
        run: () =>
          void deps
            .prompt({ title: `Rename ${name}`, label: 'New name', defaultValue: name })
            .then((value) => {
              const to = value?.trim();
              if (to && to !== name) deps.runGit(() => deps.git.renameBranch(name, to));
            }),
      },
      { separator: true },
      {
        id: 'delete',
        label: 'Delete Branch',
        danger: true,
        run: () =>
          void deps
            .confirm({
              title: `Delete branch ${name}?`,
              confirmText: 'Delete',
              destructive: true,
            })
            .then((ok) => {
              if (!ok) return;
              deps.runGit(async () => {
                try {
                  await deps.git.deleteBranch(name);
                } catch {
                  if (
                    await deps.confirm({
                      title: `Branch ${name} is not fully merged. Force delete?`,
                      confirmText: 'Force Delete',
                      destructive: true,
                    })
                  ) {
                    await deps.git.deleteBranch(name, { force: true });
                  }
                }
              });
            }),
      },
    );
  }

  return items;
}

function defaultTargetRef(name: string, kind: FullGraphRefKind): string {
  if (name.startsWith('refs/')) return name;
  if (kind === 'branch') return `refs/heads/${name}`;
  if (kind === 'remote') return `refs/remotes/${name}`;
  return `refs/tags/${name}`;
}
