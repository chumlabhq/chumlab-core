# chumlab-be

Backend for the [Chumlab](https://chumlab.com) platform — the marketing site,
the `@chumlab/ui` docs, and the **AI Playground** that turns a prompt or a
screenshot into production React built with `@chumlab/ui`.

Node.js + Express + MongoDB. Authentication is a Google OAuth server-side flow
that issues an HTTP-only session cookie. The Playground runs a staged codegen
pipeline whose output is proven against the real component library by
deterministic verify gates before it is delivered.

## Stack

- Node.js >= 18, Express 4, Mongoose 8
- Passport (Google OAuth 2.0) + JWT session cookie (`chumlab_token`)
- Anthropic SDK (staged generation pipeline)
- Helmet, CORS, Morgan, express-rate-limit
- Razorpay Node SDK (payments)

## Quick start

```bash
npm install
cp .env.example .env      # then fill in the values (see Environment)
npm run dev               # nodemon, http://localhost:5000 (PORT is configurable)
# or
npm start
```

## Environment

All configuration is via environment variables. Copy `.env.example` to `.env`
and fill it in — **never commit a real `.env`** (it is git-ignored). The table
below lists what each value is for; `.env.example` has the full, placeholder-only
template.

### Required

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | signs the `chumlab_token` session cookie (use a long random string) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 web client |
| `GOOGLE_CALLBACK_URL` | `{api-origin}/api/auth/google/callback` (must match the Cloud Console redirect URI) |
| `FRONTEND_URL` | SPA origin, used for post-login redirects |
| `CORS_ORIGIN` | comma-separated allowed origins (exact, no trailing slash — `credentials: include` requires explicit origins) |
| `ANTHROPIC_API_KEY` | Anthropic API key for the generation pipeline |
| `ADMIN_EMAILS` | comma-separated admin emails |

### Playground access & quotas (safe defaults — override only to tune)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PLAYGROUND_INVITE_ONLY` | *(off — open access)* | set `true` to require an invite record instead of allowing every signed-in user |
| `PLAYGROUND_DAILY_LIMIT` | `20` | generations per user per UTC day |
| `PLAYGROUND_GLOBAL_DAILY_LIMIT` | `150` | generations across all users per UTC day (spend backstop — raise for production traffic) |
| `PLAYGROUND_BURST_PER_MINUTE` | `10` | per-user short-term throttle |

### Optional model / runtime tuning (defaults are sensible)

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | main generation model |
| `ANTHROPIC_ROUTER_MODEL` / `ANTHROPIC_CLASSIFY_MODEL` | `claude-haiku-4-5` | small fast models for routing / follow-up classification |
| `ANTHROPIC_MAX_OUTPUT_TOKENS` | `64000` | ceiling for the tier-scaled output budget |
| `ANTHROPIC_TIMEOUT_MS` | `90000` | per-call LLM timeout (a hung call fails cleanly) |
| `CHUMLAB_UI_DIR` | *(auto)* | path to the `@chumlab/ui` type definitions the type gate checks against |
| `NODE_ENV`, `PORT`, `APP_URL` | — | standard runtime settings |

Razorpay (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`)
is only needed if payments are enabled.

## API overview

All routes are mounted under `/api`. Playground endpoints require the session
cookie (`requireAuth`); generation additionally enforces access + quota.

| Area | Base | Notes |
| --- | --- | --- |
| Auth | `/api/auth` | Google OAuth login/callback, `me`, `logout` |
| Chats | `/api/chats` | chat CRUD + messages |
| Generation | `/api/generation` | run history + a run by id |
| Playground | `/api/playground` | `generate` (SSE), `generate/fix`, `generate/resume`, `settings`, `me` |
| Feedback | `/api/feedback` | submit / list feedback |
| Payments | `/api` | Razorpay create-order / verify / webhook |
| Admin | `/api/admin` | admin-only, gated by `ADMIN_EMAILS` |
| Health | `/api/health`, `/` | liveness |

The generation stream (`POST /api/playground/generate`) is Server-Sent Events:
the pipeline emits `{ runId, stage, status, payload }` envelopes as it routes,
plans, develops, verifies, reviews, and delivers.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | nodemon dev server |
| `npm start` | production server |
| `npm test` | Node's built-in test runner (`node --test`) |
| `npm run build:prompt` | assemble the develop-stage system prompt |

## Deployment notes

1. Create a Google OAuth 2.0 web client and add your production origin to
   **Authorized JavaScript origins** and `{api-origin}/api/auth/google/callback`
   to **Authorized redirect URIs**.
2. Set `CORS_ORIGIN` to your real frontend origin(s) and serve over HTTPS.
3. Whitelist the deploy environment's IPs for MongoDB Atlas.
4. Raise `PLAYGROUND_GLOBAL_DAILY_LIMIT` to match expected traffic, and set
   `ANTHROPIC_API_KEY` — every generation calls the Anthropic API.

## Project layout

```
chumlab-be/
  server.js
  src/
    app.js
    ai/            staged codegen pipeline (router, plan, develop, verify, qa, deliver)
    config/        db, passport / google, anthropic
    controllers/   thin asyncHandler controllers
    middleware/    auth, quota, error handling
    models/        Mongoose models
    routes/        route wiring
    utils/         asyncHandler, ApiError
  test/            node --test suites
```

## License

© Chumlab · [hello@chumlab.com](mailto:hello@chumlab.com)
