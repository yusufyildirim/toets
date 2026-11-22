/**
 * Validates the agent skills in `skills/` and the `AGENTS.md` template:
 * - frontmatter follows the open agent skills format (https://agentskills.io/specification);
 * - bodies stay within the size budget (VISION.md > Documentation);
 * - every docs slug they mention (`concepts/focus`) resolves to a page.
 *
 *   node scripts/check-skills.ts
 */
import { existsSync, globSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const docsDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoDir = dirname(docsDir);

const MAX_BODY_LINES = 150;
const ALLOWED_KEYS = new Set([
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
]);
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG = /`((?:getting-started|concepts|guides|platforms|ci|reference)(?:\/[a-z0-9-]+)*)`/g;

/** Resolves a docs slug to its source file, or `undefined` if no page exists. */
export function resolveSlug(slug: string): string | undefined {
  const pkg = /^reference\/([a-z0-9-]+)(?:\/docs\/(.+))?$/.exec(slug);
  const candidates = pkg
    ? pkg[2]
      ? [`packages/${pkg[1]}/docs/${pkg[2]}.md`, `packages/${pkg[1]}/docs/${pkg[2]}/index.md`]
      : [`packages/${pkg[1]}/package.json`]
    : [`docs/${slug}.md`, `docs/${slug}/index.md`];
  return candidates.find((c) => existsSync(join(repoDir, c)));
}

function checkSlugs(file: string, text: string): string[] {
  return [...text.matchAll(SLUG)]
    .map((m) => m[1] ?? '')
    .filter((slug) => !resolveSlug(slug))
    .map((slug) => `${file}: docs slug \`${slug}\` has no page`);
}

function checkSkill(file: string): string[] {
  const problems: string[] = [];
  const source = readFileSync(join(repoDir, file), 'utf8');
  const { data, content } = matter(source);
  const dir = basename(dirname(file));

  for (const key of Object.keys(data)) {
    if (!ALLOWED_KEYS.has(key)) problems.push(`${file}: unknown frontmatter key \`${key}\``);
  }
  if (typeof data.name !== 'string' || !NAME.test(data.name) || data.name.length > 64) {
    problems.push(`${file}: \`name\` must be lowercase words joined by hyphens, max 64 chars`);
  } else if (data.name !== dir) {
    problems.push(`${file}: \`name\` (${data.name}) must match its folder (${dir})`);
  }
  if (typeof data.description !== 'string' || data.description.trim() === '') {
    problems.push(`${file}: \`description\` is required and must say when to use the skill`);
  } else if (data.description.length > 1024) {
    problems.push(`${file}: \`description\` is ${data.description.length} chars, max 1024`);
  }
  const lines = content.trim().split('\n').length;
  if (lines > MAX_BODY_LINES) {
    problems.push(
      `${file}: body has ${lines} lines, budget is ${MAX_BODY_LINES}; link to docs pages instead`,
    );
  }
  return [...problems, ...checkSlugs(file, content)];
}

function main(): void {
  const skills = globSync('skills/*/SKILL.md', { cwd: repoDir }).sort();
  const problems = skills.flatMap(checkSkill);

  const template = 'docs/templates/AGENTS.md';
  problems.push(...checkSlugs(template, readFileSync(join(repoDir, template), 'utf8')));

  for (const p of problems) console.error(p);
  console.log(
    `skills: ${skills.length} checked (${skills.map((s) => basename(dirname(s))).join(', ')}) | ${problems.length === 0 ? 'ok' : `${problems.length} problems`}`,
  );
  if (problems.length > 0) process.exitCode = 1;
}

main();
