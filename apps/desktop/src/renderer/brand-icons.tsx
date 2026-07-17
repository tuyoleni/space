import {
  siBun,
  siDocker,
  siEslint,
  siGit,
  siGithub,
  siGoogle,
  siHomebrew,
  siNextdotjs,
  siNodedotjs,
  siNpm,
  siPnpm,
  siPrettier,
  siPython,
  siReact,
  siSupabase,
  siTypescript,
  siVercel,
  siVite,
  siVuedotjs,
  siWebpack,
  siYarn,
  type SimpleIcon,
} from 'simple-icons';

/**
 * Real brand logos (official Simple Icons SVG paths + brand colors) for the
 * services and packages Space surfaces. Everything here is a genuine mark,
 * not a lucide stand-in; anything without a canonical Simple Icon falls back
 * to a lucide glyph at the call site (e.g. Volta, which has no brand icon).
 */
export function BrandIcon({ icon, size = 16, monochrome = false }: { readonly icon: SimpleIcon; readonly size?: number; readonly monochrome?: boolean }) {
  return (
    <svg
      role="img"
      aria-label={icon.title}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={monochrome ? 'currentColor' : `#${icon.hex}`}
      className="shrink-0"
    >
      <path d={icon.path} />
    </svg>
  );
}

/** Environment/toolchain tool ids (from @space/environment's manifest) → brand icon. */
export const TOOL_BRAND: Record<string, SimpleIcon> = {
  node: siNodedotjs,
  npm: siNpm,
  git: siGit,
  gh: siGithub,
  homebrew: siHomebrew,
  pnpm: siPnpm,
  bun: siBun,
  python: siPython,
};

/** Connected-service ids (docker/vercel/supabase/gcloud) → brand icon. */
export const SERVICE_BRAND: Record<string, SimpleIcon> = {
  docker: siDocker,
  vercel: siVercel,
  supabase: siSupabase,
  gcloud: siGoogle,
  github: siGithub,
};

/**
 * Best-effort brand icon for an npm package name. The scope is stripped and
 * the base name matched against known brands (so `@types/node` → Node,
 * `eslint` → ESLint). Returns null when there's no confident match — the
 * caller shows a neutral package glyph rather than a wrong logo.
 */
const PACKAGE_BRAND: Record<string, SimpleIcon> = {
  node: siNodedotjs,
  npm: siNpm,
  react: siReact,
  'react-dom': siReact,
  typescript: siTypescript,
  eslint: siEslint,
  prettier: siPrettier,
  vite: siVite,
  next: siNextdotjs,
  vue: siVuedotjs,
  webpack: siWebpack,
  yarn: siYarn,
  pnpm: siPnpm,
  docker: siDocker,
  google: siGoogle,
  genai: siGoogle,
};

export function brandForPackage(name: string): SimpleIcon | null {
  const withoutScope = name.replace(/^@[^/]+\//, '');
  const base = withoutScope.split('/')[0] ?? withoutScope;
  // A scoped package often carries the brand in its scope (@google/genai → google).
  const scope = name.match(/^@([^/]+)\//)?.[1];
  return PACKAGE_BRAND[base] ?? (scope ? PACKAGE_BRAND[scope] : undefined) ?? null;
}
