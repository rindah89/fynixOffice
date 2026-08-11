# @fynixoffice/office-server

Suite **backend-for-frontend** for fynixOffice: Keycloak SSO, opaque sessions, open-ticket handoff (DocFlow / Finance), and AI streaming **without** per-user billing.

| Guide | Description |
|-------|-------------|
| **[DEPLOY.md](./DEPLOY.md)** | Docker on the Fynix suite Linux host |
| **[SUITE-OPEN.md](./SUITE-OPEN.md)** | DocFlow → Word / Finance → Excel tickets |
| **[docs/fynix-suite/](../../docs/fynix-suite/README.md)** | Architecture, DNS / Vercel |

Electron editors install on user desktops. This package is the **only** Office component you run as a long-lived server.

## Responsibilities

1. **OIDC RP** against the suite Keycloak realm (`fynix-office` client).  
2. **Desktop login** (poll flow): browser completes IdP; desktop gets an opaque session token.  
3. **Entitlement**: realm role `fynix-office-access`.  
4. **Open tickets**: one-time file handoff for suite products (`/open/*`).  
5. **AI BFF**: `POST /ai/stream` with server-held `OFFICE_LLM_*` keys.  

Tokens and vendor API keys **never** ship inside the Electron app for suite mode.

## Auth model

```text
Desktop                office-server                 Keycloak
  │  POST /auth/desktop/start                           │
  │─────────────────────────► create PKCE tx            │
  │◄───────────────────────── authorizationUrl + poll   │
  │  open browser ─────────────────────────────────────►│
  │◄───────────────────────── GET /auth/desktop/callback│
  │  poll until complete                                │
  │◄───────────────────────── sessionToken              │
```

Local session file: `~/.fynixoffice/session.json` (mode `0600`).

## HTTP API (summary)

### Health / landing

| Method | Path | Auth |
|--------|------|------|
| GET | `/healthz` | none |
| GET | `/` | none (short “install desktop” page) |

### Auth

| Method | Path | Auth |
|--------|------|------|
| POST | `/auth/desktop/start` | none |
| GET | `/auth/desktop/callback` | none (IdP redirect) |
| GET | `/auth/desktop/poll?token=` | none (poll token) |
| GET | `/auth/session` | Bearer session |
| POST | `/auth/logout` | Bearer session |

### Open tickets (suite handoff)

| Method | Path | Auth |
|--------|------|------|
| POST | `/open/tickets` | **Service key** or suite session |
| GET | `/open?ticket=` | none (landing → `fynixoffice://`) |
| GET | `/open/tickets/:id` | suite session |
| GET | `/open/tickets/:id/content` | suite session |

Service auth: `Authorization: Bearer <OFFICE_OPEN_SERVICE_KEY>` or header `X-Office-Service-Key`.

### AI

| Method | Path | Auth |
|--------|------|------|
| GET | `/ai/status` | suite session |
| POST | `/ai/stream` | suite session (NDJSON stream) |

## Environment

| Variable | Default / notes |
|----------|-----------------|
| `OFFICE_BASE_URL` | Public URL, e.g. `https://office.fynixhq.com` (Keycloak redirects + ticket `webUrl`) |
| `OFFICE_OIDC_ISSUER` | `https://auth.fynixhq.com/realms/fynix` |
| `OFFICE_OIDC_CLIENT_ID` | `fynix-office` |
| `OFFICE_OIDC_CLIENT_SECRET` | required in real deploys |
| `OFFICE_SESSION_TTL_SECONDS` | `28800` |
| `OFFICE_REDIS_URL` | unset = memory (dev); Docker sets Redis |
| `OFFICE_OPEN_SERVICE_KEY` | shared with DocFlow / Finance for ticket mint |
| `OFFICE_LLM_PROVIDER` | `anthropic` (or openai, gemini, …) |
| `OFFICE_LLM_API_KEY` | required for AI |
| `OFFICE_LLM_MODEL` | provider default if empty |
| `OFFICE_LLM_BASE_URL` | optional custom OpenAI-compatible base |
| `PORT` | `4321` |

Template for Docker: [`.env.docker.example`](./.env.docker.example).

## Local run

```bash
export OFFICE_OIDC_CLIENT_SECRET=...
export OFFICE_BASE_URL=http://localhost:4321
export OFFICE_OPEN_SERVICE_KEY=dev-open-key   # optional for ticket tests
# optional AI:
# export OFFICE_LLM_API_KEY=...

npm run dev -w @fynixoffice/office-server
# or from monorepo root:
npm run dev:server
```

```bash
npm run test -w @fynixoffice/office-server
npm run typecheck -w @fynixoffice/office-server
```

Desktop (another terminal):

```bash
export OFFICE_SERVER_URL=http://localhost:4321
npm run dev
```

## Keycloak setup

1. Confidential client **`fynix-office`**, standard flow + PKCE S256.  
2. Valid redirect URI: `{OFFICE_BASE_URL}/auth/desktop/callback`.  
3. Realm role **`fynix-office-access`**; assign to users who may use Office.  
4. Fynix HQ: seed role + `VITE_OFFICE_APP_URL` (see HQ `suiteApplications` / deploy seed).  

## Docker (quick)

```bash
# once per suite host
sh /path/to/projects/scripts/ensure-fynix-suite-network.sh

cp apps/office-server/.env.docker.example apps/office-server/.env.docker
# set OFFICE_BASE_URL, OFFICE_OIDC_CLIENT_SECRET, OFFICE_OPEN_SERVICE_KEY, optional OFFICE_LLM_*

docker compose -f apps/office-server/docker-compose.yml \
  --env-file apps/office-server/.env.docker up -d --build

curl -sS http://127.0.0.1:4321/healthz
```

Full steps: **[DEPLOY.md](./DEPLOY.md)**. DNS / Vercel: **[docs/fynix-suite/dns-and-hosting.md](../../docs/fynix-suite/dns-and-hosting.md)**.
