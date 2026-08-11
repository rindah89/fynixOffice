# Suite open: DocFlow → Word, Finance → Excel

Integration goal: open a **DocFlow** document in **fynixOffice Docs** (Word-class `.docx`) or a **Finance** export in **fynixOffice Sheets** (Excel-class `.xlsx`) without hosting the full Office UI in the browser.

## User experience

1. Staff works in **DocFlow** or **Finance** (web).  
2. Chooses **Open in fynixOffice** (or a Finance export helper).  
3. Desktop app launches (or an HTTPS landing page offers the protocol link).  
4. If needed, user **Signs in to Fynix** once in the desktop Account menu.  
5. File opens in the correct editor tab.

Users who only read correspondence or reports never install Office. Users who edit install the desktop app once.

## Flow

```text
DocFlow / Finance (browser or API)
  │  POST mint ticket (+ file bytes or downloadUrl)
  │  Authorization: service key
  ▼
office-api  ── stores ticket (Redis / memory), TTL ~10 min
  │
  │  protocolUrl:  fynixoffice://open?ticket=<id>
  │  webUrl:       https://office…/open?ticket=<id>
  ▼
User desktop fynixOffice
  │  suite session Bearer
  │  GET /open/tickets/<id>/content
  ▼
Temp file → Docs (.docx) or Sheets (.xlsx)
```

## Configuration

Use the **same public base URL** and **same service secret** everywhere.

### office-server

```bash
OFFICE_BASE_URL=https://office.fynixhq.com
OFFICE_OPEN_SERVICE_KEY=<long-random-shared-secret>
```

### DocFlow

```bash
DOCFLOW_OFFICE_URL=https://office.fynixhq.com
DOCFLOW_OFFICE_SERVICE_KEY=<same-shared-secret>
# suite.enabled=true (DocFlow suite integration must be on)
```

| Surface | Detail |
|---------|--------|
| API | `POST /api/v1/documents/{document_id}/open-in-office` (session user must be allowed to read the document) |
| UI | Correspondence detail → **Open in fynixOffice** |

### Finance

```bash
FINANCE_OFFICE_URL=https://office.fynixhq.com
FINANCE_OFFICE_SERVICE_KEY=<same-shared-secret>
# aliases accepted: OFFICE_BASE_URL / OFFICE_OPEN_SERVICE_KEY
```

| Surface | Detail |
|---------|--------|
| API | `POST /api/office/open` body `{ filename, contentBase64, title?, kind?, sourceId? }` |
| Helper | `import { openInFynixOffice } from '@/lib/office-open'` then `await openInFynixOffice({ filename, bytes })` after generating an xlsx |

If Finance is hosted on **Vercel**, set those env vars in the Vercel project. Do **not** host office-api on Vercel; see [dns-and-hosting.md](../../docs/fynix-suite/dns-and-hosting.md).

### Desktop

```bash
export OFFICE_SERVER_URL=https://office.fynixhq.com   # = OFFICE_BASE_URL
```

- Protocol **`fynixoffice://`** is registered by the packaged shell.  
- User must complete **Sign in to Fynix** before redeeming a ticket.  
- If the session is missing, the app shows an error and starts login.  

## Ticket API (office-server)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/open/tickets` | Service key **or** suite user session | Mint ticket |
| GET | `/open?ticket=` | none | HTTPS landing; tries `fynixoffice://` |
| GET | `/open/tickets/:id` | suite session | Metadata |
| GET | `/open/tickets/:id/content` | suite session | File bytes |

### Mint body (JSON)

| Field | Required | Description |
|-------|----------|-------------|
| `kind` | yes* | `docx` \| `xlsx` \| `pptx` \| `pdf` \| `md` (*or inferred from `filename`) |
| `filename` | yes | e.g. `letter.docx` |
| `source` | no | `docflow` \| `finance` \| `generic` (default `generic`) |
| `title` | no | Display title |
| `sourceId` | no | Upstream document / report id |
| `contentBase64` | one of | Inline file (max ~40 MiB) |
| `downloadUrl` | one of | URL office-server fetches on redeem |
| `downloadHeaders` | no | Headers for `downloadUrl` (never returned to clients) |
| `contentType` | no | MIME type |
| `ttlSeconds` | no | 60–3600 (default 600) |

Service auth:

```http
X-Office-Service-Key: <OFFICE_OPEN_SERVICE_KEY>
```

or `Authorization: Bearer <OFFICE_OPEN_SERVICE_KEY>`.

### Mint response

```json
{
  "ticket": "…",
  "kind": "docx",
  "source": "docflow",
  "filename": "letter.docx",
  "expiresAt": 0,
  "protocolUrl": "fynixoffice://open?ticket=…",
  "webUrl": "https://office.example/open?ticket=…"
}
```

## Operator smoke test

1. Start office-api; `curl http://127.0.0.1:4321/healthz`.  
2. Mint a ticket with the service key and a small base64 payload.  
3. Open `webUrl` in a browser — landing page should offer the protocol link.  
4. On a machine with fynixOffice installed and suite SSO signed in, open `protocolUrl`.  
5. Docs or Sheets tab should show the file.  
6. From DocFlow Correspondence (configured env), use **Open in fynixOffice** on a `.docx`-class blob.  

## Out of scope (current)

- Saving the edited file back into DocFlow as a new version  
- Automatic wiring of every Finance export button (helper is ready; call sites are product-specific)  
- Browser-only full Office UI  
