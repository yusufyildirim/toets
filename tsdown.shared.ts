import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface PackageJson {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>;
}

/**
 * Packages a workspace package's emitted JS and `.d.ts` may import: its dependencies and its
 * required peers. Optional peers are excluded because consumers may not install them, so
 * importing one (even types only) breaks their build. Use as tsdown's `deps.onlyImport`; the
 * build fails on any other import.
 *
 * `aliased` lists optional peers imported anyway because every consumer resolves the name,
 * installed or aliased (`react-native` is `react-native-web` in web builds).
 */
export function allowedImports(packageDir: string, aliased: readonly string[] = []): string[] {
  const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as PackageJson;
  const optional = pkg.peerDependenciesMeta ?? {};
  return [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}).filter(
      (name) => optional[name]?.optional !== true || aliased.includes(name),
    ),
  ];
}
