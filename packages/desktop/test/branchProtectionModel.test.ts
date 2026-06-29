import { describe, expect, it } from 'vitest';
import {
  type BranchProtection,
  compileBranchProtectionModel,
  isBranchProtected,
} from '../src/workbench/contrib/scm/common/branchProtection.js';

function model(branchProtection: readonly BranchProtection[]) {
  return compileBranchProtectionModel(branchProtection);
}

describe('BranchProtectionModel', () => {
  it('protects default remote branches only with one include matcher that matches the branch name', () => {
    const defaultModel = model([{ remote: '', rules: [{ include: ['main'] }] }]);

    expect(isBranchProtected(defaultModel, { name: 'main' })).toBe(true);
    expect(isBranchProtected(defaultModel, { name: 'mainline' })).toBe(false);

    const multipleDefaultMatchers = model([
      { remote: '', rules: [{ include: ['main'] }, { include: ['release/*'] }] },
    ]);
    expect(isBranchProtected(multipleDefaultMatchers, { name: 'main' })).toBe(false);

    const defaultExcludeOnly = model([{ remote: '', rules: [{ exclude: ['main'] }] }]);
    expect(isBranchProtected(defaultExcludeOnly, { name: 'topic' })).toBe(false);
  });

  it('uses the upstream remote include and exclude matchers for contributed protection', () => {
    const remoteModel = model([
      {
        remote: 'origin',
        rules: [{ include: ['main', 'release/*'], exclude: ['release/wip'] }],
      },
    ]);

    expect(isBranchProtected(remoteModel, { name: 'main', upstream: { remote: 'origin' } })).toBe(
      true,
    );
    expect(
      isBranchProtected(remoteModel, { name: 'release/1.0', upstream: { remote: 'origin' } }),
    ).toBe(true);
    expect(
      isBranchProtected(remoteModel, { name: 'release/wip', upstream: { remote: 'origin' } }),
    ).toBe(false);
    expect(isBranchProtected(remoteModel, { name: 'topic', upstream: { remote: 'origin' } })).toBe(
      false,
    );
    expect(isBranchProtected(remoteModel, { name: 'main', upstream: { remote: 'upstream' } })).toBe(
      false,
    );
  });

  it('treats missing contributed includes as true and missing excludes as false', () => {
    const includeOnly = model([{ remote: 'origin', rules: [{ include: ['main'] }] }]);
    expect(isBranchProtected(includeOnly, { name: 'main', upstream: { remote: 'origin' } })).toBe(
      true,
    );

    const excludeOnly = model([{ remote: 'origin', rules: [{ exclude: ['wip/*'] }] }]);
    expect(
      isBranchProtected(excludeOnly, { name: 'feature/a', upstream: { remote: 'origin' } }),
    ).toBe(true);
    expect(isBranchProtected(excludeOnly, { name: 'wip/a', upstream: { remote: 'origin' } })).toBe(
      false,
    );
  });

  it('skips rules without include or exclude patterns', () => {
    const emptyRulesModel = model([
      { remote: 'origin', rules: [{}, { include: [] }, { exclude: [] }] },
    ]);

    expect(emptyRulesModel.has('origin')).toBe(false);
    expect(
      isBranchProtected(emptyRulesModel, { name: 'main', upstream: { remote: 'origin' } }),
    ).toBe(false);
  });

  it('matches exact names, single-segment globs, globstars, and single characters', () => {
    const globModel = model([
      {
        remote: 'origin',
        rules: [{ include: ['main', 'release/*', 'hotfix/**', 'qa/?'] }],
      },
    ]);

    expect(isBranchProtected(globModel, { name: 'main', upstream: { remote: 'origin' } })).toBe(
      true,
    );
    expect(
      isBranchProtected(globModel, { name: 'release/1.0', upstream: { remote: 'origin' } }),
    ).toBe(true);
    expect(
      isBranchProtected(globModel, { name: 'hotfix/urgent/main', upstream: { remote: 'origin' } }),
    ).toBe(true);
    expect(isBranchProtected(globModel, { name: 'qa/a', upstream: { remote: 'origin' } })).toBe(
      true,
    );
    expect(isBranchProtected(globModel, { name: 'mainline', upstream: { remote: 'origin' } })).toBe(
      false,
    );
    expect(
      isBranchProtected(globModel, { name: 'release/1.0/patch', upstream: { remote: 'origin' } }),
    ).toBe(false);
    expect(isBranchProtected(globModel, { name: 'qa/ab', upstream: { remote: 'origin' } })).toBe(
      false,
    );
  });

  it('returns false without a branch name, upstream remote, or matching rules', () => {
    const remoteModel = model([{ remote: 'origin', rules: [{ include: ['main'] }] }]);

    expect(isBranchProtected(remoteModel)).toBe(false);
    expect(isBranchProtected(remoteModel, {})).toBe(false);
    expect(isBranchProtected(remoteModel, { name: 'main' })).toBe(false);
    expect(isBranchProtected(remoteModel, { name: 'main', upstream: {} })).toBe(false);
    expect(isBranchProtected(remoteModel, { name: 'main', upstream: { remote: 'upstream' } })).toBe(
      false,
    );
  });
});
