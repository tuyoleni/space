/** Spec 31.4's four recommended release channels. */
export const RELEASE_CHANNELS = ['internal', 'alpha', 'beta', 'stable'] as const;
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];
