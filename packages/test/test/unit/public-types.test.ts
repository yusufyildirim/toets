import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, '../..');
const packagesDir = resolve(packageDir, '..');

/** Public names whose types a user writes in a toets config. */
const CONFIG_ROOTS = [
  'defineConfig',
  'platforms',
  'ToetsConfig',
  'ToetsOptions',
  'AppTargets',
  'PlatformProjectOptions',
  'ParityReporterOptions',
];

function createProgram(entry: string): ts.Program {
  const configFile = ts.findConfigFile(packageDir, ts.sys.fileExists, 'tsconfig.json');
  if (!configFile) throw new Error('tsconfig.json not found');
  const { config } = ts.readConfigFile(configFile, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, packageDir);
  return ts.createProgram([entry], { ...parsed.options, noEmit: true });
}

/** Declared in a workspace package's sources (not Playwright, Node or the TS lib). */
function isToetsDeclaration(decl: ts.Declaration): boolean {
  const file = decl.getSourceFile().fileName.split('/').join(sep);
  return file.startsWith(packagesDir + sep) && file.includes(`${sep}src${sep}`);
}

/**
 * Named toets types a user may write when typing or factoring a config: every interface, class,
 * enum and type alias reachable from the roots through properties, type arguments and aliases.
 * Behavioral types met in a callback signature (e.g. a custom `createHost` returning `SdkHost`)
 * count, but their own members do not: implementing one is that package's business.
 */
function reachableNamedTypes(checker: ts.TypeChecker, roots: readonly ts.Symbol[]): ts.Symbol[] {
  const named = new Set<ts.Symbol>();
  const seen = new Set<ts.Type>();
  const NAMED =
    ts.SymbolFlags.Interface |
    ts.SymbolFlags.Class |
    ts.SymbolFlags.Enum |
    ts.SymbolFlags.TypeAlias;

  const resolveAlias = (s: ts.Symbol) =>
    s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;

  /** Records a toets symbol; returns whether it is new. */
  const record = (symbol: ts.Symbol | undefined): boolean => {
    if (!symbol || !(symbol.flags & NAMED) || named.has(symbol)) return false;
    if (!symbol.declarations?.some(isToetsDeclaration)) return false;
    named.add(symbol);
    return true;
  };

  /** Type references as written, so aliases of primitives and unions are found too. */
  const visitTypeNode = (node: ts.Node, deep: boolean): void => {
    if (ts.isTypeReferenceNode(node) || ts.isExpressionWithTypeArguments(node)) {
      const at = ts.isTypeReferenceNode(node) ? node.typeName : node.expression;
      const target = checker.getSymbolAtLocation(at);
      const symbol = target && resolveAlias(target);
      if (symbol && record(symbol) && deep) {
        visit(checker.getDeclaredTypeOfSymbol(symbol), true);
        symbol.declarations?.forEach((d) => visitDeclaration(d, true));
      }
    }
    // Inside a callback signature, only the names met count (see above).
    const inner = deep && !ts.isFunctionTypeNode(node) && !ts.isMethodSignature(node);
    ts.forEachChild(node, (child) => visitTypeNode(child, inner));
  };

  const visitDeclaration = (decl: ts.Declaration, deep: boolean) => {
    if (!isToetsDeclaration(decl)) return;
    if (ts.isTypeAliasDeclaration(decl)) visitTypeNode(decl.type, deep);
    else if (ts.isInterfaceDeclaration(decl)) {
      decl.heritageClauses?.forEach((h) => visitTypeNode(h, deep));
      decl.members.forEach((m) => visitTypeNode(m, deep));
      decl.typeParameters?.forEach((p) => visitTypeNode(p, deep));
    } else if ('type' in decl && decl.type) visitTypeNode(decl.type as ts.Node, deep);
  };

  const visitSymbol = (symbol: ts.Symbol, deep: boolean) => {
    const decls = symbol.declarations ?? [];
    if (decls.length > 0 && !decls.some(isToetsDeclaration)) return;
    decls.forEach((d) => visitDeclaration(d, deep));
    if (deep) visit(checker.getTypeOfSymbol(symbol), true);
  };

  const visit = (type: ts.Type, deep: boolean): void => {
    if (type.aliasSymbol) record(type.aliasSymbol);
    if (type.symbol) record(type.symbol);
    if (type.isUnionOrIntersection()) {
      type.types.forEach((t) => visit(t, deep));
      return;
    }
    if (!deep || seen.has(type)) return;
    seen.add(type);
    type.aliasTypeArguments?.forEach((t) => visit(t, true));
    if (!(type.flags & ts.TypeFlags.Object)) return;
    const object = type as ts.ObjectType;
    if (object.objectFlags & ts.ObjectFlags.Reference) {
      checker.getTypeArguments(object as ts.TypeReference).forEach((t) => visit(t, true));
    }
    // Members of non-toets types (Playwright's `Project`, ...) are not ours to export.
    const owner = type.aliasSymbol ?? type.symbol;
    const foreign = owner?.declarations?.length && !owner.declarations.some(isToetsDeclaration);
    for (const prop of checker.getPropertiesOfType(type)) if (!foreign) visitSymbol(prop, true);
    for (const signature of [
      ...checker.getSignaturesOfType(type, ts.SignatureKind.Call),
      ...checker.getSignaturesOfType(type, ts.SignatureKind.Construct),
    ]) {
      signature.getParameters().forEach((p) => visitSymbol(p, false));
      visit(signature.getReturnType(), false);
    }
    for (const info of checker.getIndexInfosOfType(type)) visit(info.type, true);
  };

  for (const root of roots) {
    root.declarations?.forEach((d) => visitDeclaration(d, true));
    if (root.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)) {
      visit(checker.getDeclaredTypeOfSymbol(root), true);
      continue;
    }
    // Functions and objects of functions (`platforms`): their signatures are the config surface.
    const type = checker.getTypeOfSymbol(root);
    const signatures = [
      type,
      ...checker.getPropertiesOfType(type).map((p) => checker.getTypeOfSymbol(p)),
    ].flatMap((t) => checker.getSignaturesOfType(t, ts.SignatureKind.Call));
    for (const signature of signatures) {
      const decl = signature.getDeclaration();
      if (decl) visitTypeNode(decl, true);
      signature.getParameters().forEach((p) => visitSymbol(p, true));
    }
  }
  return [...named];
}

describe('public config types', () => {
  it('exports every toets type reachable from the config surface', () => {
    const entry = join(packageDir, 'src/index.ts');
    const program = createProgram(entry);
    const checker = program.getTypeChecker();
    const moduleSymbol = checker.getSymbolAtLocation(program.getSourceFile(entry)!)!;
    const exports = checker.getExportsOfModule(moduleSymbol);
    const resolveAlias = (s: ts.Symbol) =>
      s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;
    const exported = new Set(exports.map(resolveAlias));
    const roots = CONFIG_ROOTS.map((name) => {
      const symbol = exports.find((s) => s.name === name);
      if (!symbol) throw new Error(`${name} is not exported`);
      return resolveAlias(symbol);
    });

    const missing = reachableNamedTypes(checker, roots)
      .filter((symbol) => !exported.has(symbol))
      .map((symbol) => symbol.name)
      .sort();
    expect(missing).toEqual([]);
  });
});
