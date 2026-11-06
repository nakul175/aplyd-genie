# Aplyd Genie Product Requirements

Version 1.2 | 6 November 2026 | Proposed requirements, not implementation evidence

## Product outcome

Genie coordinates bounded work across Aplyd Suite from one persistent interface. The first release converts selected document notes into reviewed, linked project tasks, with durable execution and accurate results.

## Personas

| Persona | Job to be done |
|---|---|
| Contributor | Convert information into actionable work without repeated entry |
| Manager | Coordinate owners, deadlines, progress, and follow-ups |
| Team lead | Understand decisions, risks, and blockers from accessible records |
| Workspace administrator | Control permissions, retention, usage, and spending |
| Operator | Maintain dependable workflows with a two-person engineering team |

## Requirements

| ID | Requirement | Release |
|---|---|---|
| FR-01 | Persistent Genie interface across supported applications | R1 |
| FR-02 | Verified user, tenant, resource, selection, version, timezone, capabilities | R1 |
| FR-03 | Registered workflow routing with focused clarification | R1 |
| FR-04 | Concrete editable preview, version-bound approval, current authorization | R1 |
| FR-05 | Durable jobs, idempotent actions, per-step results, targeted recovery | R1 |
| FR-06 | Read-only summaries and approved document-to-task creation | R1 |
| FR-07 | Availability queries and approved task-linked calendar events | R2 |
| FR-08 | Authorized thread summaries and email draft creation | R3 |
| FR-09 | Keyword and evaluated semantic retrieval with current ACLs | R4 |
| FR-10 | Tenant quotas, budget reservations, usage reports, inference kill switch | R1 foundations; R4 reporting |
| FR-11 | Editable preferences and retention/deletion of derived content | R4 |
| FR-12 | Explicit capability contracts for four additional applications | R5 |

## Reference journey

1. User selects meeting notes and asks for next week's tasks.
2. Genie captures the document and version and resolves the destination project.
3. Missing or ambiguous required information triggers a focused question.
4. User reviews proposed task fields and can edit or remove items.
5. Approval is bound to the exact plan version.
6. Services recheck permissions and source assumptions and create the tasks.
7. Results contain actual task links and any unresolved steps.

Task deadlines do not automatically authorize calendar blocks. Invitations, sending, deletion, and access changes require separate explicit authorization and supported tools.

## Approval matrix

| Operation | Default policy |
|---|---|
| Read/summarize accessible content | Immediate |
| Create private proposals/drafts | Immediate when explicitly requested |
| Create or update tasks | Preview and approve |
| Create calendar blocks or events | Preview and approve |
| External invitations | Explicit approval including recipients |
| Send email | Excluded from initial agent capability set |
| Delete, bulk mutate, change access | Excluded initially; separately specified later |

## Service targets

Targets apply to agreed test workloads, not every request. Application APIs: proposed p95 ≤500 ms. Concierge admission: p95 ≤1 second. Warm short planning: proposed p95 ≤15 seconds. Cold starts show a queue state and enforced expiry. Accepted work survives worker/API restarts. AI failure does not block manual application operation.

Start recovery objectives at RPO ≤24 hours and RTO ≤4 hours, subject to an actual restore exercise. A single Droplet is not high availability.

## Capacity and economics

Measure connected users, active API traffic, collaboration sockets, inference arrival rate, queue wait, generation concurrency, and background work separately. Admit 100, then 250, then 500 users only after representative mixed-load, burst, recovery, security, and budget tests. Do not interpret user count as model concurrency.

Bound context size, generated output, actions, model calls, retries, queue depth, and replicas. Reserve estimated inference cost before dispatch, reconcile actual usage, and retain safety headroom for in-flight work. A container cap limits instantaneous exposure, not monthly spend.

## Delivery gates

| Release | Scope | Exit evidence |
|---|---|---|
| R1 | Identity, context, durable jobs, summaries, document-to-tasks | Correct authorized creation; duplicate/restart/revocation tests |
| R2 | Calendar and combined review workflow | Timezone, conflict, invitation and partial-failure tests |
| R3 | Connected email and draft workflows | Recipient, mailbox isolation, provider retry tests |
| R4 | Retrieval, preferences, reporting | ACL/deletion/index freshness and cost evidence |
| R5 | Additional applications and bounded delegation | Explicit app contracts and workflow evaluations |

## Out of scope

Unrestricted agent loops; arbitrary SQL/shell tools; automatic external sending; model-generated authorization; proprietary per-token API dependency; guarantees that serverless is always cheapest; assumed completion of existing application features.

## Open product decisions

Name the other four integration applications; map existing product APIs to functional domains; verify existing application readiness; define internal versus customer tenancy; approve a monthly operating allowance; confirm email provider scope; approve retention and support commitments. Production and staging DNS hostnames do not imply an approved application release.
