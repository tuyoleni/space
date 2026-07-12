/**
 * PRJ-002: project detection (spec section 10.2).
 *
 * Read-only. Produces confidence-scored facts rather than one irreversible
 * label — a project can legitimately show `node` + `python` facts at once
 * (a monorepo, or a Node app with Python tooling), and the caller decides
 * what to do with that rather than the detector picking a single "type".
 *
 * Every filesystem touch goes through the injected `ProjectDetectionFsPort`
 * (spec section 33: DI for filesystem access so this is unit-testable
 * without touching a real directory). Detection reads directory listings
 * and manifest file *contents* it needs to parse (package.json) but MUST
 * NOT read the contents of files it only reports by name — env files in
 * particular are reported by name only, never opened, so a secret value
 * can never end up in a detection fact or downstream telemetry.
 */

export interface ProjectDetectionFsPort {
  /** Returns entry names (not full paths) directly inside `targetPath`, or `[]` if unreadable. */
  listDirectory(targetPath: string): Promise<readonly string[]>;
  readTextFile(targetPath: string): Promise<string | null>;
}

export type DetectionCategory =
  | 'vcs'
  | 'runtime'
  | 'package-manager'
  | 'framework'
  | 'language'
  | 'env-file'
  | 'generated-directory';

export interface DetectionFact {
  readonly category: DetectionCategory;
  /** Stable machine id, e.g. 'git', 'node', 'lockfile:pnpm', 'framework:next'. */
  readonly id: string;
  readonly label: string;
  /** 0 (weak signal) to 1 (certain). */
  readonly confidence: number;
  readonly evidence: string;
}

export interface ProjectDetectionReport {
  readonly canonicalPath: string;
  readonly detectedAt: string;
  readonly facts: readonly DetectionFact[];
}

const LOCKFILE_FACTS: ReadonlyArray<{ file: string; id: string; label: string }> = [
  { file: 'package-lock.json', id: 'lockfile:npm', label: 'npm lockfile' },
  { file: 'npm-shrinkwrap.json', id: 'lockfile:npm', label: 'npm shrinkwrap lockfile' },
  { file: 'yarn.lock', id: 'lockfile:yarn', label: 'Yarn lockfile' },
  { file: 'pnpm-lock.yaml', id: 'lockfile:pnpm', label: 'pnpm lockfile' },
];

const FRAMEWORK_CONFIG_FILES: ReadonlyArray<{ file: string; id: string; label: string }> = [
  { file: 'next.config.js', id: 'framework:next', label: 'Next.js' },
  { file: 'next.config.mjs', id: 'framework:next', label: 'Next.js' },
  { file: 'next.config.ts', id: 'framework:next', label: 'Next.js' },
  { file: 'vite.config.js', id: 'framework:vite', label: 'Vite' },
  { file: 'vite.config.ts', id: 'framework:vite', label: 'Vite' },
  { file: 'svelte.config.js', id: 'framework:svelte', label: 'SvelteKit' },
  { file: 'nuxt.config.js', id: 'framework:nuxt', label: 'Nuxt' },
  { file: 'nuxt.config.ts', id: 'framework:nuxt', label: 'Nuxt' },
  { file: 'remix.config.js', id: 'framework:remix', label: 'Remix' },
  { file: 'astro.config.mjs', id: 'framework:astro', label: 'Astro' },
  { file: 'angular.json', id: 'framework:angular', label: 'Angular' },
  { file: 'vue.config.js', id: 'framework:vue', label: 'Vue CLI' },
  { file: 'gatsby-config.js', id: 'framework:gatsby', label: 'Gatsby' },
];

const PACKAGE_JSON_DEPENDENCY_FRAMEWORKS: ReadonlyArray<{ dependency: string; id: string; label: string }> = [
  { dependency: 'next', id: 'framework:next', label: 'Next.js' },
  { dependency: 'vite', id: 'framework:vite', label: 'Vite' },
  { dependency: 'svelte', id: 'framework:svelte', label: 'Svelte' },
  { dependency: 'nuxt', id: 'framework:nuxt', label: 'Nuxt' },
  { dependency: '@remix-run/react', id: 'framework:remix', label: 'Remix' },
  { dependency: 'astro', id: 'framework:astro', label: 'Astro' },
  { dependency: '@angular/core', id: 'framework:angular', label: 'Angular' },
  { dependency: 'vue', id: 'framework:vue', label: 'Vue' },
  { dependency: 'gatsby', id: 'framework:gatsby', label: 'Gatsby' },
  { dependency: 'react', id: 'framework:react', label: 'React' },
  { dependency: 'electron', id: 'framework:electron', label: 'Electron' },
];

const PYTHON_MANIFESTS = ['pyproject.toml', 'requirements.txt', 'Pipfile', 'setup.py', 'setup.cfg'];
const JAVA_MANIFESTS = ['pom.xml', 'build.gradle', 'build.gradle.kts'];
const DOTNET_EXTENSIONS = ['.csproj', '.sln', '.fsproj'];

/**
 * Reported by name only (spec 10.2: "Environment-file names without
 * reading secret values into telemetry"). Never passed to `readTextFile`.
 */
const ENV_FILE_NAMES = ['.env', '.env.local', '.env.development', '.env.production', '.env.test', '.env.example'];

const GENERATED_DIRECTORIES = [
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'target',
  'bin',
  'obj',
  '.venv',
  'venv',
  '__pycache__',
  '.turbo',
  '.cache',
];

interface PackageJsonShape {
  readonly volta?: unknown;
  readonly dependencies?: Record<string, unknown>;
  readonly devDependencies?: Record<string, unknown>;
}

function safeParsePackageJson(raw: string): PackageJsonShape | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object') {
      return parsed as PackageJsonShape;
    }
    return null;
  } catch {
    return null;
  }
}

/** Read-only detector: inspects known indicators and emits confidence-scored facts (PRJ-002). */
export async function detectProject(
  canonicalPath: string,
  fs: ProjectDetectionFsPort,
): Promise<ProjectDetectionReport> {
  const facts: DetectionFact[] = [];
  const rootEntries = new Set(await fs.listDirectory(canonicalPath));

  if (rootEntries.has('.git')) {
    facts.push({
      category: 'vcs',
      id: 'git',
      label: 'Git repository',
      confidence: 1,
      evidence: '.git found at project root',
    });
  }

  if (rootEntries.has('package.json')) {
    facts.push({
      category: 'runtime',
      id: 'node',
      label: 'Node.js project',
      confidence: 0.9,
      evidence: 'package.json found at project root',
    });

    const raw = await fs.readTextFile(`${canonicalPath}/package.json`);
    const parsed = raw ? safeParsePackageJson(raw) : null;
    if (parsed?.volta !== undefined) {
      facts.push({
        category: 'runtime',
        id: 'volta',
        label: 'Volta-pinned toolchain',
        confidence: 1,
        evidence: 'package.json has a "volta" field',
      });
    }
    if (parsed) {
      const deps = { ...parsed.dependencies, ...parsed.devDependencies };
      for (const candidate of PACKAGE_JSON_DEPENDENCY_FRAMEWORKS) {
        if (candidate.dependency in deps) {
          facts.push({
            category: 'framework',
            id: candidate.id,
            label: candidate.label,
            confidence: 0.7,
            evidence: `package.json dependencies include "${candidate.dependency}"`,
          });
        }
      }
    }
  }

  for (const candidate of LOCKFILE_FACTS) {
    if (rootEntries.has(candidate.file)) {
      facts.push({
        category: 'package-manager',
        id: candidate.id,
        label: candidate.label,
        confidence: 1,
        evidence: `${candidate.file} found at project root`,
      });
    }
  }

  for (const candidate of FRAMEWORK_CONFIG_FILES) {
    if (rootEntries.has(candidate.file)) {
      facts.push({
        category: 'framework',
        id: candidate.id,
        label: candidate.label,
        confidence: 0.95,
        evidence: `${candidate.file} found at project root`,
      });
    }
  }

  if (PYTHON_MANIFESTS.some((file) => rootEntries.has(file))) {
    const found = PYTHON_MANIFESTS.filter((file) => rootEntries.has(file));
    facts.push({
      category: 'language',
      id: 'python',
      label: 'Python project',
      confidence: 0.85,
      evidence: `${found.join(', ')} found at project root`,
    });
  }

  if (rootEntries.has('Cargo.toml')) {
    facts.push({
      category: 'language',
      id: 'rust',
      label: 'Rust project',
      confidence: 0.95,
      evidence: 'Cargo.toml found at project root',
    });
  }

  const foundJavaManifests = JAVA_MANIFESTS.filter((file) => rootEntries.has(file));
  if (foundJavaManifests.length > 0) {
    facts.push({
      category: 'language',
      id: 'java',
      label: 'Java project',
      confidence: 0.9,
      evidence: `${foundJavaManifests.join(', ')} found at project root`,
    });
  }

  const dotnetEntries = [...rootEntries].filter((entry) =>
    DOTNET_EXTENSIONS.some((extension) => entry.endsWith(extension)),
  );
  if (dotnetEntries.length > 0) {
    facts.push({
      category: 'language',
      id: 'dotnet',
      label: '.NET project',
      confidence: 0.9,
      evidence: `${dotnetEntries.join(', ')} found at project root`,
    });
  }

  for (const name of ENV_FILE_NAMES) {
    if (rootEntries.has(name)) {
      facts.push({
        category: 'env-file',
        id: `env-file:${name}`,
        label: name,
        confidence: 1,
        evidence: `"${name}" present (name only — contents were not read)`,
      });
    }
  }

  for (const dir of GENERATED_DIRECTORIES) {
    if (rootEntries.has(dir)) {
      facts.push({
        category: 'generated-directory',
        id: `generated:${dir}`,
        label: dir,
        confidence: 1,
        evidence: `"${dir}" present at project root`,
      });
    }
  }

  return {
    canonicalPath,
    detectedAt: new Date().toISOString(),
    facts,
  };
}

/**
 * Convenience projection for legacy `detectedTypes: string[]` consumers
 * (spec section 23.2.2's `detected_type_json` column predates confidence
 * scoring). Only high-confidence runtime/language facts are collapsed into
 * this list; the full `ProjectDetectionReport` is the source of truth.
 */
export function detectedTypesFromReport(report: ProjectDetectionReport): string[] {
  const typeIds = new Set(['node', 'python', 'rust', 'java', 'dotnet']);
  return report.facts
    .filter((fact) => (fact.category === 'runtime' || fact.category === 'language') && typeIds.has(fact.id))
    .filter((fact) => fact.confidence >= 0.7)
    .map((fact) => fact.id);
}
