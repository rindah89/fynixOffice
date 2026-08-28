# Data governance reporting

fynixOffice publishes a signed daily governance statement to Cyber Audit. The statement covers all twelve suite controls and reports known gaps as `partially_effective`; the publisher does not convert missing evidence into a passing result.

## Configure

Set these values in the scheduler's secret store:

- `OFFICE_GOVERNANCE_ENDPOINT`: Cyber Audit `/api/suite/governance/evidence` HTTPS URL.
- `OFFICE_GOVERNANCE_TENANT_ID`: tenant binding issued by Cyber Audit.
- `OFFICE_GOVERNANCE_WEBHOOK_ID`: Office webhook binding issued by Cyber Audit.
- `OFFICE_GOVERNANCE_SECRET`: unique secret of at least 32 characters, shared only with Cyber Audit.

Run `npm run governance:publish` once and confirm a `recorded` receipt. Schedule that command at least once every 24 hours; Cyber Audit marks Office stale after its configured freshness window. Failed delivery must fail the scheduled job so operations monitoring can alert.

Rotate the secret by updating the Office scheduler and the matching `office` binding in Cyber Audit during the same maintenance window. Never reuse the secret assigned to another Fynix application.

## Verify

Run:

```bash
npm run typecheck -w @fynixoffice/governance
npm run test -w @fynixoffice/governance
```

In Cyber Audit, confirm that **Suite Data Governance** shows Office as current and review every generated exception for an owner and due date.
