# Aplyd Genie System and Operating Specification

## Architecture

Applications → authenticated Express gateway → context resolver and admission control → PostgreSQL-backed durable queue → orchestration worker → authenticated Modal ingress → bounded open-weight inference → validated plan → approval → application tools → audit and status events.

Use a modular application architecture and separate worker process. Do not split all applications into independently operated microservices solely for Genie. Hosting-specific inference code stays behind an adapter; prompts, tool contracts, evaluations and business rules remain portable.

## Service contracts

The gateway returns 202 with a persisted workflow ID. Status is available through authenticated polling or server-sent events. Requests use existing session identity; inference credentials never reach the browser. No database connection or transaction stays open during inference.

Each tool declares input/output schemas, permission requirements, risk level, idempotency policy, timeout, retry class, resource-version behavior, and audit fields. All mutations flow through normal application services. No generated SQL or arbitrary code tools are allowed.

## Workflow state

Received → Queued → Planning → Awaiting Approval → Executing → Completed. Alternative terminal states: Partially Completed, Failed, Cancelled, Expired. Each action records stable operation ID, idempotency key, attempts, result references and compensation availability. Cancellation cannot promise reversal of completed operations.

Cross-application execution is not assumed atomic. Reconcile uncertain external outcomes before retry, preserve successful steps, and offer targeted recovery. Approval expires on material plan edits, relevant source conflicts or policy-defined timeout.

## Inference

Use asynchronous inference and bounded batching. Evaluate a smaller open-weight model before selecting a large model. Pin model revisions and dependencies. Set scale-to-zero, maximum replicas, context/output limits, deadlines and retry budgets. Cold-start wait is distinct from generation runtime. Model output must validate against registered action schemas.

A four-GPU replica multiplied by fifteen replicas means sixty GPUs. GPU quotas, peak demand, cost reservations, and user-visible waiting policies must be designed together. No infrastructure deployment is authorized merely by this specification.

## Two-person ownership

| Area | Platform engineer | AI and reliability engineer |
|---|---|---|
| Identity, permissions, schema, tools | Primary | Integration review |
| Application UX and resource context | Primary | Planning requirements |
| Model serving, routing, evaluation | Review | Primary |
| Queue and recovery | Shared | Primary orchestration |
| Budget controls and attribution | Shared | Primary |
| Deploy and restore | Primary | Backup operator |

Both engineers can disable inference, deploy, rotate secrets and restore service. Cross-review authorization, migrations and consequential action changes. Product owner approves priorities and spending envelopes. No continuous staffed support is implied.

## Release verification

Use focused workflow, authorization and integration tests during implementation. Stable releases require representative model evaluations, cross-tenant negative tests, retry/restart tests, context-conflict tests, prompt-injection cases, quota exhaustion, GPU unavailability and restore evidence. Validate ordinary application performance while AI is saturated. Keep logs redacted and distinguish measured results from targets.

Schedules and heartbeat automations remain paused. Workflows here are user-triggered; recurring automation requires a separate explicit user request.
