# Contributing

Thank you for your interest in contributing to `tsc-staged`!

## Issues

Feel free to create an issue to report a bug, request a feature, or ask a question. Before doing so, please check for existing issues concerned about the same topic.

## Development

### Setup

This project uses [mise](https://mise.jdx.dev/) to manage dependencies.

```sh
mise trust && mise install
```

Install dependencies:

```sh
pnpm install
```

### Making changes

Before making a change, check for existing pull requests addressing the same problem.

1. Fork the repository and create a new branch.
2. Make your changes and commit them.
3. Push your change to your fork.
4. Open a **draft** pull request against the main branch of this repository.
5. Wait for CI results and resolve any issues.
6. Mark the PR as ready for review.

Please make sure that your changes pass all checks before marking the PR as ready for review. Follow the guidelines in the sections below to increase the chances of your PR being merged!

### Releases

A release is published when the `version` in `package.json` changes on the main branch. If your change must be released:

1. Increase `version` in `package.json`. Follow [SemVer](https://semver.org/).
2. Add an entry to `CHANGELOG.md` in the same pull request. Put a new `## <version>` heading below the title. Write each change as a short bullet sentence.

When the pull request is merged, the release workflow publishes the package to npm and creates the GitHub release. The workflow uses the `CHANGELOG.md` entry as the release notes. Do not change `version` if the change does not need a release.

### Git conventions

- Use a short, descriptive branch name.
- Keep commit messages short, descriptive, and simple. Do not use conventional commit prefixes.
- Prefer squash merging pull requests.
- Large changes may be rebase merged when their commits are well separated and self-contained.

### Linting & formatting

This project uses Vite+ for linting and formatting. Run them like this:

```sh
pnpm lint
pnpm format
```

Both are required to pass with no errors or warnings.

### Testing

This project uses `vitest` for testing. Run tests:

```sh
pnpm test
```

All tests are required to pass.

When adding new tests, consider the following:

- Tests should be focused and clear to understand
- Tests should test behaviour, not implementation
- Since this is a pure package with no runtime dependencies, tests should test the implementation and avoid mocks

### Documentation

When you make changes that affect the public API, ensure to update related documentation as well.

### Using AI

You are free to use AI tools for any contributions to this project. However, as any other contribution, review your changes carefully before opening a PR. AI-generated, low-quality contributions with no sign of human review will be rejected.
