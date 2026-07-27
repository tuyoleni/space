import { Package } from 'lucide-react';
import {
  siAngular,
  siAnthropic,
  siAstro,
  siBabel,
  siBun,
  siClaudecode,
  siCss,
  siCursor,
  siCypress,
  siD3,
  siDeno,
  siDocker,
  siDotnet,
  siElectron,
  siEslint,
  siExpress,
  siFastify,
  siFirebase,
  siGatsby,
  siGit,
  siGithub,
  siGithubactions,
  siGo,
  siGooglecloud,
  siGooglegemini,
  siGraphql,
  siHomebrew,
  siHtml5,
  siJavascript,
  siJest,
  siKotlin,
  siMongodb,
  siNestjs,
  siNextdotjs,
  siNodedotjs,
  siNpm,
  siNuxt,
  siOpenjdk,
  siPhp,
  siPnpm,
  siPostcss,
  siPostgresql,
  siPrettier,
  siPrisma,
  siPython,
  siReact,
  siRedis,
  siRedux,
  siRemix,
  siRollupdotjs,
  siRuby,
  siRust,
  siSass,
  siSentry,
  siSocketdotio,
  siSqlite,
  siStorybook,
  siStripe,
  siSupabase,
  siSvelte,
  siSwift,
  siTailwindcss,
  siThreedotjs,
  siTurborepo,
  siTypescript,
  siVercel,
  siVite,
  siVitest,
  siVuedotjs,
  siWebpack,
  siYarn,
  siZod,
  type SimpleIcon,
} from 'simple-icons';
import type { AiToolId } from '@space/contracts';
import openaiMarkUrl from './assets/brands/openai.svg';
import visualStudioCodeMarkUrl from './assets/brands/visual-studio-code.svg';
import voltaMarkUrl from './assets/brands/volta.png';

/**
 * Every product Space names in its UI gets that product's real mark. Marks
 * come from two places, and nowhere else:
 *
 *  - the `simple-icons` package (official path data + brand hex), and
 *  - `assets/brands/`, where the three logos Simple Icons doesn't ship
 *    (VS Code, OpenAI, Volta) are downloaded and committed — see that
 *    folder's README for sources.
 *
 * No look-alike stand-ins: a product is never labelled with another
 * product's logo (VS Code used to borrow VSCodium's mark, Google Cloud
 * borrowed Google's) and never with a generic glyph (Volta used to be a
 * lightning bolt, Codex a robot). A lucide glyph appears only where there
 * is genuinely no brand — an unrecognised npm package, a script, an env
 * file — which is why `TOOL_BRAND` and friends return `null` rather than a
 * near-enough logo.
 */

/** A logo vendored as a real file under `assets/brands/`. */
export interface AssetMark {
  readonly title: string;
  readonly src: string;
}

export type BrandMark = SimpleIcon | AssetMark;

function isAssetMark(mark: BrandMark): mark is AssetMark {
  return 'src' in mark;
}

export const VISUAL_STUDIO_CODE_MARK: AssetMark = { title: 'Visual Studio Code', src: visualStudioCodeMarkUrl };
export const OPENAI_MARK: AssetMark = { title: 'OpenAI', src: openaiMarkUrl };
export const VOLTA_MARK: AssetMark = { title: 'Volta', src: voltaMarkUrl };

/**
 * Renders either kind of mark at `size` square. `monochrome` recolors the
 * mark to `currentColor` (used where a logo sits inline with text, e.g. the
 * sidebar's GitHub row); it applies to Simple Icons path marks only —
 * vendored image files are drawn in their own colors.
 */
export function BrandIcon({ icon, size = 16, monochrome = false }: { readonly icon: BrandMark; readonly size?: number; readonly monochrome?: boolean }) {
  if (isAssetMark(icon)) {
    return <img src={icon.src} alt="" role="img" aria-label={icon.title} width={size} height={size} className="shrink-0 object-contain" />;
  }
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

/** Environment/toolchain tool ids (from @space/environment's manifest) → brand mark. */
export const TOOL_BRAND: Record<string, BrandMark> = {
  node: siNodedotjs,
  npm: siNpm,
  git: siGit,
  gh: siGithub,
  homebrew: siHomebrew,
  pnpm: siPnpm,
  yarn: siYarn,
  bun: siBun,
  deno: siDeno,
  python: siPython,
  volta: VOLTA_MARK,
};

/** Connected-service ids (docker/vercel/supabase/gcloud) → brand mark. */
export const SERVICE_BRAND: Record<string, BrandMark> = {
  docker: siDocker,
  vercel: siVercel,
  supabase: siSupabase,
  gcloud: siGooglecloud,
  github: siGithub,
};

/** AI coding products. Installed apps use their native OS icon when Space can read one; this is the fallback. */
export const AI_TOOL_BRAND: Record<AiToolId, BrandMark> = {
  'claude-code': siClaudecode,
  codex: OPENAI_MARK,
  cursor: siCursor,
  vscode: VISUAL_STUDIO_CODE_MARK,
};

/** Runtime/language fact ids from @space/environment's project detection → brand mark. */
const LANGUAGE_BRAND: Record<string, BrandMark> = {
  node: siNodedotjs,
  python: siPython,
  rust: siRust,
  java: siOpenjdk,
  dotnet: siDotnet,
  go: siGo,
  ruby: siRuby,
  php: siPhp,
  kotlin: siKotlin,
  swift: siSwift,
  typescript: siTypescript,
  javascript: siJavascript,
  html: siHtml5,
  css: siCss,
};

/** Framework detection ids (`framework:next`, …) → brand mark. */
const FRAMEWORK_BRAND: Record<string, BrandMark> = {
  next: siNextdotjs,
  vite: siVite,
  svelte: siSvelte,
  nuxt: siNuxt,
  remix: siRemix,
  astro: siAstro,
  angular: siAngular,
  vue: siVuedotjs,
  gatsby: siGatsby,
  react: siReact,
  electron: siElectron,
};

/**
 * npm/Homebrew/WinGet package names → brand mark. Only names whose brand is
 * unambiguous are listed: a wrong logo is worse than the neutral package
 * glyph `PackageIcon` falls back to.
 */
const PACKAGE_BRAND: Record<string, BrandMark> = {
  node: siNodedotjs,
  npm: siNpm,
  pnpm: siPnpm,
  yarn: siYarn,
  bun: siBun,
  deno: siDeno,
  react: siReact,
  'react-dom': siReact,
  'react-redux': siRedux,
  redux: siRedux,
  '@reduxjs': siRedux,
  vue: siVuedotjs,
  svelte: siSvelte,
  angular: siAngular,
  '@angular': siAngular,
  next: siNextdotjs,
  nuxt: siNuxt,
  astro: siAstro,
  '@remix-run': siRemix,
  gatsby: siGatsby,
  electron: siElectron,
  typescript: siTypescript,
  eslint: siEslint,
  '@eslint': siEslint,
  'typescript-eslint': siEslint,
  prettier: siPrettier,
  vite: siVite,
  '@vitejs': siVite,
  vitest: siVitest,
  jest: siJest,
  cypress: siCypress,
  storybook: siStorybook,
  '@storybook': siStorybook,
  webpack: siWebpack,
  rollup: siRollupdotjs,
  babel: siBabel,
  '@babel': siBabel,
  postcss: siPostcss,
  sass: siSass,
  tailwindcss: siTailwindcss,
  '@tailwindcss': siTailwindcss,
  turbo: siTurborepo,
  '@turbo': siTurborepo,
  express: siExpress,
  fastify: siFastify,
  '@nestjs': siNestjs,
  graphql: siGraphql,
  prisma: siPrisma,
  '@prisma': siPrisma,
  mongodb: siMongodb,
  mongoose: siMongodb,
  pg: siPostgresql,
  postgres: siPostgresql,
  postgresql: siPostgresql,
  redis: siRedis,
  sqlite3: siSqlite,
  'better-sqlite3': siSqlite,
  'socket.io': siSocketdotio,
  three: siThreedotjs,
  d3: siD3,
  zod: siZod,
  stripe: siStripe,
  '@sentry': siSentry,
  firebase: siFirebase,
  '@supabase': siSupabase,
  supabase: siSupabase,
  docker: siDocker,
  vercel: siVercel,
  '@vercel': siVercel,
  '@actions': siGithubactions,
  '@anthropic-ai': siAnthropic,
  '@google': siGooglegemini,
  genai: siGooglegemini,
  git: siGit,
  gh: siGithub,
  python: siPython,
  rust: siRust,
  go: siGo,
};

/** Brand mark for a toolchain tool or connected service id, or `null` when the id has no brand. */
export function brandForToolId(toolId: string): BrandMark | null {
  return TOOL_BRAND[toolId] ?? SERVICE_BRAND[toolId] ?? LANGUAGE_BRAND[toolId] ?? null;
}

/**
 * Brand mark for a detection fact id (`framework:next`, `lockfile:pnpm`,
 * `rust`, …). Env-file and generated-directory facts have no brand and
 * return `null`.
 */
export function brandForDetectionFact(factId: string): BrandMark | null {
  const [prefix, rest] = factId.split(':', 2);
  if (rest !== undefined) {
    if (prefix === 'framework') return FRAMEWORK_BRAND[rest] ?? null;
    if (prefix === 'lockfile') return TOOL_BRAND[rest] ?? null;
    return null;
  }
  return brandForToolId(factId);
}

/**
 * Best-effort brand mark for an npm package name. The scope is stripped and
 * the base name matched against known brands (so `@types/node` → Node,
 * `eslint` → ESLint), with the scope itself as a fallback since a scoped
 * package often carries the brand there (`@google/genai` → Gemini). Returns
 * `null` when there's no confident match — the caller shows a neutral
 * package glyph rather than a wrong logo.
 */
export function brandForPackage(name: string): BrandMark | null {
  const withoutScope = name.replace(/^@[^/]+\//, '');
  const base = withoutScope.split('/')[0] ?? withoutScope;
  const scope = name.match(/^@([^/]+)\//)?.[1];
  return (
    PACKAGE_BRAND[base] ??
    (scope ? PACKAGE_BRAND[`@${scope}`] ?? PACKAGE_BRAND[scope] : undefined) ??
    // Homebrew formulae and casks are often the tools and services Space
    // already knows by id (`docker`, `gh`, `homebrew`).
    brandForToolId(base) ??
    null
  );
}

/**
 * A toolchain tool's real logo. The single definition behind every tool row
 * in the app (Home, Environment, the terminal sidebar) — the neutral package
 * glyph appears only for a tool id with no brand at all.
 */
export function ToolIcon({ toolId, size = 15 }: { readonly toolId: string; readonly size?: number }) {
  const brand = brandForToolId(toolId);
  if (brand) {
    return <BrandIcon icon={brand} size={size} />;
  }
  return <Package size={size} className="text-fg-muted" />;
}

/**
 * A package's real logo: the package's own shipped icon when Space read one
 * (Homebrew casks ship app icons), then its brand, then a neutral glyph.
 */
export function PackageIcon({ name, iconDataUrl, size = 14 }: { readonly name: string; readonly iconDataUrl?: string | null; readonly size?: number }) {
  if (iconDataUrl) {
    return <img src={iconDataUrl} alt="" className="shrink-0 rounded object-contain" style={{ width: size, height: size }} />;
  }
  const brand = brandForPackage(name);
  if (brand) {
    return <BrandIcon icon={brand} size={size} />;
  }
  return <Package size={size} className="text-fg-faint" />;
}

/** An AI tool's real logo: the installed app's own OS icon when Space read one, else the product's brand mark. */
export function AiToolIcon({ toolId, iconDataUrl, size = 14 }: { readonly toolId: AiToolId; readonly iconDataUrl?: string | null; readonly size?: number }) {
  if (iconDataUrl) {
    return <img src={iconDataUrl} alt="" className="shrink-0 rounded-[3px] object-contain" style={{ width: size, height: size }} />;
  }
  return <BrandIcon icon={AI_TOOL_BRAND[toolId]} size={size} />;
}
