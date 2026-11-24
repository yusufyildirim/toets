/**
 * Generates the error code index (`packages/core/docs/errors.md`) from the package sources, so
 * agents can look up any `ToetsError` code, offline too. Usage:
 *
 *   node scripts/error-codes.ts           # rewrite the page
 *   node scripts/error-codes.ts --check   # fail when the page is out of date
 *
 * Codes come from `new ToetsError(...)` / `new ProtocolError(...)` and driver error helpers
 * (resolved through the type checker, so `MockErrorCode.UNHANDLED` counts), plus every member of
 * an exported `*ErrorCode` type. The meaning is the code's doc comment, else the thrown message.
 */
import { existsSync, globSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import ts from 'typescript';

const docsDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoDir = dirname(docsDir);
export const PAGE = 'packages/core/docs/errors.md';

/** Functions that build a `ToetsError` from a code passed as their first argument. */
const FACTORIES = new Set(['ToetsError', 'ProtocolError', 'androidError', 'tvosError']);
const CODE = /^(?:[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|sdk\.[a-z-]+)$/;
const ELLIPSIS = '…';

/**
 * Meanings for codes thrown from several places with different messages, where no single
 * message describes the code. Prefer a doc comment on a `*ErrorCode` type in the source.
 */
const MEANINGS: Readonly<Record<string, string>> = {
  CAPABILITY_MISSING:
    'The action or assertion needs a capability this target does not have (driver, SDK domain or mock server).',
  INVALID_ARGUMENT:
    'An API received an invalid argument, such as a value that is not a toets Locator or a negative count.',
  INVALID_SUBJECT: 'A matcher received a subject it does not support.',
  KEY_UNSUPPORTED: "The platform's remote has no such key, or cannot hold keys.",
  STRICT_MODE_VIOLATION: 'A locator matched several elements where exactly one is needed.',
  ELEMENT_NOT_FOUND: 'A locator matched no element within the timeout.',
  ELEMENT_DETACHED: 'The element a locator resolved to left the screen before it could be read.',
  DRIVER_CONTRACT: 'A driver returned something that breaks the `Driver` contract (a driver bug).',
  INVALID_DRIVER: 'The configured driver module does not default-export a matching `DriverModule`.',
  NO_MANAGED_DEVICES: 'The driver cannot manage devices for this platform.',
  NO_DEVICES: 'No device addresses were configured for `external` devices.',
  NOT_ENOUGH_DEVICES: 'There are fewer `external` devices than workers.',
  DEVICE_COMMAND_FAILED: 'A `command` device provider command failed.',
  NEGATION_UNSUPPORTED: 'The matcher cannot be negated with `.not`.',
  WEB_INVALID_CONFIG:
    'The web app config or `webDriver()` options are malformed (`url`, `keys`, ...).',
  FOCUS_UNREACHABLE:
    '`pressUntil` or `navigateTo` gave up: `maxPresses` presses, or no direction left to try.',
  NO_FOCUS: 'Nothing holds focus, before moving focus or after a press.',
  FOCUS_STUCK: '`pressUntil`: a press did not move focus within `navigationSettleMs`.',
  FOCUS_LOOP: '`pressUntil`: focus came back to an element it already left (a wrap-around).',
  TVOS_DEVICE_TYPE_MISSING:
    'The requested Apple TV device type is not available for the tvOS runtime.',
};

export interface ErrorCodeInfo {
  readonly code: string;
  readonly packages: readonly string[];
  readonly meaning: string;
  /** Docs paths the error links to (`reference/core/docs/locators`, `concepts/focus`). */
  readonly docs: readonly string[];
}

interface Site {
  readonly pkg: string;
  readonly file: string;
  readonly message: string | undefined;
  readonly docs: string | undefined;
}

/** Collects every error code in `packages/*\/src`, sorted by package, then code. */
export function collectErrorCodes(): ErrorCodeInfo[] {
  const files = globSync('packages/*/src/**/*.ts', {
    cwd: repoDir,
    // Test doubles (`src/testing`) throw codes of their own making.
    exclude: ['**/*.test.ts', '**/node_modules/**', 'packages/*/src/testing/**'],
  }).map((f) => join(repoDir, f));
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2024,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    customConditions: ['@toets/source'],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: ['node'],
    typeRoots: [join(docsDir, 'node_modules/@types')],
  });
  const checker = program.getTypeChecker();
  const sites = new Map<string, Site[]>();
  const declared = new Map<string, { pkg: string; meaning: string | undefined }>();

  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) continue;
    const pkg = /packages\/([^/]+)\//.exec(relative(repoDir, file))?.[1] ?? '';
    const visit = (node: ts.Node): void => {
      const call = ts.isNewExpression(node) || ts.isCallExpression(node) ? node : undefined;
      const callee = call && ts.isIdentifier(call.expression) ? call.expression.text : undefined;
      if (call && callee && FACTORIES.has(callee) && call.arguments?.[0]) {
        const [codeArg, messageArg, optsArg] = call.arguments;
        for (const code of literalValues(checker, codeArg)) {
          const list = sites.get(code) ?? [];
          list.push({
            pkg,
            file: relative(repoDir, file),
            message: messageArg ? renderText(messageArg) : undefined,
            docs: optsArg ? docsOf(checker, optsArg) : undefined,
          });
          sites.set(code, list);
        }
      }
      if (
        (ts.isTypeAliasDeclaration(node) || ts.isVariableDeclaration(node)) &&
        ts.isIdentifier(node.name) &&
        node.name.text.endsWith('ErrorCode')
      ) {
        for (const [code, meaning] of declaredCodes(checker, node)) {
          if (!declared.has(code)) declared.set(code, { pkg, meaning });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  const codes = new Set([...sites.keys(), ...declared.keys()]);
  const out: ErrorCodeInfo[] = [];
  for (const code of codes) {
    const at = (sites.get(code) ?? []).sort((a, b) => a.file.localeCompare(b.file));
    const decl = declared.get(code);
    const message = at.map((s) => s.message).find(isMeaningful);
    out.push({
      code,
      packages: [...new Set([...(decl ? [decl.pkg] : []), ...at.map((s) => s.pkg)])],
      meaning: MEANINGS[code] ?? decl?.meaning ?? (message ? firstSentence(message) : ''),
      docs: [...new Set(at.map((s) => s.docs).filter((d): d is string => d !== undefined))],
    });
  }
  return out.sort(
    (a, b) =>
      packageOrder(a.packages[0]) - packageOrder(b.packages[0]) ||
      (a.packages[0] ?? '').localeCompare(b.packages[0] ?? '') ||
      a.code.localeCompare(b.code),
  );
}

/**
 * The code an expression stands for, from its type: a literal (`'X'`, `MockErrorCode.X`). Codes
 * passed through as a variable (a union type) are counted where they are declared instead.
 */
function literalValues(checker: ts.TypeChecker, node: ts.Expression): string[] {
  const type = checker.getTypeAtLocation(node);
  return type.isStringLiteral() && CODE.test(type.value) ? [type.value] : [];
}

/** Codes of a `*ErrorCode` union type or `as const` object, with their doc comments. */
function declaredCodes(
  checker: ts.TypeChecker,
  node: ts.TypeAliasDeclaration | ts.VariableDeclaration,
): [string, string | undefined][] {
  if (ts.isTypeAliasDeclaration(node) && ts.isUnionTypeNode(node.type)) {
    const text = node.getSourceFile().getFullText();
    let from = node.type.pos;
    return node.type.types.flatMap((member): [string, string | undefined][] => {
      const before = text.slice(from, member.getStart());
      from = member.end;
      if (!ts.isLiteralTypeNode(member) || !ts.isStringLiteral(member.literal)) return [];
      return [[member.literal.text, docComment(before)]];
    });
  }
  if (ts.isVariableDeclaration(node) && node.initializer) {
    const init = ts.isAsExpression(node.initializer)
      ? node.initializer.expression
      : node.initializer;
    if (!ts.isObjectLiteralExpression(init)) return [];
    return init.properties.flatMap((p): [string, string | undefined][] => {
      if (!ts.isPropertyAssignment(p) || !ts.isStringLiteral(p.initializer)) return [];
      const doc = ts.displayPartsToString(
        checker.getSymbolAtLocation(p.name)?.getDocumentationComment(checker),
      );
      return [[p.initializer.text, doc || undefined]];
    });
  }
  return [];
}

/** Text of the last doc comment in `text`, on one line. */
function docComment(text: string): string | undefined {
  const doc = [...text.matchAll(/\/\*\*([\s\S]*?)\*\//g)].at(-1)?.[1];
  return doc
    ?.replace(/^\s*\* ?/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Literal text of a message expression, with interpolations shown as `...`. */
function renderText(node: ts.Expression): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((s) => ELLIPSIS + s.literal.text).join('');
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return renderText(node.left) + renderText(node.right);
  }
  if (ts.isParenthesizedExpression(node)) return renderText(node.expression);
  if (ts.isConditionalExpression(node)) {
    const whenTrue = renderText(node.whenTrue);
    return isMeaningful(whenTrue) ? whenTrue : renderText(node.whenFalse);
  }
  return ELLIPSIS;
}

/** At least two words of literal text. */
function isMeaningful(message: string | undefined): message is string {
  return (message?.replaceAll(ELLIPSIS, ' ').match(/[a-zA-Z]{2,}/g)?.length ?? 0) >= 2;
}

/** The first sentence, without a trailing interpolated detail (`failed: …`, `(exit …`). */
function firstSentence(message: string): string {
  let line = (message.split('\n')[0] ?? '')
    .trim()
    .replace(/…+/g, '…')
    .replace(/\.…/g, '.')
    .replace(/(\S)…(?=\s*\(|$)/g, '$1');
  const end = line.search(/\.(\s|$)/);
  if (end !== -1) line = line.slice(0, end + 1);
  line = line
    .replace(/:\s*\S*…\S*\.?$/, '')
    .replace(/\s*\([^)]*$/, '')
    .replace(/[.:]$/, '');
  return `${line}.`;
}

/** The `docs` option of an error, evaluated: `packageDocsLink`, `docsLink`, constants. */
function docsOf(checker: ts.TypeChecker, opts: ts.Expression): string | undefined {
  if (!ts.isObjectLiteralExpression(opts)) return undefined;
  for (const p of opts.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText() === 'docs') {
      return evaluateDocs(checker, p.initializer);
    }
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === 'docs') {
      return evaluateDocs(checker, p.name);
    }
  }
  return undefined;
}

function evaluateDocs(checker: ts.TypeChecker, node: ts.Expression, depth = 0): string | undefined {
  if (depth > 5) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const args = node.arguments.map((a) =>
      ts.isStringLiteral(a) ? a.text : evaluateDocs(checker, a, depth + 1),
    );
    if (args.some((a) => a === undefined)) return undefined;
    if (node.expression.text === 'packageDocsLink') return `reference/${args[0]}/docs/${args[1]}`;
    if (node.expression.text === 'docsLink') return args[0];
    return undefined;
  }
  if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
    const symbol =
      ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent)
        ? checker.getShorthandAssignmentValueSymbol(node.parent)
        : checker.getSymbolAtLocation(ts.isIdentifier(node) ? node : node.name);
    const target =
      symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const decl = target?.valueDeclaration;
    if (decl && (ts.isVariableDeclaration(decl) || ts.isPropertyAssignment(decl))) {
      const init = decl.initializer;
      if (init) return evaluateDocs(checker, init, depth + 1);
    }
  }
  return undefined;
}

const ORDER = [
  'core',
  'test',
  'driver-web',
  'driver-android-tv',
  'driver-tvos',
  'mock',
  'protocol',
];
const packageOrder = (pkg: string | undefined): number => {
  const i = ORDER.indexOf(pkg ?? '');
  return i === -1 ? ORDER.length : i;
};

/** A markdown link to a docs path, relative to the core package's docs folder. */
function docsLinkFrom(path: string): string {
  const pkg = /^reference\/([^/]+)\/docs\/(.+)$/.exec(path);
  if (!pkg) return `\`${path}\``;
  const [, name, page] = pkg;
  const target = name === 'core' ? `./${page}.md` : `../../${name}/docs/${page}.md`;
  return `[${name === 'core' ? page : `${name}/${page}`}](${target})`;
}

const escapeCell = (text: string): string => text.replaceAll('|', '\\|');

/** The page, formatted like the rest of the repository. */
export async function renderPage(codes: readonly ErrorCodeInfo[]): Promise<string> {
  const groups = new Map<string, ErrorCodeInfo[]>();
  for (const c of codes) {
    const pkg = c.packages[0] ?? 'core';
    groups.set(pkg, [...(groups.get(pkg) ?? []), c]);
  }
  const lines = [
    '---',
    'description: Every ToetsError code, what it means and the page to read, generated from the toets sources.',
    'order: 100',
    '---',
    '',
    '# Error codes',
    '',
    '<!-- Generated by docs/scripts/error-codes.ts from the package sources. Do not edit; run `pnpm --filter @toets/docs errors`. -->',
    '',
    'Every toets error has a stable `code`. In test output it reads `ToetsError: [CODE] message`, followed by `Hint:` (likely cause and fix) and `Docs:` (the page to read). Act on the hint first; branch on the code, never on the message.',
    '',
    'A `Docs:` path of the form `reference/<package>/docs/<page>` ships with that package at `node_modules/@toets/<package>/docs/<page>.md`; other paths (`concepts/focus`) are pages of the docs site.',
    '',
    'Codes from the SDK host (`sdk.*`) surface as `ToetsError` with the same code.',
  ];
  for (const [pkg, list] of groups) {
    lines.push('', `## @toets/${pkg}`, '', '| Code | Meaning | Docs |', '| --- | --- | --- |');
    for (const c of list) {
      const also = c.packages.slice(1).map((p) => `@toets/${p}`);
      const meaning = escapeCell(c.meaning) + (also.length ? ` Also in ${also.join(', ')}.` : '');
      lines.push(`| \`${c.code}\` | ${meaning} | ${c.docs.map(docsLinkFrom).join(', ')} |`);
    }
  }
  const options = await prettier.resolveConfig(join(repoDir, PAGE));
  return prettier.format(lines.join('\n') + '\n', { ...options, parser: 'markdown' });
}

/** Whether a docs path names a page (see the rewrites in `.vitepress/config.ts`). */
function pageExists(path: string): boolean {
  const pkg = /^reference\/([^/]+)\/docs\/(.+)$/.exec(path);
  const candidates = pkg
    ? [`packages/${pkg[1]}/docs/${pkg[2]}.md`]
    : [`docs/${path}.md`, `docs/${path}/index.md`];
  return candidates.some((file) => existsSync(join(repoDir, file)));
}

async function main(): Promise<void> {
  const codes = collectErrorCodes();
  const missing = codes.filter((c) => !c.meaning).map((c) => c.code);
  if (missing.length) {
    console.error(
      `errors: no meaning for ${missing.join(', ')}; give the code a doc comment or a descriptive message`,
    );
    process.exitCode = 1;
    return;
  }
  const broken = codes.flatMap((c) =>
    c.docs.filter((d) => !pageExists(d)).map((d) => `${c.code} links to ${d}, which has no page`),
  );
  if (broken.length) {
    for (const b of broken) console.error(`errors: ${b}`);
    process.exitCode = 1;
    return;
  }
  const page = await renderPage(codes);
  const file = join(repoDir, PAGE);
  if (process.argv.includes('--check')) {
    const current = readFileSync(file, 'utf8');
    if (current !== page) {
      console.error(`errors: ${PAGE} is out of date; run \`pnpm --filter @toets/docs errors\``);
      process.exitCode = 1;
      return;
    }
  } else {
    writeFileSync(file, page);
  }
  console.log(`errors: ${codes.length} codes | ok`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
