# Releasing

All `@toets/*` packages are versioned and published together ([Changesets](https://github.com/changesets/changesets), `fixed` group). `docs` and `examples/*` are private and never published.

1. Every user-facing change adds a changeset: `pnpm changeset`.
2. On `main`, the [Release workflow](./.github/workflows/release.yml) opens or updates a "Version Packages" PR that bumps versions and writes the changelogs.
3. Merging that PR builds and packs every package whose version is not on npm yet, then publishes the tarballs from a separate job in the `npm` environment and pushes a git tag per package. Only the publish job gets `id-token: write`; build and pack run without it.
4. When anything was published, the [Docs workflow](./.github/workflows/docs.yml) builds the docs site and deploys it to GitHub Pages, so the site matches the released packages. To redeploy without a release, run the Docs workflow by hand from `main`.

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
- `main` is protected by the `main` ruleset: squash-merged PRs only, `Check` and `E2E (web, Chromium)` must pass, no force pushes. Admins can bypass it on pull requests only.
- The "Version Packages" PR is opened with `GITHUB_TOKEN`, which does not trigger CI, so its required checks never report. Merge it with the admin bypass ("Merge without waiting for requirements").
- GitHub Pages serves the docs site from Actions: Settings > Pages > Build and deployment > Source: "GitHub Actions". The site URL (`https://yusufyildirim.github.io/toets/`, or a custom domain set there) becomes the site base and the origin of `llms.txt` links on the next deploy. The `github-pages` environment created with it allows deployments from `main` only; keep it that way.
- Optional: require a reviewer on the `npm` environment (Settings > Environments) to approve each publish.

## Checking a release locally

```sh
pnpm build
pnpm pack:local /tmp/toets-packs   # one tarball per package, workspace ranges resolved
```
