/**
 * Support bundle preview and export (spec 29.3: "A support bundle must
 * preview exactly what will be exported"). Local-only, no network call —
 * this module produces a plan (`previewSupportBundle`) and, only once a
 * caller has shown that exact plan to the user, applies it
 * (`exportSupportBundle`) against an injected filesystem port. Content is
 * redacted a second time at export (defence in depth on top of
 * `@space/logging`'s `createLogger` already redacting at write time) —
 * the same "redact more than once, never trust a single point" posture
 * `github-handlers.ts` and `@space/agent` already establish elsewhere in
 * this codebase.
 */
import { redactSecretPatterns } from '@space/workspace-runner';

export interface SupportBundleFileStat {
  readonly name: string;
  readonly sizeBytes: number;
}

export interface SupportBundlePreview {
  readonly files: readonly SupportBundleFileStat[];
  readonly totalBytes: number;
}

/** Pure: exactly what `exportSupportBundle` will include, for the caller to render as a real preview before the user confirms (spec 29.3). Sorted by name so the preview and the export enumerate files in the same order. */
export function previewSupportBundle(files: readonly SupportBundleFileStat[]): SupportBundlePreview {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  return { files: sorted, totalBytes: sorted.reduce((sum, file) => sum + file.sizeBytes, 0) };
}

export interface SupportBundleFs {
  readTextFile(name: string): Promise<string>;
  writeTextFile(destinationPath: string, content: string): Promise<void>;
}

export interface SupportBundleExportResult {
  readonly destinationPath: string;
  readonly fileCount: number;
  readonly totalBytes: number;
}

/**
 * Applies exactly the plan `previewSupportBundle` described — same file
 * list, same order — reads each through the injected `fs` port, redacts
 * its content again, and writes one bundle file with clear per-source
 * headers so a reader can tell where each section came from. No archive
 * library dependency: a single delimited text file is simple, diffable,
 * and sufficient for spec 29.3's requirement; nothing about the preview/
 * export contract depends on the container format.
 */
export async function exportSupportBundle(fs: SupportBundleFs, preview: SupportBundlePreview, destinationPath: string): Promise<SupportBundleExportResult> {
  const sections: string[] = [];
  for (const file of preview.files) {
    const raw = await fs.readTextFile(file.name);
    sections.push(`===== ${file.name} =====\n${redactSecretPatterns(raw)}\n`);
  }
  await fs.writeTextFile(destinationPath, sections.join('\n'));
  return { destinationPath, fileCount: preview.files.length, totalBytes: preview.totalBytes };
}
