# Aplyd Genie Workflow Catalogue

Version 1.2 | 6 November 2026 | User-triggered workflows only

## Execution contract

Each workflow captures user/tenant, source versions, required inputs, allowed tools, bounded planning, validated proposal, approval policy, per-action execution receipts and recovery behavior. Tool access never exceeds user permissions. Bounds below are proposed starting limits and require evaluation. Clarification is not permission to mutate.

| Workflow | Source stories | Output | Approval |
|---|---|---|---|
| WF-01 Summarize current content | DOC-201, MAIL-201, CTX-101 | Source-linked summary | None for authorized reads |
| WF-02 Notes to tasks | DOC-202, PROJ-202, AGENT-301 | Linked project tasks | Exact task preview |
| WF-03 Tasks to focus blocks | CAL-201, CAL-202 | Task-linked calendar blocks | Exact block preview |
| WF-04 Email to tasks | MAIL-203, PROJ-202 | Tasks linked to thread | Exact task preview |
| WF-05 Project update draft | PROJ-204, MAIL-202, MAIL-204 | Editable email draft | Requested private draft; manual send |
| WF-06 Notes to tasks and review | DOC-202, PROJ-202, CAL-203 | Tasks and approved event | Combined preview including invitees |

## WF-01 Summarize current content

**Trigger:** “Summarize this.” Required: verified selected content or current resource. Tools: read that source only. Initial bounds: one source, 6,000 input tokens including instructions/context and 1,000 output tokens; one generation. If the source does not fit, ask for a narrower section rather than silently claiming full coverage. Return scope and source reference. No mutation or approval is needed. Access failure returns a clear error without leaking source metadata.

**Acceptance:** correct selected source; no invented facts; inaccessible source denied; oversized source narrowed; prompt injection cannot trigger tools outside the read contract.

## WF-02 Notes to tasks

**Trigger:** “Turn these notes into tasks for next week.” Required: source and destination project. Resolve eligible owners and dates only where supported by explicit instruction/context. Tools: read source, find authorized projects/members, create tasks. Initial bounds: 10 tasks; 6,000 total input tokens; 2,000 output tokens; one planning generation and at most one schema-repair generation. Preview each title, description, owner and due date. User can edit or remove items. Approval is bound to exact plan version.

Execute creation using deterministic services and stable operation keys. Link source where permitted. Do not create calendar events. Recheck permissions and relevant source assumptions. On partial failure, retain successful tasks and offer retry of failed operations only.

**Acceptance:** unresolved project clarified; owner ambiguity clarified; exact preview; changed source detected; duplicate retry safe; partial success reported accurately.

## WF-03 Tasks to focus blocks

**Trigger:** “Plan time for these tasks next week.” Required: authorized task set, calendar, date range, durations and timezone. Tools: read tasks, query availability, create personal blocks. Initial bounds: five blocks; 6,000 input and 2,000 output tokens; one planning and at most one repair generation. Show exact times, calendar and linked tasks. Approval required. Recheck availability before creation; conflicts return a revised proposal requiring renewed approval. No attendees are added unless a separately approved event contract permits it.

**Acceptance:** timezone boundaries correct; missing duration clarified; private blocks distinct from invitations; concurrent conflict detected; completed blocks not repeated on retry.

## WF-04 Email to tasks

**Trigger:** “Track these commitments.” Required: one authorized email thread and destination project. Tools: read thread, resolve project/members, create tasks. Initial bounds: five tasks; 6,000 input and 2,000 output tokens; one planning and at most one repair generation. Distinguish actual commitments from suggestions. Show exact fields and source reference. Approval required. Unresolved recipients or owners are not guessed. Retry only failed mutations.

**Acceptance:** thread boundaries respected; proposed owners verified; no unauthorized attachments loaded; exact approval; duplicate-safe task creation.

## WF-05 Project status to email draft

**Trigger:** “Draft a client update.” Required: project, reporting period and verified recipient. Tools: read authorized project/task facts, create one draft. Initial bounds: one project and one draft; 6,000 input and 2,000 output tokens; one generation and at most one repair generation. Private draft creation follows the explicit request; sending remains manual. Keep recipient and reporting period visible. If provider save fails, preserve generated draft content and report that it was not saved. Reconcile unknown provider outcomes before retry.

**Acceptance:** supported project claims; recipient clarified when ambiguous; one editable draft; zero sends; provider failure not shown as successful save.

## WF-06 Notes to tasks and review event

**Trigger:** “Create follow-ups and schedule a review.” Required: source, project, date range, event duration, calendar and attendee identities. Tools: WF-02 tools plus availability query and event creation. Initial bounds: 10 tasks and one event; 8,000 input and 3,000 output tokens; one planning and at most one repair generation. Runtime/model context must support these limits; otherwise narrow the source before dispatch. Show a combined preview with separate task and invitation consequences. Approval required.

Do not assume a cross-service transaction. Execute ordered steps with per-step receipts. On event failure after task success, retain and report the tasks. Retry the event after current availability/access checks. Replanning material changes requires approval again.

**Acceptance:** all required inputs resolved; approved invitee list exact; partial completion truthful; no duplicate tasks/events after recovery; permission revocation blocks remaining operations.

## Unsupported and future workflows

Requests outside these contracts receive clarification or a supported alternative. No unrestricted agent loop is used as a fallback. External sending, destructive operations, bulk mutation and recurring automation need separate product contracts. Adding a workflow requires stories, tools, limits, approval rules, recovery behavior and evaluation cases.
