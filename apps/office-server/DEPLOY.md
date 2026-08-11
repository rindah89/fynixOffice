# Deploying fynixOffice on a Linux server (Fynix suite)

## What Docker installs

| Component | In Docker? | Role |
|-----------|------------|------|
| **office-api** (`apps/office-server`) | **Yes** | Suite BFF: Keycloak SSO, sessions, open tickets, AI stream |
| **office-redis** | **Yes** | Session + ticket store (multi-instance safe) |
| **Electron desktop** (docs / sheets / slides / pdf / shell) | **No** | Install on **user workstations** |

Same pattern as the rest of Fynix: **servers** on the `fynix-suite` Docker network; **rich editing** on the desktop.

```text
User desktop (Electron)  ──HTTPS──►  edge (Caddy)
                                        │
                                        ▼
                              office-api :4321  (Docker)
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              ▼                         ▼                         ▼
        office-redis               Keycloak                  LLM provider
        (sessions/tickets)     auth.<domain>              (OFFICE_LLM_*)
```

## Prerequisites

1. Docker + Compose on the Linux host.  
2. Shared network (once per host):

   ```bash
   sh projects/scripts/ensure-fynix-suite-network.sh
   # external network name: fynix-suite
   ```

3. Keycloak realm `fynix` (same as HQ):
   - Client **`fynix-office`** (confidential, PKCE S256)
   - Redirect: `{OFFICE_BASE_URL}/auth/desktop/callback`
   - Role **`fynix-office-access`** for entitled users  
4. Public DNS + TLS for `OFFICE_BASE_URL` (see [DNS and hosting](../../docs/fynix-suite/dns-and-hosting.md)).  
5. Fynix HQ: `VITE_OFFICE_APP_URL` so the portal can list Office.  

## Install (monorepo root)

```bash
cp apps/office-server/.env.docker.example apps/office-server/.env.docker
# Required:
#   OFFICE_BASE_URL              e.g. https://office.fynixhq.com
#   OFFICE_OIDC_CLIENT_SECRET
#   OFFICE_OPEN_SERVICE_KEY      shared with DocFlow + Finance
# Optional:
#   OFFICE_LLM_API_KEY / OFFICE_LLM_PROVIDER / OFFICE_LLM_MODEL

docker compose \
  -f apps/office-server/docker-compose.yml \
  --env-file apps/office-server/.env.docker \
  up -d --build
```

Health check:

```bash
curl -sS http://127.0.0.1:4321/healthz
# {"status":"ok","service":"fynixoffice","aiEnabled":true|false}
```

In-network aliases for other containers: **`office-api`**, **`fynixoffice`**.

## Edge proxy (Caddy)

Compose publishes **loopback only** (`127.0.0.1:4321`). Terminate TLS on the suite edge:

```caddy
office.fynixhq.com {
	reverse_proxy 127.0.0.1:4321
}
```

Do **not** expect the Office API to be a Vercel project. If Finance runs on Vercel, only Finance’s domain is configured there; Finance calls `https://office.…` as an external API. Details: [dns-and-hosting.md](../../docs/fynix-suite/dns-and-hosting.md).

## Desktop clients

1. Ship installers (`npm run dist:mac` / `dist:win` / `dist:linux`) or internal packages.  
2. Point every client at the public API:

   ```bash
   export OFFICE_SERVER_URL=https://office.fynixhq.com
   ```

   (Same value as `OFFICE_BASE_URL`.)  
3. Users: **Account → Sign in to Fynix** (browser Keycloak, then return to the app).  
4. Protocol **`fynixoffice://`** is registered by the packaged app for suite open links.  

There is **no** full Word/Excel UI inside the container.

## Wire DocFlow and Finance

| Product | Env | Notes |
|---------|-----|--------|
| DocFlow | `DOCFLOW_OFFICE_URL`, `DOCFLOW_OFFICE_SERVICE_KEY` | Same key as `OFFICE_OPEN_SERVICE_KEY`; `suite.enabled=true` |
| Finance | `FINANCE_OFFICE_URL`, `FINANCE_OFFICE_SERVICE_KEY` | Same key; API + `lib/office-open.ts` |

See **[SUITE-OPEN.md](./SUITE-OPEN.md)**.

## Checklist

- [ ] `fynix-suite` network exists  
- [ ] `office-api` + `office-redis` healthy  
- [ ] DNS + TLS for `OFFICE_BASE_URL` (suite edge, not Vercel for Office)  
- [ ] Caddy (or equivalent) → `127.0.0.1:4321`  
- [ ] Keycloak client + `fynix-office-access`  
- [ ] HQ `VITE_OFFICE_APP_URL`  
- [ ] Desktop `OFFICE_SERVER_URL` matches public base  
- [ ] `OFFICE_OPEN_SERVICE_KEY` = DocFlow / Finance service keys  
- [ ] DocFlow / Finance office URL env set  
- [ ] Optional: `OFFICE_LLM_*` for AI  

## Not in this container

- Electron editors and packaging for end-user OS installers  
- Genspark billing / credits  
- Warehouse marts / suite event publishing (future)  
- Save-back of edited files into DocFlow/Finance (future)  
