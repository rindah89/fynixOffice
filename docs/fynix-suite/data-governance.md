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
