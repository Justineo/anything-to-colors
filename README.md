# Anything to colors

Turn a thought, a place, or a feeling into a living color palette.

[Try it live](https://colors.void.app/)

![A flowing palette of ocean blue, mint, and apricot](public/social-card.png)

Type anywhere or press and hold the background to speak. Your words dissolve into particles, take on their new colors, and melt into the painting. Move the pointer to stir the pigment; select a color in the corner to copy its HEX value.

## Features

- Expressive palettes of 1–9 colors, with requested order and repetitions preserved.
- WebGL2 fluid rendering, with several material styles and smooth palette transitions.
- 136 built-in examples. Click the corner caption or use the arrow keys to explore them.
- Voice input with hold-to-record and drag-to-cancel gestures.
- Eight interface languages: English, Chinese, Japanese, Korean, French, German, Spanish, and Portuguese.
- Lazy-loaded translations and self-hosted fonts, screen reader announcements, reduced-motion support, and a static gradient fallback.

The interface follows your browser's language preferences. Use `?lang=en`, `?lang=ja`, or another supported language code to override them. Only the preset shuffle order is saved locally; the app does not keep an input history.

## Development

Requires Node.js 24+ and pnpm 12.16.1, as specified in `package.json`.

```sh
cp env.example .env
# Set OPENAI_API_KEY in .env.
pnpm install --frozen-lockfile
pnpm dev
```

Local development calls OpenAI from the server. API keys never belong in client-side code. The environment example is named `env.example` because Void permits only one root `.env` file.

```sh
pnpm check   # Type checking, formatting, and lint
pnpm test    # Unit tests and local workerd integration tests
pnpm build   # Client and server bundles
pnpm size    # Initial bundle and lazy-loading checks
```

The test suite uses simulated model responses and does not make paid model calls. GitHub Actions runs the same checks for pushes to `main` and pull requests.

## Project structure

| Path                                                              | Purpose                                                          |
| ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| `src/App.vue`                                                     | Text and voice interactions, palette controls, and accessibility |
| `src/engine.ts`, `src/fluid.ts`, `src/swarm.ts`, `src/shaders.ts` | Rendering and animation                                          |
| `src/locales/`, `src/fonts/`                                      | Translations and font declarations                               |
| `routes/api/`, `server/`                                          | Session, palette, and transcription endpoints                    |
| `backend/`                                                        | Cloudflare Worker, background jobs, and shared request quotas    |
| `shared/limits.ts`                                                | Input and recording limits                                       |
| `scripts/`                                                        | Build, font, deployment, and development tools                   |

Vue Vapor handles the interface; Vite+ builds the app, and Void serves its API routes. Palette generation uses OpenAI's Responses API with a strict JSON schema. The browser receives colors and transcripts, never provider credentials. Session cookies, Turnstile verification, and shared request quotas protect production access. Failed model requests are not retried automatically.

## Deployment

The website and backend Worker are deployed separately. Review `backend/wrangler.json` and `scripts/cloudflare-api.mjs` before deploying to another Cloudflare account.

Copy `backend/env.example` to `backend/.env` and set `COLOR_RELAY_TOKEN` to a random secret. Keep `OPENAI_API_KEY` in the root `.env` for the backend deployment command:

```sh
pnpm exec void cloudflare login
CLOUDFLARE_AUTH_USE_KEYRING=true node --env-file=backend/.env --env-file=.env scripts/deploy-backend.mjs
```

Configure these website secrets with `pnpm exec void secret put <NAME>`:

| Secret                 | Purpose                                      |
| ---------------------- | -------------------------------------------- |
| `COLOR_RELAY_URL`      | The deployed Worker's `/api/color` URL       |
| `COLOR_RELAY_TOKEN`    | The same secret used by the backend Worker   |
| `CLIENT_SIGNING_KEY`   | A random secret for signing browser sessions |
| `TURNSTILE_SITE_KEY`   | The Turnstile widget's public site key       |
| `TURNSTILE_SECRET_KEY` | The Turnstile widget's server-side secret    |

Bind the Turnstile widget to the website's hostname, then deploy:

```sh
pnpm deploy
```

The backend's `DAILY_REQUEST_LIMIT` setting controls the shared daily request budget. Secrets and generated deployment files are excluded from Git.

## Maintenance

Renovate checks for dependency updates on Tuesdays in the Asia/Shanghai timezone, with a seven-day release-age requirement. Non-major updates are grouped and automatically merged after checks pass; major updates require review. Vite+ and its Vite override are updated together.

Documentation, comments, development tools, and general-purpose errors use English. Localized interface text stays in `src/locales/`; language and typography tests retain the fixtures they need.

## License

[MIT](LICENSE). Bundled fonts retain their respective licenses in `public/fonts/`.
