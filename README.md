# Aplyd Genie

Your AI concierge across Aplyd.

Aplyd Genie helps users complete bounded, authorized workflows across Aplyd Suite. It understands the current application context, proposes concrete actions, and coordinates execution through existing application services.

## Product specifications

- [Product vision](docs/PRODUCT-VISION.md)
- [Product requirements](docs/PRD.md)
- [Epics and detailed user stories](docs/EPICS-AND-USER-STORIES.md)
- [Workflow catalogue](docs/WORKFLOWS.md)
- [Context and retrieval](docs/CONTEXT-AND-RETRIEVAL.md)
- [System and operating specification](docs/SYSTEM-SPECIFICATION.md)
- [Structured backlog](docs/backlog.json)
- [Product registration and DNS receipts](ops/SETUP-STATUS.md)

## Product identity

| Field | Value |
|---|---|
| Product name | Aplyd Genie |
| Short assistant name | Genie |
| Repository | https://github.com/nakul175/aplyd-genie |
| BTF project | https://backlogtothefuture.aplyd.org/aplyd/GENIE |
| Production hostname | genie.aplyd.org |
| Staging hostname | staging.ginie.aplyd.org |

The staging spelling is intentionally preserved from the user's explicit request. DNS registration does not establish application deployment, routing, TLS readiness, or release acceptance.

## Status

Product definition baseline. Runtime implementation is not included. Existing application functionality is an integration prerequisite, not a claim that Genie implements or replaces those applications. Four additional suite applications still require an explicit scope mapping.

Existing schedules and heartbeat automations remain paused. No recurring work is authorized by this repository setup.
