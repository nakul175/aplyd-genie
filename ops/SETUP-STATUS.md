# Aplyd Genie Product Setup

6 November 2026

## Product registration

- Product: Aplyd Genie.
- Public Git repository: https://github.com/nakul175/aplyd-genie . Public contents and history were explicitly approved by the user.
- BTF project: https://backlogtothefuture.aplyd.org/aplyd/GENIE . Dedicated Epic and User Story types are configured.
- BTF product baseline: https://backlogtothefuture.aplyd.org/aplyd/GENIE/docs/225 .
- Bug Off project: https://bugoff.aplyd.org/en-US/projects/overview/7 .
- Bug Off documentation: https://bugoff.aplyd.org/en-US/projects/documentation/7 .

## Live backlog and acceptance coverage

All 21 epics and 90 stories are imported into BTF in Backlog. Every story is a native child of its epic and contains its three original acceptance criteria. All 270 corresponding cases are imported into 21 Bug Off folders in Draft, with 810 ordered manual steps and per-step expected results. Each case contains its exact acceptance criterion and BTF story backlink. BTF stories have their three direct case links; epics link to their Bug Off folders.

See [live traceability](../docs/TRACEABILITY.md), [structured mappings](../evidence/tracker-import-map.json), and persisted-export verification reports under evidence. No product tests were executed and no implementation is claimed.

Five extra coverage notes were found during export verification. Consolidation is awaiting explicit user approval after automatic review rejected editing the existing notes. These notes do not duplicate issues or test cases or remove any required link.

## DNS

| Host | Target | TTL |
|---|---|---|
| genie.aplyd.org | 168.144.144.69 | 600 seconds |
| staging.genie.aplyd.org | 168.144.144.69 | 600 seconds |

The corrected staging record was verified at both authoritative nameservers. The former misspelling returned NXDOMAIN. DNS does not establish a running Genie application, configured route, TLS readiness or release acceptance.

## Credentials and schedules

A temporary BTF API key was approved as an optional import method, but none was created: the import used the existing authenticated UI. No new credentials need revocation. Existing schedules and heartbeat automations remain paused. No recurring work, GPU allocation or application deployment was performed.
