# DNS and hosting (including Vercel)

## Short answer

**You do not put the fynixOffice API on Vercel DNS** unless you deliberately reverse-proxy Vercel to a backend (not recommended).  

- **`office.<your-domain>`** → suite Linux host / load balancer that runs **Caddy (or similar) + Docker office-api**.  
- **Vercel** is only relevant if a **suite web app** (often **Finance**) already uses Vercel for *its* domain.

## Recommended hostnames

| Hostname (example) | Service | DNS points to |
|--------------------|---------|----------------|
| `office.fynixhq.com` | office-api (BFF) | Suite edge (Caddy on the Docker host) |
| `auth.fynixhq.com` | Keycloak | Auth infrastructure |
| `doc.fynixhq.com` / DocFlow host | DocFlow | DocFlow deploy |
| `finance.fynixhq.com` | Finance web | **Vercel** *or* your Finance host |
| `fynixhq.com` | Fynix HQ | HQ Docker / edge |

Desktop and suite products must use the **same public `OFFICE_BASE_URL`** (e.g. `https://office.fynixhq.com`).

## Do I need to configure DNS on Vercel?

| Case | Action |
|------|--------|
| Finance (or another Next.js app) **is on Vercel** and uses a custom domain | In the **Vercel project**, add **only that product’s** domain (e.g. `finance.…`). Set env `FINANCE_OFFICE_URL=https://office.…` so Finance can call the Office API. |
| office-api runs on your suite Linux / AWS host | Add `office.…` in **your DNS provider** (Route53, Cloudflare, etc.) → A/AAAA or CNAME to the suite edge. **Do not** add `office.…` as a Vercel domain. |
| Entire suite is Docker + Caddy only | All product names → Caddy. No Vercel DNS required for Office. |
| Local testing | No public DNS; `OFFICE_BASE_URL=http://localhost:4321` or `http://<server-ip>:4321`. |

Vercel hosts the **Finance UI**. It does **not** host Electron editors or the office-server BFF. Finance only **calls** `https://office.…/open/tickets` (server-side) with the shared service key.

## Edge proxy (Caddy)

Compose binds office-api to **loopback** `127.0.0.1:4321`. TLS and public DNS terminate on the suite edge:

```caddy
office.fynixhq.com {
	reverse_proxy 127.0.0.1:4321
}
```

Keycloak must allow:

```text
{OFFICE_BASE_URL}/auth/desktop/callback
```

Example: `https://office.fynixhq.com/auth/desktop/callback`.

## Environment consistency

All of these must use the **same public office base URL**:

| Variable | Where |
|----------|--------|
| `OFFICE_BASE_URL` | office-server / Docker |
| `OFFICE_SERVER_URL` | Desktop clients |
| `DOCFLOW_OFFICE_URL` | DocFlow |
| `FINANCE_OFFICE_URL` | Finance (Vercel env or compose) |
| `VITE_OFFICE_APP_URL` | Fynix HQ build |

Shared open-ticket secret (same value):

| Variable | Where |
|----------|--------|
| `OFFICE_OPEN_SERVICE_KEY` | office-server |
| `DOCFLOW_OFFICE_SERVICE_KEY` | DocFlow |
| `FINANCE_OFFICE_SERVICE_KEY` | Finance |

## Checklist

- [ ] DNS for `office.<domain>` → suite edge (not Vercel, unless you know you proxy it)  
- [ ] TLS certificate for that name  
- [ ] Caddy (or nginx) reverse_proxy to `127.0.0.1:4321`  
- [ ] Keycloak client redirect URI matches `OFFICE_BASE_URL`  
- [ ] Desktop `OFFICE_SERVER_URL` matches  
- [ ] DocFlow / Finance office URL + service key match  
- [ ] If Finance is on Vercel: only Finance domain in Vercel; office URL in Vercel **env**, not as a Vercel-hosted site for Office  
