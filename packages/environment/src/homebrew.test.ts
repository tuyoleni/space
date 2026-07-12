import { describe, expect, it } from 'vitest';
import { HOMEBREW_OFFICIAL_SITE_URL, buildHomebrewInstallStep, describeHomebrewScan, needsHomebrew } from './homebrew';

describe('buildHomebrewInstallStep (spec section 8.4)', () => {
  it('shows the official installer source and targets the Apple Silicon prefix on arm64', () => {
    const step = buildHomebrewInstallStep(0, 'arm64');
    expect(step.humanExplanation).toContain(HOMEBREW_OFFICIAL_SITE_URL);
    expect(step.humanExplanation).toContain('/opt/homebrew');
    expect(step.strategy?.officialSourceUrl).toContain('githubusercontent.com/Homebrew/install');
  });

  it('targets the Intel prefix on x64', () => {
    const step = buildHomebrewInstallStep(0, 'x64');
    expect(step.humanExplanation).toContain('/usr/local');
  });

  it('is marked interactive and elevation-requiring so prompts are never hidden (spec 8.4)', () => {
    const step = buildHomebrewInstallStep(0, 'arm64');
    expect(step.interactive).toBe(true);
    expect(step.requiresElevation).toBe(true);
    expect(step.changesMachineState).toBe(true);
  });
});

describe('needsHomebrew', () => {
  it('is true when any chosen strategy uses Homebrew', () => {
    expect(needsHomebrew([null, { packageManagerId: 'homebrew' } as never])).toBe(true);
  });

  it('is false when no strategy uses Homebrew', () => {
    expect(needsHomebrew([null, { packageManagerId: 'winget' } as never])).toBe(false);
  });
});

describe('describeHomebrewScan', () => {
  it('describes a found installation', () => {
    expect(describeHomebrewScan({ id: 'homebrew', found: true, path: '/opt/homebrew/bin/brew', version: '4.3.1' })).toContain(
      '/opt/homebrew/bin/brew',
    );
  });

  it('describes an absent installation', () => {
    expect(describeHomebrewScan(null)).toContain('not detected');
  });
});
