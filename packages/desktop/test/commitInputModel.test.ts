import { describe, expect, it } from 'vitest';
import {
  commitInputHeight,
  commitInputPlaceholder,
  nextCommitHistoryState,
  recordCommitMessage,
  validateCommitInput,
} from '../src/workbench/contrib/scm/browser/commitInputModel.js';

describe('commitInputModel', () => {
  it('formats the VS Code-style commit placeholder', () => {
    expect(commitInputPlaceholder('main', 'Cmd+Enter')).toBe(
      'Message (Cmd+Enter to commit on “main”)',
    );
    expect(commitInputPlaceholder('', 'Ctrl+Enter')).toBe('Message (Ctrl+Enter to commit)');
  });

  it('clamps editor height to the input bounds', () => {
    expect(commitInputHeight(20, 44, 204)).toBe(44);
    expect(commitInputHeight(120, 44, 204)).toBe(120);
    expect(commitInputHeight(400, 44, 204)).toBe(204);
  });

  it('walks and records commit message history', () => {
    const history = recordCommitMessage(['first', 'second'], 'first');
    expect(history).toEqual(['second', 'first']);
    expect(nextCommitHistoryState({ history, cursor: null, direction: -1 })).toEqual({
      cursor: 1,
      message: 'first',
    });
    expect(nextCommitHistoryState({ history, cursor: 1, direction: 1 })).toEqual({
      cursor: null,
      message: '',
    });
  });

  it('validates commit actions before command dispatch', () => {
    expect(validateCommitInput('', {}, true)).toBe('Please provide a commit message.');
    expect(validateCommitInput('msg', {}, false)).toBe('There are no staged changes to commit.');
    expect(validateCommitInput('msg', { amend: true }, false)).toBeNull();
  });
});
