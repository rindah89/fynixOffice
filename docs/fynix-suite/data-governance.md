# Data governance reporting

fynixOffice publishes a signed daily governance statement to Cyber Audit. The statement covers all twelve suite controls and reports known gaps as `partially_effective`; the publisher does not convert missing evidence into a passing result.

## User responsibilities

- Keep sensitive documents in their approved workspace and classification. Opening a file in fynixOffice does not change the owning application's access rules.
- Use opaque subject and document references in governance records. Never enter a name, email address, token, local file path, or signed download URL.
- Use controlled `urn:fynix:` or `evidence://` references for evidence. A recorded receipt confirms submission, not certification.
- Do not delete, anonymise, archive, overwrite, or purge a file covered by a legal hold.
- Record disposition only after the retention period has elapsed and the owning application has completed the actual source action.
- Processor entries remain pending until independent review. Restore evidence must describe a completed drill and cannot be future-dated.

Cyber Audit reports overdue privacy requests, active legal holds, pending processor reviews, disposition receipts, stale statements, and open exceptions. Assign an owner and due date to every exception. Do not mark a control effective solely because a command or statement was accepted.

## Privacy access requests

After verifying the requester, an authorized privacy operator can produce an owner-only JSON access export with `npm run privacy:export -w @fynixoffice/governance`. Configure `OFFICE_USER_DATA_DIRS` as a JSON object that names every installed Office application and its Electron user-data directory, for example `{"docs":"/controlled/docs-data","slides":"/controlled/slides-data"}`. The command fails if the manifest is empty or malformed, opens the request in Cyber Audit, and records the completed export's SHA-256 digest.

The export contains Office settings, recent-item metadata, project metadata, and local AI chat history from the declared application roots. API keys, passwords, tokens, and credentials are redacted. Document, spreadsheet, and presentation file contents are excluded because their owning workspace must apply its own access, classification, retention, and legal-hold rules. Deliver the export only through the approved privacy channel; never attach it to a support ticket.

Set `OFFICE_PRIVACY_SUBJECT` to the requester's canonical opaque UUID, `OFFICE_PRIVACY_IDENTITY_EVIDENCE_REF` to a controlled `urn:fynix:` or `evidence://` reference, and `OFFICE_PRIVACY_OUTPUT` to a new protected path. The command never overwrites an existing export. Access export is implemented, but DG-03 remains partial until Office also provides governed correction, restriction, objection, and erasure workflows across every local data surface.

Report every Office hosting, update, crash-reporting, AI, conversion, signing, and collaboration processor plus its processing countries before enabling it. Keep the complete deployment inventory in a protected JSON file containing exactly the processor name, purpose, non-empty data categories, non-empty processing countries, transfer mechanism or `null`, agreement owner, controlled agreement evidence reference, its lowercase SHA-256 digest, and review due timestamp. Configure `OFFICE_PROCESSOR_INVENTORY_FILE` and `OFFICE_GOVERNANCE_CONTROL_ENDPOINT`. Office validates and synchronizes every entry before it may report DG-11 effective. Cyber Audit recording is intake, not approval; independent entry review and exact-register certification remain required. Additions, removals, agreement changes, and transfer changes invalidate the former certification.

## Configure

Set these values in the scheduler's secret store:

- `OFFICE_GOVERNANCE_ENDPOINT`: Cyber Audit `/api/suite/governance/evidence` HTTPS URL.
- `OFFICE_GOVERNANCE_TENANT_ID`: tenant binding issued by Cyber Audit.
- `OFFICE_GOVERNANCE_WEBHOOK_ID`: Office webhook binding issued by Cyber Audit.
- `OFFICE_GOVERNANCE_SECRET`: unique secret of at least 32 characters, shared only with Cyber Audit.

Run `npm run governance:publish` once and confirm a `recorded` receipt. Schedule that command at least once every 24 hours; Cyber Audit marks Office stale after its configured freshness window. Failed delivery must fail the scheduled job so operations monitoring can alert.

For an approved control operation, set `OFFICE_GOVERNANCE_COMMAND` and `OFFICE_GOVERNANCE_PAYLOAD` for the same command. Keep command JSON out of shell history when it contains operational references, and never include personal data or credentials.

Rotate the secret by updating the Office scheduler and the matching `office` binding in Cyber Audit during the same maintenance window. Never reuse the secret assigned to another Fynix application.

## Verify

Run:

```bash
npm run typecheck -w @fynixoffice/governance
npm run test -w @fynixoffice/governance
```

In Cyber Audit, confirm that **Suite Data Governance** shows Office as current and review every generated exception for an owner and due date.

fynixOffice edits local user files and does not centrally own their retention schedule, legal holds, privacy register, processor inventory, or backup service. Those controls must remain `partially_effective` until an owning service implements and evidences them. Local safe-save and crash recovery are not organization backup or restore-drill proof.
