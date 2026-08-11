
fynixOffice is a free, open-source alternative to Microsoft Office for macOS,
Windows, and Linux, built around AI editing as a first-class workflow rather
than a bolted-on chat box. It opens and saves the real Microsoft Office
formats — Word (`.docx`), Excel (`.xlsx`), PowerPoint (`.pptx`) — and edits
PDF and Markdown too: a word processor, spreadsheet, presentation editor,
PDF editor, and Markdown editor as six Electron apps sharing one engine
layer.

[![Meet fynixOffice — the world's first full-featured open-source AI Office (video)](https://img.youtube.com/vi/B2pLdMX95v4/maxresdefault.jpg)](https://www.youtube.com/watch?v=B2pLdMX95v4)

[Watch the demo video on YouTube](https://www.youtube.com/watch?v=B2pLdMX95v4)

## Features

- **Real PDF editing** — retype text and edit images in the page itself, original fonts preserved.
- **Microsoft Word–compatible, byte-preserving `.docx` editing** — only what you touched changes; Word never notices.
- **Word-faithful pagination** — page breaks land where Word puts them.
- **Excel-compatible spreadsheets** — in-house engine with a Rust `.xlsx` sidecar, own charts, pivot tables, slicers.
- **PowerPoint-compatible presentations** — in-house `.pptx` engine with masters, layouts, smart guides, non-destructive crop.
- **Markdown to Word, fully local** — the same OOXML engine, no Pandoc, no cloud.
- **AI that edits documents** — block-level edits with snapshots and diffs, document-aware agents.
- **Agent tools built in** — web/image search, image generation, media analysis.
- **Light / dark / system themes.**
- **macOS, Windows, Linux.**
- **Free & open-source (Apache-2.0).**

## Download

| Platform                             | Requirements                                          | Download                                                                                                                         |
| ------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **macOS** — Apple Silicon (arm64)    | macOS 11+                                             | [fynixOffice-0.6.101-arm64.dmg](https://github.com/rindah89/fynixOffice/releases/download/v0.6.101/fynixOffice-0.6.101-arm64.dmg)   |
| **macOS** — Intel (x64)              | macOS 11+                                             | [fynixOffice-0.6.101.dmg](https://github.com/rindah89/fynixOffice/releases/download/v0.6.101/fynixOffice-0.6.101.dmg)               |
| **Windows** (x64)                    | Windows 10+                                           | [fynixOfficeSetup-v0.6.101.exe](https://github.com/rindah89/fynixOffice/releases/download/v0.6.101/fynixOfficeSetup-v0.6.101.exe)   |
| **Linux** — Debian / Ubuntu          | x86_64, glibc 2.34+ (Ubuntu 22.04 or newer)           | [fynixoffice_0.6.101_amd64.deb](https://github.com/rindah89/fynixOffice/releases/download/v0.6.101/fynixoffice_0.6.101_amd64.deb)   |
| **Linux** — Fedora / RHEL / openSUSE | x86_64, glibc 2.34+ (Fedora 35+, RHEL 9+, Leap 15.6+) | [fynixoffice-0.6.101.x86_64.rpm](https://github.com/rindah89/fynixOffice/releases/download/v0.6.101/fynixoffice-0.6.101.x86_64.rpm) |
| **Linux** — other distributions      | x86_64, glibc 2.34+, FUSE 2                           | [fynixOffice-0.6.101.AppImage](https://github.com/rindah89/fynixOffice/releases/download/v0.6.101/fynixOffice-0.6.101.AppImage)     |

All builds come from `main`; the macOS and Windows installers are signed.
Older versions are on the [Releases](https://github.com/rindah89/fynixOffice/releases) page.

### Installing on Linux

The deb installs with apt — it pulls in the dependencies and adds fynixOffice
to the applications menu:

```bash
sudo apt install ./fynixoffice_0.6.101_amd64.deb
```

On Fedora / RHEL-family / openSUSE, install the rpm instead:

```bash
sudo dnf install ./fynixoffice-0.6.101.x86_64.rpm     # Fedora / RHEL family
sudo zypper install ./fynixoffice-0.6.101.x86_64.rpm  # openSUSE
```

The AppImage instead runs in place: install the FUSE 2 runtime
(`sudo apt install libfuse2`; on Ubuntu 24.04 the package is `libfuse2t64`),
make the file executable, then run it:

```bash
chmod +x fynixOffice-0.6.101.AppImage
./fynixOffice-0.6.101.AppImage
```

## Apps

| App             | Product                | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/docs`     | **fynixOffice Docs**     | `.docx` word processor. Byte-preserving round trip: only dirty paragraphs are regenerated (paragraph patch), everything else in the original file is kept byte-for-byte, so opening and saving never breaks layout in Word. Paginated view whose line metrics reproduce the original document's layout, tracked changes, comments, styles, equations, ink.                                                                                                                                                                                                      |
| `apps/sheets`   | **fynixOffice Sheets**   | `.xlsx` spreadsheet. UI built on the open-source [Univer](https://github.com/dream-num/univer) core (Apache-2.0) with a large layer of in-house extensions; `.xlsx` import/export runs through an in-house Rust sidecar (calamine + IronCalc), charts are rendered in-house (Konva), plus pivot tables, slicers, conditional formatting, and formula tracing.                                                                                                                                                                                                   |
| `apps/slides`   | **fynixOffice Slides**   | `.pptx` presentations. In-house `.pptx` parse/render/edit engine with masters, charts, cropping, ink, and text shaping (HarfBuzz metrics).                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/pdf`      | **fynixOffice PDF**      | `.pdf` viewer/editor on [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0) + [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT): annotations, forms, outlines, stamps, signatures, page operations, and printing support. True text editing — paragraph selection with in-block reflow, alignment restoration, original-font preservation — and content-stream image insert/edit, all rewriting page content streams through [PDFium](https://pdfium.googlesource.com/pdfium/) wasm (BSD-3-Clause) with subset-embedded fonts — no cover-up annotations. |
| `apps/markdown` | **fynixOffice Markdown** | `.md` / `.markdown` editor: Tiptap block editor over plain Markdown files — headings, lists, tables, images, code blocks — saved back as plain Markdown, hosted in shell tabs.                                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/shell`    | **fynixOffice**          | The suite shell: home screen, tabbed hosting of the five editors, light/dark/system theme, auto-update, `fynixoffice://` deep links.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/office-server` | **office-api**      | Suite BFF (Docker): Keycloak SSO, open tickets, AI proxy. Not a browser Office UI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

Every app embeds the same AI panel: block-granular AI editing with version
snapshots and diffs in docs, a tool-calling agent over workbook/slide/PDF
state in the others.

The whole suite ships light / dark / system UI themes built on shared design
tokens (`packages/ui`), with a CI guard that keeps chrome colors on the token
system. Document surfaces stay light in dark mode — Word-style dark chrome
around white paper — so files render and export identically in both themes.

**AI backend (Fynix suite).** Desktop signs in via Fynix suite SSO (Keycloak
through the Office server BFF). Opaque session tokens stay local; vendor API
keys never leave the server (`OFFICE_LLM_*`). There is no per-user credit wallet
or billing UI. Inference streams through `POST /ai/stream` on
`apps/office-server`.

## Fynix suite integration

fynixOffice is the **desktop editor** for the Fynix suite. DocFlow and Finance
stay web systems of record; staff open real `.docx` / `.xlsx` files in Office
via deep links.

| Topic | Doc |
|-------|-----|
| Overview & index | [docs/fynix-suite/README.md](docs/fynix-suite/README.md) |
| Architecture (desktop vs server) | [docs/fynix-suite/architecture.md](docs/fynix-suite/architecture.md) |
| Docker deploy on Linux | [apps/office-server/DEPLOY.md](apps/office-server/DEPLOY.md) |
| DocFlow → Word / Finance → Excel | [apps/office-server/SUITE-OPEN.md](apps/office-server/SUITE-OPEN.md) |
| DNS, Caddy, Vercel | [docs/fynix-suite/dns-and-hosting.md](docs/fynix-suite/dns-and-hosting.md) |
| office-server API & env | [apps/office-server/README.md](apps/office-server/README.md) |

**Deploy split:** run `office-api` in Docker on the suite host; install the
Electron app on workstations. You do **not** host the full Word/Excel UI on
Vercel — only suite web products (e.g. Finance) may live there; Office API DNS
points at the suite edge.

```bash
# Server (suite host)
npm run dev:server   # or docker compose -f apps/office-server/docker-compose.yml ...

# Desktop (dev)
export OFFICE_SERVER_URL=http://localhost:4321
npm run dev
```

## Engine packages

All pure TypeScript, no Electron dependency, unit-tested (except the UI kit):

- `packages/docx-engine` — docx parsing → block tree (with `docxIndex`
  anchors and passthrough), OOXML fragment generation, byte-level paragraph
  patching.
- `packages/pptx-engine` / `packages/pptx-render` — pptx model and rendering.
- `packages/file-parse` — text extraction for AI attachments (office formats,
  text formats).
- `packages/agent-core` — the AI agent loop and skill composition shared by
  every app.
- `packages/ai-provider` — provider abstraction and streaming for the model
  backends.
- `packages/suite-auth` — desktop client for suite SSO sessions.
- `packages/ai-search` — optional legacy search/tools helpers.
- `apps/office-server` — suite BFF (Keycloak SSO + AI stream proxy).
- `packages/i18n`, `packages/ui`, `packages/project-store`,
  `packages/electron-utils` — shared i18n core, React UI kit, recent-files
  store, and Electron main-process helpers.

## Development

```bash
npm install
npm run fixtures     # generate test .docx fixtures
npm test             # engine + app unit tests (docs/sheets/slides need no display)
npm run typecheck    # tsc --noEmit across every workspace
npm run dev          # all five editors + shell against Vite dev servers
npm run dev:server   # office-server BFF (suite SSO / tickets / AI) on :4321
npm run dev:docs     # a single app (same pattern works per workspace)
npm run dist:mac     # package macOS dmg (regenerates third-party notices)
npm run dist:win     # package Windows nsis installer
npm run dist:linux   # package Linux AppImage + deb + rpm
```

The sheets app additionally needs a Rust toolchain for its xlsx sidecar
(`cargo` on PATH); `npm run build -w @fynixoffice/sheets` compiles it
automatically.

Local UI/e2e driver scripts (Playwright + Electron, for local acceptance, not
committed by default) live in [`scripts/drivers/`](scripts/drivers/README.md).

## Architecture notes (docx round trip)

```
open docx ─► archive original by hash (never touched)
          ─► docx-engine parses word/document.xml top-level elements (w:p / w:tbl / …)
          ─► Block tree, each block anchored by docxIndex + original XML slice
          ─► Tiptap streaming editor (manual + AI editing, dirty tracking)
save      ─► dirty blocks → OOXML fragments (referencing existing styles only)
          ─► splice into original document.xml (untouched blocks keep original bytes)
          ─► repack zip; all other entries copied byte-for-byte
```

The same philosophy holds in sheets and slides: the original file is the
source of truth, edits are applied as narrow patches, and everything the
editor didn't touch survives the round trip untouched.

## FAQ

**Is fynixOffice free?**
Yes. fynixOffice is free and open-source under the Apache-2.0 license — no
trial, no paid tier for the apps themselves.

**Can fynixOffice open Microsoft Word, Excel, and PowerPoint files?**
Yes. fynixOffice opens and saves native `.docx`, `.xlsx`, and `.pptx` files.
Saving is byte-preserving: parts of the file you didn't touch are written
back byte-for-byte, so documents keep working in Microsoft Office.

**Does fynixOffice work offline?**
Document editing is fully local — files never leave your machine to be
opened, edited, or saved. Suite sign-in, open-from-DocFlow/Finance, and AI
need a network connection to `office-server` (and Keycloak / your LLM
provider).

**Do users install an app or open a website?**
**Editing** uses the **desktop app**. The **server** hosts SSO, file open
tickets, and AI — not a full online Word/Excel. See
[docs/fynix-suite/architecture.md](docs/fynix-suite/architecture.md).

**Can DocFlow open a document in Word / Finance open a report in Excel?**
Yes — via open tickets and `fynixoffice://` deep links. See
[apps/office-server/SUITE-OPEN.md](apps/office-server/SUITE-OPEN.md).

**Do we configure Office DNS on Vercel?**
Only if a *web* suite product (e.g. Finance) already uses Vercel for *its*
hostname. The `office.` API hostname should point at the suite Docker edge,
not at Vercel. See
[docs/fynix-suite/dns-and-hosting.md](docs/fynix-suite/dns-and-hosting.md).

**Can fynixOffice edit PDF files?**
Yes — real PDF text and image editing that rewrites the page content stream
with the original fonts preserved, not cover-up annotations.

## Security

See [SECURITY.md](SECURITY.md) for the process security posture (renderer
sandboxing, IPC validation, external-link gating) and the threat models for
AI-generated content.

## Acknowledgements

fynixOffice would not be possible without these open-source projects:

- [Electron](https://www.electronjs.org/) — the desktop runtime for every app.
- [Univer](https://github.com/dream-num/univer) (Apache-2.0) — the spreadsheet
  UI core that Sheets extends.
- [PDFium](https://pdfium.googlesource.com/pdfium/) (BSD-3-Clause, bundled via
  [@embedpdf/pdfium](https://github.com/embedpdf/embed-pdf-viewer)) — the
  content-stream engine behind true PDF text and image editing.
- [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0) and
  [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT) — PDF rendering and
  document assembly.
- [Tiptap](https://tiptap.dev/) / [ProseMirror](https://prosemirror.net/) —
  the block editors in Docs and Markdown.
- [Konva](https://konvajs.org/) — canvas rendering for Slides and Sheets
  charts.
- [HarfBuzz](https://github.com/harfbuzz/harfbuzz) (wasm) — text-shaping
  metrics for complex scripts.
- [calamine](https://github.com/tafia/calamine) and
  [IronCalc](https://github.com/ironcalc/IronCalc) — the read and calc layers
  of the Rust xlsx sidecar.
- Liberation, Carlito, Caladea, and Noto CJK fonts (OFL/Apache-2.0) — bundled
  document fonts.

## Third-party notices

`npm run notices` regenerates the bundled third-party license summary
(`tools/gen-third-party-notices.mjs`); all runtime dependencies are
MIT/Apache-2.0/BSD-3-Clause/OFL, and the bundled fonts (Liberation, Carlito,
Caladea, Noto CJK subsets) are OFL/Apache.

## License

fynixOffice is licensed under the [Apache License 2.0](LICENSE), with one
exception: the `ee/` directory is reserved for future enterprise modules and
is covered by the [fynixOffice Enterprise License](ee/LICENSE).

The Genspark name and logo are trademarks of Mainfunc, Inc. The Apache-2.0
license does not grant permission to use them (see section 6).
