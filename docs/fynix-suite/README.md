# fynixOffice in the Fynix suite

fynixOffice is the **rich document editor** for the Fynix business suite: Word-compatible `.docx`, Excel-compatible `.xlsx`, plus slides, PDF, and Markdown on the desktop. It integrates with **DocFlow**, **Finance**, and **Fynix HQ** through a small server BFF and suite SSO — not by rehosting the full editor in the browser.

| Document | Contents |
|----------|----------|
| [Architecture](./architecture.md) | Desktop vs server, product roles, open-ticket flow |
| [Deploy (Docker)](../../apps/office-server/DEPLOY.md) | Linux install on `fynix-suite` network |
| [Suite open (DocFlow / Finance)](../../apps/office-server/SUITE-OPEN.md) | Edit in Word / Open in Excel |
| [DNS and hosting](./dns-and-hosting.md) | DNS records, Caddy, Vercel — what goes where |
| [office-server API](../../apps/office-server/README.md) | Auth, AI, tickets, env vars |

## At a glance

```text
┌─────────────────────────┐     ┌──────────────────────────────┐
│  User workstation       │     │  Linux suite host (Docker)   │
│  fynixOffice Electron   │────►│  office-api + office-redis   │
│  Docs / Sheets / …      │ SSO │  (Keycloak RP, AI, tickets)  │
└─────────────────────────┘     └──────────────┬───────────────┘
                                               │
         ┌─────────────────────────────────────┼─────────────────────┐
         ▼                                     ▼                     ▼
   DocFlow (web)                         Finance (web)          Fynix HQ
   “Open in fynixOffice”                 openInFynixOffice()    suite portal
```

- **Users who edit** Word/Excel files install the **desktop app**.
- **Users who only use DocFlow/Finance** do not need the app.
- **Operators** run `office-api` in Docker next to the rest of the suite.
