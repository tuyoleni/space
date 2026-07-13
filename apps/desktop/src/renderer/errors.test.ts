import { describe, expect, it } from 'vitest';
import { toErrorMessage } from './errors';

describe('toErrorMessage', () => {
  it('strips the "Error invoking remote method" IPC wrapper and the duplicated inner "Error:" prefix', () => {
    // The exact shape reported: a real `git clone` against a nonexistent
    // GitHub repo, surfaced through ipcRenderer.invoke's error wrapping.
    const caught = new Error(
      "Error invoking remote method 'project:clone': Error: git clone failed: Cloning into '/tmp/x'...\n" +
        'remote: Repository not found.\n' +
        "fatal: repository 'https://github.com/nobody/nowhere.git' not found",
    );

    expect(toErrorMessage(caught)).toBe(
      "git clone failed: Cloning into '/tmp/x'...\n" +
        'remote: Repository not found.\n' +
        "fatal: repository 'https://github.com/nobody/nowhere.git' not found",
    );
  });

  it('leaves a plain error message untouched', () => {
    expect(toErrorMessage(new Error('"foo" already exists'))).toBe('"foo" already exists');
  });

  it('handles a non-Error thrown value', () => {
    expect(toErrorMessage('just a string')).toBe('just a string');
  });

  it('does not strip legitimate content that merely starts with the word Error mid-sentence', () => {
    // e.g. a message that is itself informative and does not have the IPC
    // wrapper prefix at all should pass through unchanged.
    expect(toErrorMessage(new Error('ErrorCode 42: disk full'))).toBe('ErrorCode 42: disk full');
  });
});
