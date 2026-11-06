# Aplyd Genie Product Vision

Version 1.2 | 6 November 2026 | Product definition baseline

## Vision

Aplyd Genie enables people to operate Aplyd Suite by expressing the outcome they want. Users can ask for work from their current application, review consequential changes, and receive verified results across connected applications.

For example, a user reading meeting notes asks: “Turn these notes into tasks for next week and propose a review meeting.” Genie identifies the source, resolves the project and dates, proposes tasks and an event, and executes only the approved actions. Every created resource links back to the source where access permits.

## User value

- Contributors transfer less information between tools and spend less time recording follow-ups.
- Managers turn discussions into accountable tasks and schedules.
- Business owners gain connected workflows and common administration.
- Engineers maintain a shared platform with explicit application contracts.

## Economic objective

Build reusable software assets and reduce average cost per useful workflow within measured capacity bands. Application hosting, storage, backups, GPU usage, support, and engineering remain real costs. The $120 monthly application-server target is not a total operating-cost guarantee.

Earlier planning ranges of $300–750 monthly for 100 daily active users and $1,000–2,500 for 500 daily active users are unvalidated estimates based on short workflows, smaller suitable models, and bounded usage. They exclude salaries, taxes, hosted mailboxes, and high availability. They are not approved budgets or measured capacity evidence. A large model is selected only when its quality gains justify cost.

## Product principles

1. Application context is verified server-side.
2. Models propose actions; application services authorize and execute them.
3. Users see the difference between a proposal and a completed mutation.
4. Ambiguous resources, people, and dates require clarification.
5. External communication and destructive operations need explicit authorization.
6. Core applications continue operating during inference outages.
7. Workflows have context, action, runtime, and cost limits.
8. Automated changes have provenance and recovery information.

## Scope

The initial functional domains are Documents, Projects, Calendar, and Email. Existing suite products may supply these domains; connector readiness and exact API mappings require verification. Four further application integrations require definition rather than invented capabilities.

Start with document-to-task creation. Extend to approved scheduling, email summaries and drafts, and authorized workspace search. Defer unrestricted autonomy, automatic external sending, arbitrary code execution, and broad eight-application feature parity.

## Success

The primary measure is correct, user-intended workflow completion per active user. Supporting measures are context accuracy, correction and reversal rates, time saved, cost per successful workflow, queue latency, and engineering support hours. Unauthorized reads or mutations are release-blocking failures.
