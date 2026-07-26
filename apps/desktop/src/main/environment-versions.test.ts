import { describe, expect, it } from 'vitest';
import { homebrewFormulaForTool, resolveToolSource } from './environment-handlers';

/**
 * `brew info <name>` follows aliases without saying so, and one of those
 * aliases crosses tools: `npm` resolves to the `node` formula, because npm
 * ships inside it. That made the Environment screen offer an installed npm
 * 11.12.1 an "update" to 26.5.0 — Node's stable version, for a different
 * program. These pin the mapping that decides which formula, if any, is
 * allowed to speak for a tool's latest version.
 */
describe('homebrewFormulaForTool', () => {
  it('refuses a formula for npm, which Homebrew does not version independently', () => {
    expect(homebrewFormulaForTool('npm')).toBeNull();
  });

  it('keeps the genuine same-tool alias for python', () => {
    // Resolves to python@3.14, which really does version Python.
    expect(homebrewFormulaForTool('python')).toBe('python3');
  });

  it('defaults to the tool id for tools whose formula shares its name', () => {
    expect(homebrewFormulaForTool('git')).toBe('git');
    expect(homebrewFormulaForTool('gh')).toBe('gh');
    expect(homebrewFormulaForTool('pnpm')).toBe('pnpm');
    expect(homebrewFormulaForTool('node')).toBe('node');
  });
});

describe('resolveToolSource', () => {
  it('classifies from the real resolved path, not a manifest preference', () => {
    expect(resolveToolSource('/opt/homebrew/bin/git')).toBe('Homebrew');
    expect(resolveToolSource('/usr/local/Cellar/gh/2.96.0/bin/gh')).toBe('Homebrew');
    expect(resolveToolSource('/Users/x/.volta/bin/node')).toBe('Volta');
    expect(resolveToolSource('/Users/x/.nvm/versions/node/v20/bin/node')).toBe('nvm');
    expect(resolveToolSource('/usr/bin/python3')).toBe('System');
  });

  it('has no opinion when the tool was not found', () => {
    expect(resolveToolSource(null)).toBeNull();
  });
});
