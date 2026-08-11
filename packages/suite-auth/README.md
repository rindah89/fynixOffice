# @fynixoffice/suite-auth

Desktop client for **Fynix suite SSO** and **open-ticket** redemption. Used by the Electron main process (shell, docs, slides, sheets AI). No Electron dependency; safe to unit-test in Node.

## Suite session

| API | Purpose |
|-----|---------|
| `startSuiteLogin(onEvent?)` | `POST /auth/desktop/start`, poll until success, write session file |
| `suiteAccountStatus()` | `GET /auth/session` — `{ loggedIn, email?, subject? }` (no credits) |
| `suiteLogout()` | `POST /auth/logout` + clear local file |
| `suiteSessionToken()` / `hasSuiteSession()` | Local token presence |
| `suiteApiFetch(path, init?)` | Authenticated fetch to office-server |
| `suiteStreamAi(body, onChunk, signal)` | AI NDJSON stream via `POST /ai/stream` |

Session path: `~/.fynixoffice/session.json` (override dir with `FYNIXOFFICE_AUTH_DIR`).

Server URL: `OFFICE_SERVER_URL` (default `http://localhost:4321`).

## Open tickets

| API | Purpose |
|-----|---------|
| `parseOpenTicketFromUrl(url)` | `fynixoffice://open?ticket=` or `https://…/open?ticket=` |
| `redeemOpenTicket(id)` | Metadata |
| `downloadOpenTicketContent(id)` | File bytes for shell temp materialize |

See [SUITE-OPEN.md](../../apps/office-server/SUITE-OPEN.md) and [docs/fynix-suite](../../docs/fynix-suite/README.md).

## Tests

```bash
npm run test -w @fynixoffice/suite-auth
```
