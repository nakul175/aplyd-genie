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
- [Live tracker traceability](docs/TRACEABILITY.md)
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
| Staging hostname | staging.genie.aplyd.org |

Production and staging use the confirmed Genie spelling. DNS registration does not establish application deployment, routing, TLS readiness, or release acceptance.

## Status

Product definition and tracker import complete: 21 epics, 90 stories and 270 linked acceptance cases. **GENIE-2 / PLAT-101 is implemented and accepted on [staging](https://staging.genie.aplyd.org)**: 47 local tests and all three live acceptance cases passed. See [acceptance evidence](evidence/genie-2/staging/ACCEPTANCE.md) and [development packet](docs/development/GENIE-2-SUITE-SIGN-IN.md). The remaining stories have not started. The current workspace is a sign-in foundation; concierge conversations, model inference and cross-app execution are later work. Four additional suite applications still require an explicit scope mapping.

Existing schedules and heartbeat automations remain paused. No recurring work is authorized by this repository setup.

## Development

Use Node.js 24 and `npm ci --ignore-scripts`, then `npm test`. Copy `.env.example` to an untracked `.env` and supply reviewed credentials and a dedicated PostgreSQL database before `npm run migrate` and `npm start`. The listener binds to loopback; public use requires a reviewed HTTPS reverse proxy. No model provider is called by this first story.
