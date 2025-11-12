# Oxc Ecosystem CI

This repository is used to run integration tests for `oxlint` and `oxfmt` ecosystem projects. The workflows will be run on a scheduled basis and can also be triggered manually.

## Oxlint

### Maintenance

* [Boshen](https://github.com/Boshen) may submit a `oxlint` adjustment PR to your repository if it fails to run correctly.
* Due to maintenance burden, a [sponsorship](https://github.com/sponsors/Boshen) will have a more likely hood of having the PR accepted.

### Manual github workflow

* open [workflow](https://github.com/oxc-project/oxc-ecosystem-ci/actions/workflows/oxlint-ci.yml)
* click 'Run workflow' button on top right of the list
* change `ref` for a different branch

### Local

- `pnpm run clone:oxlint` - clones all the repositories
- `pnpm run update:oxlint` - updates (git pull) all the repositories
- `pnpm run test:oxlint /path/to/oxc/target/release/oxlint ARGS` - run `oxlint`

### Integrated Repositories

See [./oxlint-matrix.json](./oxlint-matrix.json).

Notable repositories:

* [rolldown/rolldown](https://github.com/rolldown-rs/rolldown)
* [napi-rs/napi-rs](https://github.com/napi-rs/napi-rs)
* [toeverything/affine](https://github.com/toeverything/affine)
* [preactjs/preact](https://github.com/preactjs/preact)
* [microsoft/vscode](https://github.com/microsoft/vscode)
* [bbc/simorgh](https://github.com/bbc/simorgh)
* [elastic/kibana](https://github.com/elastic/kibana)
* [DefinitelyTyped/DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped)

## Oxfmt

### What we are checking

1. Oxfmt can format the integrated repositories without any differences.
2. Oxfmt does not drop any code in the formatting process.
3. Oxfmt does not panic during the formatting process.

### Manual github workflow

* open [workflow](https://github.com/oxc-project/oxc-ecosystem-ci/actions/workflows/oxfmt-ci.yml)
* click 'Run workflow' button on top right of the list
* change `ref` for a different branch

### Local
- `pnpm run clone:oxfmt` - clones all the repositories
- `pnpm run update:oxfmt` - updates (git pull) all the repositories
- `pnpm run test:oxfmt /path/to/oxc/target/release/oxfmt ARGS` - run `oxfmt`

### Integrated Repositories

See [./oxfmt-matrix.json](./oxfmt-matrix.json).

<p align="center">
  <a href="https://github.com/sponsors/Boshen">
    <img src="https://cdn.jsdelivr.net/gh/boshen/sponsors/sponsors.svg" alt="My sponsors" />
  </a>
</p>
