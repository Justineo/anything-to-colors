# Project conventions

- Use English for documentation, comments, development tools, and general-purpose errors.
- Keep localized interface text in `src/locales/`. Retain non-English fixtures only when needed for language or typography coverage.
- Keep the README focused on supported features, development, validation, architecture, and deployment. Keep experimental results local.
- Use `apply_patch` when changing code files.
- Before publishing changes, run `pnpm check`, `pnpm test`, `pnpm build`, and `pnpm size`.
