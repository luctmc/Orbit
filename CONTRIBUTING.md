# Contributing to Orbit

Thanks for helping improve transparent and reliable multi-agent software development.

## Before you start

Orbit is experimental. The native app currently targets macOS. Familiarity with Node.js, TypeScript, React, Rust/Tauri and command-line coding agents may help, but documentation and focused bug fixes are welcome.

1. Search existing issues and pull requests before starting a substantial feature.
2. For larger changes, open a proposal explaining the problem, intended behavior, alternatives and risks.
3. Fork or clone the repository. Create a branch named `feature/orbit-short-description` or `fix/orbit-short-description`.
4. Install Node.js 24.11+ and Rust. Run `npm ci`, then `npm run typecheck`, `npm test`, and `node --test scripts/*.test.mjs`.
5. For desktop/native changes, run `npm run build:all -w @orbit/desktop` and `cargo check --locked` in `apps/desktop/src-tauri`.
6. Open a pull request explaining the change, tests performed, limitations and screenshots only if they contain no private information.

Some live provider integrations require external CLI tools and authentication. Never include your credentials, home-directory data or real session transcripts in an issue, test or PR. Use synthetic fixtures instead.

## What makes a useful contribution?

- Reproducible bugs with minimal steps and safe logs
- Improvements to deterministic tests, recoverability and observability
- Provider-neutral protocol and security fixes
- Accessible interface improvements and documentation
- Cross-platform architecture with clearly identified supported targets

Keep pull requests focused. Avoid unrelated refactors and forced updates to other contributors' local installations.

## Attribution and licensing

By contributing, you agree your original contribution may be distributed under the repository MIT License, unless explicitly agreed otherwise. Ensure you have the right to submit the code. Preserve all upstream attributions and third-party license notices; do not paste proprietary code, reverse-engineered assets or code you do not have permission to redistribute.

Read [SECURITY.md](SECURITY.md) for private vulnerability reporting and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations.
