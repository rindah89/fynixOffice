# Architecture: fynixOffice as a suite product

## Product role

| Product | System of record for | UI |
|---------|----------------------|-----|
| **DocFlow** | Correspondence, workflow, audit | Web |
| **Finance** | Ledgers, budgets, reports | Web (e.g. Next.js) |
| **Fynix HQ** | Suite portal, executive views | Web |
| **fynixOffice** | High-fidelity edit of `.docx` / `.xlsx` / … | **Desktop Electron** |

fynixOffice does **not** replace DocFlow or Finance. It opens real Office files when staff need Word- or Excel-level editing, then (today) leaves save-back to future work.

## Two deployables

| Component | Package / path | Runs where |
|-----------|----------------|------------|
| **Desktop suite** | `apps/shell` + editor apps | Each user’s Mac / Windows / Linux PC |
| **office-server (BFF)** | `apps/office-server` | Linux Docker on the suite host (`fynix-suite` network) |

There is **no** multi-user “Google Docs” web editor in this repo. The Docker image serves SSO, open tickets, and AI — not the full ribbon UI.

## Auth

1. **Keycloak** realm `fynix` (same as Fynix HQ) is the identity provider.
2. **office-server** is a confidential OIDC client (`fynix-office`).
3. Desktop uses a **device-style poll login**: browser completes Keycloak; desktop receives only an **opaque session token** (`~/.fynixoffice/session.json`).
4. Entitlement role: **`fynix-office-access`** (also used by HQ to show the Office card).
5. No per-user **billing** or credit wallet. LLM keys stay on the server (`OFFICE_LLM_*`).

Details: [office-server README](../../apps/office-server/README.md).

## DocFlow → Word / Finance → Excel

```text
1. User has permission on a DocFlow document (or a Finance export).
2. Product backend (or Finance API) POSTs content to office-api /open/tickets
   with OFFICE_OPEN_SERVICE_KEY (shared secret).
3. User is sent fynixoffice://open?ticket=… (or HTTPS /open?ticket= landing).
4. Desktop app (signed in) redeems the ticket and opens Docs or Sheets.
```

Full protocol and env vars: [SUITE-OPEN.md](../../apps/office-server/SUITE-OPEN.md).

## Protocol

| Scheme | Use |
|--------|-----|
| `fynixoffice://open?ticket=<id>` | Primary desktop deep link |
| `https://office.<domain>/open?ticket=<id>` | Fallback landing page that tries the protocol |

Packaged apps register the `fynixoffice` scheme via electron-builder `protocols`.

## Related code

| Area | Location |
|------|----------|
| Suite SSO client | `packages/suite-auth` |
| Open-ticket materialize | `apps/shell/src/main/suite-open.ts` |
| Desktop AI → BFF | `apps/docs|slides|sheets` main AI IPC |
| Ticket + auth API | `apps/office-server/src/open-*.ts`, `app.ts` |
| DocFlow open API | DocFlow `POST /api/v1/documents/{id}/open-in-office` |
| Finance open API | Finance `POST /api/office/open` + `lib/office-open.ts` |
