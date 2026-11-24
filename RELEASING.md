# Releasing

All `@toets/*` packages are versioned and published together ([Changesets](https://github.com/changesets/changesets), `fixed` group). `docs` and `examples/*` are private and never published.

1. Every user-facing change adds a changeset: `pnpm changeset`.
2. On `main`, the [Release workflow](./.github/workflows/release.yml) opens or updates a "Version Packages" PR that bumps versions and writes the changelogs.
3. Merging that PR runs `pnpm release` (build, then `changeset publish`) in the `npm` environment, which publishes every package whose version is not on npm yet and pushes the git tags.

CI holds no npm token. It authenticates with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC), which also adds provenance when the repository is public.

## First release

A trusted publisher is configured per package, so each package must exist on npm first. Publish `0.1.0` once from a maintainer machine, with 2FA:

```sh
npm login
pnpm changeset version     # 0.0.0 -> 0.1.0, writes the changelogs
pnpm release               # prompts for a 2FA code
git push --follow-tags     # commit the version bump first
```

Then, for every `@toets/*` package on npmjs.com (Settings > Trusted publishing > GitHub Actions):

- Organization or user `yusufyildirim`, repository `toets`, workflow `release.yml`, environment `npm`.
- Allow `npm publish` (new trusted publishers only allow `npm stage publish` by default).
- Publishing access: "Require two-factor authentication and disallow tokens". Trusted publishing keeps working; tokens can no longer publish.

A new trusted publisher expires unless it publishes within 2 days, so configure it shortly before the next release, or delete and recreate it if it expired.

## One-time repository setup

- Actions may create pull requests: Settings > Actions > General > "Allow GitHub Actions to create and approve pull requests".
- Optional: require a reviewer on the `npm` environment (Settings > Environments) to approve each publish.

## Checking a release locally

```sh
pnpm build
pnpm pack:local /tmp/toets-packs   # one tarball per package, workspace ranges resolved
```
