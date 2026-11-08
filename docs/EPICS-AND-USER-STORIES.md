# Aplyd Genie Epics and Detailed User Stories

Version 1.2 | 6 November 2026

P0 = initial workflow; P1 = next integrations; P2 = later expansion. All stories are imported into BTF in Backlog and have linked Draft / Not run Debug cases. Stable specification IDs remain distinct from actual BTF keys; see [live traceability](TRACEABILITY.md). No implementation or product test execution is claimed. Application prerequisite stories belong to their owning products when implemented and should be linked rather than duplicated.

## Common definition of done

Every released operation requires authorization, validation, observable result/error behavior, relevant acceptance evidence, auditability for mutations and defined retry semantics. No test pass is implied by this specification.

## Epic index

| Epic | Title | Stories | Scope |
|---|---|---:|---|
| PLAT-01 | Identity membership and permissions | 5 | Shared platform prerequisite |
| PLAT-02 | Shared references activity and notifications | 4 | Shared platform prerequisite |
| PROJ-01 | Project and task fundamentals | 6 | Existing application prerequisite; integration mapping required |
| PROJ-02 | Genie project capabilities | 5 | Genie connector |
| DOC-01 | Document fundamentals | 6 | Existing application prerequisite; integration mapping required |
| DOC-02 | Genie document capabilities | 5 | Genie connector |
| CAL-01 | Calendar fundamentals | 5 | Existing application prerequisite; integration mapping required |
| CAL-02 | Genie scheduling | 4 | Genie connector |
| MAIL-01 | Connected mailbox fundamentals | 5 | Existing application prerequisite; mailbox hosting excluded |
| MAIL-02 | Genie email assistance | 4 | Genie connector |
| AGENT-01 | Persistent Genie conversation | 4 | Genie platform |
| AGENT-02 | Bounded workflow routing | 4 | Genie platform |
| AGENT-03 | Approval and execution | 5 | Genie platform |
| CTX-01 | Context selection | 4 | Genie platform |
| CTX-02 | Search retrieval and memory | 4 | Genie platform |
| OPS-01 | Durable workflow jobs | 4 | Genie operations |
| OPS-02 | Budget capacity and reporting | 5 | Genie operations |
| OPS-03 | Quality security and release evaluation | 4 | Genie operations |
| SEC-01 | Security audit and retention | 3 | Genie platform |
| DELEG-01 | Bounded delegation | 2 | Later Genie scope |
| EXT-01 | Additional application onboarding | 2 | Four application identities pending |

## PLAT-01 Identity membership and permissions

**Live epic:** [GENIE-1](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-1) · [Test folder](https://debug.aplyd.org/en-US/projects/repository/7?node=178)

Enforce one verified identity and tenant boundary across applications.

**Ownership scope:** Shared platform prerequisite

**Dependencies:** None declared

### PLAT-101 — P0

**BTF:** [GENIE-2](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-2) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2554) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2555) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2556)

As a user, I can sign in once and access applications available to my membership.

**Acceptance criteria**

- AC1: Session establishes user and active tenant server-side.

- AC2: Disabled membership is rejected at the service boundary.

- AC3: Signing out removes access to protected Genie views.

### PLAT-102 — P0

**BTF:** [GENIE-3](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-3) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2557) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2558) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2559)

As an administrator, I can invite, deactivate and manage workspace members.

**Acceptance criteria**

- AC1: Only authorized administrators can change membership.

- AC2: Deactivation blocks new reads and mutations.

- AC3: Membership changes are auditable.

### PLAT-103 — P0

**BTF:** [GENIE-4](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-4) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2560) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2561) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2562)

As an administrator, I can grant roles with explicit resource and action permissions.

**Acceptance criteria**

- AC1: Read and mutation permissions are distinct.

- AC2: Role changes apply to UI, tools and background execution.

- AC3: A user cannot grant a permission they are unauthorized to manage.

### PLAT-104 — P0

**BTF:** [GENIE-5](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-5) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2563) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2564) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2565)

As a multi-workspace user, I can explicitly switch my active workspace.

**Acceptance criteria**

- AC1: Active workspace is visible.

- AC2: Conversations and resource search remain tenant-scoped.

- AC3: Pending jobs retain their original tenant context.

### PLAT-105 — P0

**BTF:** [GENIE-6](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-6) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2566) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2567) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2568)

As an administrator, I can revoke access before pending actions execute.

**Acceptance criteria**

- AC1: Permissions are rechecked at mutation time.

- AC2: Revoked actions stop without exposing inaccessible content.

- AC3: Denied actions are recorded without sensitive payload leakage.

## PLAT-02 Shared references activity and notifications

**Live epic:** [GENIE-7](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-7) · [Test folder](https://debug.aplyd.org/en-US/projects/repository/7?node=179)

Keep connected work traceable.

**Ownership scope:** Shared platform prerequisite

**Dependencies:** PLAT-01

### PLAT-201 — P0

**BTF:** [GENIE-8](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-8) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2569) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2570) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2571)

As a user, I can follow a generated task to its source document.

**Acceptance criteria**

- AC1: Stable source identifiers are recorded.

- AC2: Following the link checks current access.

- AC3: Inaccessible source titles are not exposed through backlinks.

### PLAT-202 — P0

**BTF:** [GENIE-9](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-9) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2572) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2573) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2574)

As a user, I can distinguish manual changes from Genie actions.

**Acceptance criteria**

- AC1: Activity identifies requester and execution source.

- AC2: Each automated mutation references its workflow.

- AC3: Activity does not imply an unexecuted proposal changed data.

### PLAT-203 — P1

**BTF:** [GENIE-10](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-10) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2575) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2576) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2577)

As a user, I can inspect linked tasks, events and documents.

**Acceptance criteria**

- AC1: Links are visible only under current authorization.

- AC2: Deleted targets have a clear unavailable state.

- AC3: Links use stable resource identifiers.

### PLAT-204 — P1

**BTF:** [GENIE-11](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-11) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2578) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2579) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2580)

As a user, I receive useful workflow completion notifications.

**Acceptance criteria**

- AC1: Notification reflects actual terminal state.

- AC2: Retry does not duplicate the same completion alert.

- AC3: Notification preferences are respected.

## PROJ-01 Project and task fundamentals

**Live epic:** [GENIE-12](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-12) · [Test folder](https://debug.aplyd.org/en-US/projects/repository/7?node=180)

Manage work through dependable application services.

**Ownership scope:** Existing application prerequisite; integration mapping required

**Dependencies:** PLAT-01

### PROJ-101 — P0

**BTF:** [GENIE-13](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-13) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2581) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2582) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2583)

As a member, I can create a project with a name, description and access settings.

**Acceptance criteria**

- AC1: Required fields are validated.

- AC2: Creation respects workspace permissions.

- AC3: Project appears in authorized lists after creation.

### PROJ-102 — P0

**BTF:** [GENIE-14](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-14) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2584) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2585) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2586)

As a member, I can create a task with title, description, status, owner and due date.

**Acceptance criteria**

- AC1: Owner is an eligible member.

- AC2: Date-only deadlines remain distinct from event timestamps.

- AC3: UI and tool requests enforce identical field rules.

### PROJ-103 — P0

**BTF:** [GENIE-15](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-15) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2587) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2588) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2589)

As a member, I can view tasks in list or board views and filter them.

**Acceptance criteria**

- AC1: Filters apply to authorized tasks only.

- AC2: Owner, status and due-date filters compose correctly.

- AC3: Empty and failed states are distinguishable.

### PROJ-104 — P0

**BTF:** [GENIE-16](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-16) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2590) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2591) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2592)

As an owner, I can update and complete a task.

**Acceptance criteria**

- AC1: Invalid transitions are rejected.

- AC2: Concurrent updates do not silently overwrite newer state.

- AC3: Changes retain actor and time.

### PROJ-105 — P1

**BTF:** [GENIE-17](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-17) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2593) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2594) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2595)

As a collaborator, I can comment on tasks and review activity.

**Acceptance criteria**

- AC1: Only authorized collaborators can comment.

- AC2: Activity identifies the actor.

- AC3: Comment failures preserve recoverable user input.

### PROJ-106 — P2

**BTF:** [GENIE-18](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-18) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2596) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2597) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2598)

As a manager, I can define task dependencies and identify blocked work.

**Acceptance criteria**

- AC1: Dependency targets are accessible.

- AC2: Self-dependency and forbidden cycles are rejected.

- AC3: Blocked status is distinguishable from completion status.

## PROJ-02 Genie project capabilities

**Live epic:** [GENIE-19](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-19) · [Test folder](https://debug.aplyd.org/en-US/projects/repository/7?node=181)

Delegate bounded project operations.

**Ownership scope:** Genie connector

**Dependencies:** PROJ-01, AGENT-02, AGENT-03

### PROJ-201 — P0

**BTF:** [GENIE-20](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-20) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2599) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2600) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2601)

As a user, I can ask Genie for overdue or upcoming tasks.

**Acceptance criteria**

- AC1: Queries use current user timezone and ownership scope.

- AC2: Only authorized tasks are returned.

- AC3: Results link to supporting task records.

### PROJ-202 — P0

**BTF:** [GENIE-21](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-21) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2602) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2603) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2604)

As a user, I can review tasks extracted from notes before creation.

**Acceptance criteria**

- AC1: Preview contains exact proposed fields.

- AC2: Unresolved owners or projects require clarification.

- AC3: Created tasks use stable operation keys.

### PROJ-203 — P1

**BTF:** [GENIE-22](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-22) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2605) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2606) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2607)

As a user, I can request a change to a specific task through Genie.

**Acceptance criteria**

- AC1: Ambiguous tasks require clarification.

- AC2: Preview shows affected fields.

- AC3: Execution rechecks current task version and permission.

### PROJ-204 — P1

**BTF:** [GENIE-23](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-23) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2608) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2609) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2610)

As a manager, I can obtain a project summary grounded in accessible tasks.

**Acceptance criteria**

- AC1: Claims have resource references where applicable.

- AC2: Recorded facts are separated from inferred risks.

- AC3: Summary states its reporting period.

### PROJ-205 — P2

**BTF:** [GENIE-24](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-24) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2611) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2612) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2613)

As a manager, I can review updates to several tasks before applying them.

**Acceptance criteria**

- AC1: Batch size is bounded.

- AC2: Each affected task is included in approval.

- AC3: Partial failures identify individual outcomes.

## DOC-01 Document fundamentals

**Live epic:** [GENIE-25](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-25) · [Test folder](https://debug.aplyd.org/en-US/projects/repository/7?node=182)

Create and edit trustworthy source material.

**Ownership scope:** Existing application prerequisite; integration mapping required

**Dependencies:** PLAT-01

### DOC-101 — P0

**BTF:** [GENIE-26](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-26) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2614) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2615) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2616)

As a user, I can create, edit and save a document.

**Acceptance criteria**

- AC1: Save state is visible.

- AC2: Failures do not silently discard input.

- AC3: Document has a stable identifier and version reference.

### DOC-102 — P0

**BTF:** [GENIE-27](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-27) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2617) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2618) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2619)

As a user, I can share a document at supported access levels.

**Acceptance criteria**

- AC1: Only permitted actors change sharing.

- AC2: Read and edit permissions differ.

- AC3: Revocation is enforced by content APIs.

### DOC-103 — P0

**BTF:** [GENIE-28](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-28) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2620) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2621) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2622)

As a user, I can select text for Genie context.

**Acceptance criteria**

- AC1: Selection includes document ID and version.

- AC2: Empty selection is explicit.

- AC3: Submitted selection does not change after navigation.

### DOC-104 — P1

**BTF:** [GENIE-29](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-29) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2623) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2624) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2625)

As a user, I can inspect and recover earlier document content.

**Acceptance criteria**

- AC1: Version access respects current permissions.

- AC2: Restore creates an auditable revision.

- AC3: User can preview the restore target.

### DOC-105 — P1

**BTF:** [GENIE-30](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-30) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2626) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2627) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2628)

As a collaborator, I can comment on document content.

**Acceptance criteria**

- AC1: Comment anchors retain source references.

- AC2: Deleted anchors have a visible fallback.

- AC3: Comment access follows document permissions.

### DOC-106 — P1

**BTF:** [GENIE-31](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-31) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2629) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2630) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2631)

As a collaborator, I can edit alongside others without losing changes.

**Acceptance criteria**

- AC1: Conflict-resolution behavior is defined.

- AC2: Disconnect and reconnect preserve reconciled edits.

- AC3: Collaboration load is tested separately from ordinary API load.

## DOC-02 Genie document capabilities

**Live epic:** [GENIE-32](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-32) · [Test folder](https://debug.aplyd.org/en-US/projects/repository/7?node=183)

Extract and transform information with explicit source scope.

**Ownership scope:** Genie connector

**Dependencies:** DOC-01, AGENT-02

### DOC-201 — P0

**BTF:** [GENIE-33](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-33) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2632) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2633) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2634)

As a user, I can summarize selected text or a specified document.

**Acceptance criteria**

- AC1: Selection takes precedence when intended.

- AC2: Summary identifies source scope.

- AC3: Oversized input is bounded or asks for narrower scope.

### DOC-202 — P0

**BTF:** [GENIE-34](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-34) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2635) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2636) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2637)

As a user, I can extract decisions and action items from notes.

**Acceptance criteria**

- AC1: Decisions and proposals are distinguished.

- AC2: Missing owners and dates remain unresolved.

- AC3: Source content cannot authorize tools.

### DOC-203 — P1

**BTF:** [GENIE-35](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-35) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2638) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2639) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2640)

As a user, I can review a rewrite before applying it.

**Acceptance criteria**

- AC1: Preview shows affected passage.

- AC2: No silent overwrite is allowed.

- AC3: Changed source version triggers revalidation.

### DOC-204 — P1

**BTF:** [GENIE-36](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-36) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2641) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2642) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2643)

As a user, I can ask document questions and inspect supporting passages.

**Acceptance criteria**

- AC1: Answers reference supporting passages.

- AC2: Unsupported claims are acknowledged.

- AC3: Current source permissions are checked before retrieval.

### DOC-205 — P1

**BTF:** [GENIE-37](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-37) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2644) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2645) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2646)

As a user, I can create a draft from authorized project information.

**Acceptance criteria**

- AC1: Only authorized sources contribute.

- AC2: Generated draft is editable.

- AC3: Creation links relevant sources without leaking inaccessible metadata.

## CAL-01 Calendar fundamentals

**Live epic:** [GENIE-38](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-38) · [Test folder](https://debug.aplyd.org/en-US/projects/repository/7?node=184)

Represent schedules and invitations accurately.

**Ownership scope:** Existing application prerequisite; integration mapping required

**Dependencies:** PLAT-01

### CAL-101 — P1

**BTF:** [GENIE-39](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-39) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2647) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2648) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2649)

As a user, I can view events in my configured timezone.

**Acceptance criteria**

- AC1: Stored times are unambiguous.

- AC2: Timezone changes preserve event instants.

- AC3: All-day events remain date-based.

### CAL-102 — P1

**BTF:** [GENIE-40](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-40) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2650) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2651) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2652)

As a user, I can create, edit and cancel personal events.

**Acceptance criteria**

- AC1: Calendar write access is enforced.

- AC2: Cancellation state is visible.

- AC3: Provider failures are not shown as success.

### CAL-103 — P1

**BTF:** [GENIE-41](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-41) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2653) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2654) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2655)

As a user, I can specify working hours and scheduling preferences.

**Acceptance criteria**

- AC1: Timezone is stored with preferences.

- AC2: Invalid ranges are rejected.

- AC3: Preferences do not imply permission to schedule automatically.

### CAL-104 — P1

**BTF:** [GENIE-42](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-42) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2656) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2657) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2658)

As an organizer, I can invite participants and inspect responses.

**Acceptance criteria**

- AC1: Recipients are visible before sending invitations.

- AC2: Responses map to the correct event.

- AC3: Private blocks are distinguished from invitations.

### CAL-105 — P2

**BTF:** [GENIE-43](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-43) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2659) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2660) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2661)

As a user, I can manage recurring events.

**Acceptance criteria**

- AC1: Single occurrence and whole-series edits are distinct.

- AC2: Exceptions retain correct dates.

- AC3: Series changes require an explicit scope choice.

## CAL-02 Genie scheduling

**Live epic:** [GENIE-44](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-44) · [Test folder](https://debug.aplyd.org/en-US/projects/repository/7?node=185)

Coordinate approved schedules.

**Ownership scope:** Genie connector

**Dependencies:** CAL-01, AGENT-03

### CAL-201 — P1

**BTF:** [GENIE-45](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-45) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2662) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2663) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2664)

As a user, I can ask for available slots in a date range.

**Acceptance criteria**

- AC1: Date range resolves in user timezone.

- AC2: Missing duration triggers clarification.

- AC3: Unknown participant availability is explicit.

### CAL-202 — P1

**BTF:** [GENIE-46](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-46) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2665) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2666) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2667)

As a user, I can approve a focus block linked to a task.

**Acceptance criteria**

- AC1: Preview shows exact start, end and calendar.

- AC2: Availability is rechecked before creation.

- AC3: Task deadlines do not automatically authorize blocks.

### CAL-203 — P1

**BTF:** [GENIE-47](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-47) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2668) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2669) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2670)

As an organizer, I can approve an event and attendee list before invitations.

**Acceptance criteria**

- AC1: Approval includes recipients and event details.

- AC2: Material attendee edits invalidate approval.

- AC3: Unauthorized calendars cannot be selected.

### CAL-204 — P2

**BTF:** [GENIE-48](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-48) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2671) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2672) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2673)

As a user, I can request a rescheduling proposal.

**Acceptance criteria**

- AC1: Original event is identified unambiguously.

- AC2: Conflicts are shown before mutation.

- AC3: Only the approved occurrence or series is changed.

## MAIL-01 Connected mailbox fundamentals

**Live epic:** [GENIE-49](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-49) · [Test folder](https://debug.aplyd.org/en-US/projects/repository/7?node=186)

Operate connected mailboxes with explicit boundaries.

**Ownership scope:** Existing application prerequisite; mailbox hosting excluded

**Dependencies:** PLAT-01

### MAIL-101 — P1

**BTF:** [GENIE-50](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-50) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2674) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2675) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2676)

As a user, I can connect and disconnect a supported mailbox.

**Acceptance criteria**

- AC1: Provider permissions are explicit.

- AC2: Tokens remain server-side.

- AC3: Disconnect prevents new access and applies retention policy.

### MAIL-102 — P1

**BTF:** [GENIE-51](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-51) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2677) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2678) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2679)

As a user, I can view synchronized messages and threads.

**Acceptance criteria**

- AC1: Only permitted mailbox content appears.

- AC2: Sync freshness is visible.

- AC3: Provider errors have recoverable states.

### MAIL-103 — P1

**BTF:** [GENIE-52](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-52) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2680) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2681) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2682)

As a user, I can compose and save drafts.

**Acceptance criteria**

- AC1: Drafts remain editable.

- AC2: Save failures preserve recoverable input.

- AC3: Retries do not create duplicate drafts.

### MAIL-104 — P1

**BTF:** [GENIE-53](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-53) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2683) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2684) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2685)

As a user, I can review and manually send email.

**Acceptance criteria**

- AC1: Recipients and content are visible.

- AC2: Sending differs from saving a draft.

- AC3: Uncertain provider outcomes are reconciled before retry.

### MAIL-105 — P1

**BTF:** [GENIE-54](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-54) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2686) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2687) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2688)

As a user, I can recover synchronization failures.

**Acceptance criteria**

- AC1: Reconnect preserves existing resource identity.

- AC2: Revoked provider permission is reported accurately.

- AC3: Recovery does not request unnecessary broader scopes.

## MAIL-02 Genie email assistance

**Live epic:** [GENIE-55](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-55) · [Test folder](https://debug.aplyd.org/en-US/projects/repository/7?node=187)

Connect correspondence to drafts and tracked work.

**Ownership scope:** Genie connector

**Dependencies:** MAIL-01, AGENT-02

### MAIL-201 — P1

**BTF:** [GENIE-56](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-56) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2689) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2690) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2691)

As a user, I can summarize a selected thread.

**Acceptance criteria**

- AC1: Only the authorized selected thread is read.

- AC2: Commitments and suggestions are distinguished.

- AC3: Summary references its source.

### MAIL-202 — P1

**BTF:** [GENIE-57](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-57) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2692) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2693) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2694)

As a user, I can draft a reply using authorized project context.

**Acceptance criteria**

- AC1: Recipients come from verified data or user input.

- AC2: Draft remains editable.

- AC3: No agent send tool is available initially.

### MAIL-203 — P1

**BTF:** [GENIE-58](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-58) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2695) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2696) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2697)

As a user, I can propose tasks from an email commitment.

**Acceptance criteria**

- AC1: Destination project is verified.

- AC2: Preview retains source reference.

- AC3: Creation requires approval and duplicate protection.

### MAIL-204 — P1

**BTF:** [GENIE-59](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-59) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2698) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2699) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2700)

As a user, I can review a project update draft before manually sending.

**Acceptance criteria**

- AC1: Reporting period is explicit.

- AC2: Workspace claims are grounded in accessible records.

- AC3: Draft creation never implies sending.

## AGENT-01 Persistent Genie conversation

**Live epic:** [GENIE-60](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-60) · [Test folder](https://debug.aplyd.org/en-US/projects/repository/7?node=188)

Maintain useful continuity across apps.

**Ownership scope:** Genie platform

**Dependencies:** PLAT-01

### AGENT-101 — P0

**BTF:** [GENIE-61](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-61) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2701) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2702) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2703)

As a user, I can open Genie from any supported application.

**Acceptance criteria**

- AC1: Entry point is consistently available.

- AC2: Keyboard navigation is supported.

- AC3: Inference failure does not hide manual app controls.

### AGENT-102 — P0

**BTF:** [GENIE-62](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-62) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2704) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2705) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2706)

As a user, I can see the resource Genie will use.

**Acceptance criteria**

- AC1: Source app and resource are displayed.

- AC2: User can correct context before submitting.

- AC3: Inaccessible metadata is omitted.

### AGENT-103 — P0

**BTF:** [GENIE-63](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-63) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2707) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2708) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2709)

As a user, I can continue a conversation after changing apps.

**Acceptance criteria**

- AC1: History persists within its authorized scope.

- AC2: Submitted jobs keep captured context.

- AC3: New requests clearly show their new context.

### AGENT-104 — P1

**BTF:** [GENIE-64](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-64) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2710) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2711) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2712)

As a user, I can inspect, change and delete saved preferences.

**Acceptance criteria**

- AC1: Preferences differ from approval records.

- AC2: Changes affect subsequent requests.

- AC3: Deletion propagates to applicable derived memory.

## AGENT-02 Bounded workflow routing

**Live epic:** [GENIE-65](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-65) · [Test folder](https://debug.aplyd.org/en-US/projects/repository/7?node=189)

Map natural language to registered capabilities.

**Ownership scope:** Genie platform

**Dependencies:** CTX-01

### AGENT-201 — P0

**BTF:** [GENIE-66](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-66) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2713) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2714) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2715)

As a user, I can express a supported outcome naturally.

**Acceptance criteria**

- AC1: Routing selects a registered workflow or clarification.

- AC2: Equivalent phrases map to the same contract.

- AC3: Unsupported actions do not fabricate tools.

### AGENT-202 — P0

**BTF:** [GENIE-67](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-67) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2716) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2717) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2718)

As a user, I receive focused clarification for missing inputs.

**Acceptance criteria**

- AC1: Only unresolved required fields are requested.

- AC2: Ambiguous people and projects are not guessed.

- AC3: Answers update the pending plan without mutations.

### AGENT-203 — P0

**BTF:** [GENIE-68](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-68) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2719) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2720) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2721)

As an operator, I can restrict each workflow's tools and limits.

**Acceptance criteria**

- AC1: Only relevant tool schemas enter the prompt.

- AC2: Input and output pass schema validation.

- AC3: Context, model calls, action count and runtime have bounds.

### AGENT-204 — P0

**BTF:** [GENIE-69](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-69) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2722) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2723) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2724)

As a user, I receive a clear unsupported-action response.

**Acceptance criteria**

- AC1: No unauthorized side effects occur.

- AC2: Response explains the supported alternative where available.

- AC3: Unsupported requests do not enter unbounded planning loops.

## AGENT-03 Approval and execution

**Live epic:** [GENIE-70](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-70) · [Test folder](https://debug.aplyd.org/en-US/projects/repository/7?node=190)

Make consequential changes explicit and recoverable.

**Ownership scope:** Genie platform

**Dependencies:** AGENT-02, OPS-01

### AGENT-301 — P0

**BTF:** [GENIE-71](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-71) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2725) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2726) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2727)

As a user, I can review exact proposed changes.

**Acceptance criteria**

- AC1: Preview shows target resources and field values.

- AC2: External consequences are explicit.

- AC3: Approval binds to a plan version.

### AGENT-302 — P0

**BTF:** [GENIE-72](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-72) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2728) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2729) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2730)

As a user, I can edit or reject a proposal.

**Acceptance criteria**

- AC1: Rejected plans do not execute.

- AC2: Material edits invalidate previous approval.

- AC3: A new preview reflects accepted edits.

### AGENT-303 — P0

**BTF:** [GENIE-73](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-73) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2731) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2732) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2733)

As a user, I can see individual action results.

**Acceptance criteria**

- AC1: Success requires an execution receipt.

- AC2: Partial completion identifies successful and failed steps.

- AC3: Results link only to accessible resources.

### AGENT-304 — P0

**BTF:** [GENIE-74](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-74) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2734) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2735) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2736)

As a user, I can retry failed steps safely.

**Acceptance criteria**

- AC1: Successful actions are not repeated.

- AC2: Unknown outcomes are reconciled first.

- AC3: Retry respects current permission and expiry.

### AGENT-305 — P1

**BTF:** [GENIE-75](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-75) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2737) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2738) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2739)

As a user, I can cancel pending actions.

**Acceptance criteria**

- AC1: Pending steps stop where cancellable.

- AC2: Completed changes remain visible.

- AC3: Cancellation does not promise unsupported rollback.

## CTX-01 Context selection

**Live epic:** [GENIE-76](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-76) · [Test folder](https://debug.aplyd.org/en-US/projects/repository/7?node=191)

Supply authoritative and bounded request context.

**Ownership scope:** Genie platform

**Dependencies:** PLAT-01

### CTX-101 — P0

**BTF:** [GENIE-77](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-77) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2740) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2741) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2742)

As a user, I want relevant selected content used directly.

**Acceptance criteria**

- AC1: Known source is fetched without unnecessary semantic search.

- AC2: Selection scope is preserved.

- AC3: Source version accompanies the content.

### CTX-102 — P0

**BTF:** [GENIE-78](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-78) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2743) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2744) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2745)

As an operator, I want structured facts fetched from application services.

**Acceptance criteria**

- AC1: Permissions and current state come from authoritative services.

- AC2: Model output cannot replace access checks.

- AC3: Queries request necessary fields only.

### CTX-103 — P0

**BTF:** [GENIE-79](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-79) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2746) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2747) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2748)

As an operator, I can bound prompt context.

**Acceptance criteria**

- AC1: History and source content have budgets.

- AC2: Omission does not silently claim full-source analysis.

- AC3: Large inputs trigger supported narrowing or explicit processing policy.

### CTX-104 — P0

**BTF:** [GENIE-80](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-80) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2749) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2750) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2751)

As a user, I want stale plans detected before execution.

**Acceptance criteria**

- AC1: Relevant source versions are compared.

- AC2: Conflicts produce refresh or clarification.

- AC3: A refresh requiring material changes renews approval.

## CTX-02 Search retrieval and memory

**Live epic:** [GENIE-81](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-81) · [Test folder](https://debug.aplyd.org/en-US/projects/repository/7?node=192)

Find authorized knowledge without expanding every prompt.

**Ownership scope:** Genie platform

**Dependencies:** CTX-01

### CTX-201 — P1

**BTF:** [GENIE-82](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-82) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2752) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2753) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2754)

As a user, I can find resources by names and keywords.

**Acceptance criteria**

- AC1: Search respects tenant and resource access.

- AC2: Exact references remain usable.

- AC3: Empty results differ from service failure.

### CTX-202 — P1

**BTF:** [GENIE-83](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-83) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2755) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2756) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2757)

As a user, I can find relevant passages with different wording.

**Acceptance criteria**

- AC1: Semantic retrieval is evaluated against representative queries.

- AC2: Returned context is bounded.

- AC3: Permissions are enforced before content reaches the model.

### CTX-203 — P1

**BTF:** [GENIE-84](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-84) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2758) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2759) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2760)

As a user, I can inspect sources supporting an answer.

**Acceptance criteria**

- AC1: Passages retain resource and version references.

- AC2: Unavailable evidence is not invented.

- AC3: Source links check current access.

### CTX-204 — P1

**BTF:** [GENIE-85](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-85) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2761) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2762) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2763)

As an administrator, I can remove deleted or restricted content from retrieval.

**Acceptance criteria**

- AC1: Deletion covers chunks and applicable derived summaries.

- AC2: Permission revocation prevents access despite index lag.

- AC3: Index freshness and purge failures are observable.

## OPS-01 Durable workflow jobs

**Live epic:** [GENIE-86](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-86) · [Test folder](https://debug.aplyd.org/en-US/projects/repository/7?node=193)

Keep accepted work safe across failures.

**Ownership scope:** Genie operations

**Dependencies:** PLAT-01

### OPS-101 — P0

**BTF:** [GENIE-87](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-87) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2764) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2765) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2766)

As a user, my accepted request survives disconnect.

**Acceptance criteria**

- AC1: Job is persisted before acceptance.

- AC2: Job status can be reopened.

- AC3: Repeated submission identity does not duplicate mutations.

### OPS-102 — P0

**BTF:** [GENIE-88](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-88) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2767) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2768) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2769)

As an operator, workers reconcile interrupted jobs.

**Acceptance criteria**

- AC1: Restart tests recover accepted work.

- AC2: In-flight actions are reconciled before retry.

- AC3: No inference wait holds a database transaction open.

### OPS-103 — P0

**BTF:** [GENIE-89](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-89) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2770) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2771) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2772)

As a user, I can distinguish progress and terminal outcomes.

**Acceptance criteria**

- AC1: Queued, planning, approval, execution and terminal states differ.

- AC2: Partial results survive refresh.

- AC3: UI never equates generated text with completed action.

### OPS-104 — P0

**BTF:** [GENIE-90](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-90) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2773) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2774) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2775)

As an operator, I can bound retries and expiry.

**Acceptance criteria**

- AC1: Transient and permanent errors differ.

- AC2: Attempt limits and deadlines are enforced.

- AC3: Expired actions cannot execute unnoticed.

## OPS-02 Budget capacity and reporting

**Live epic:** [GENIE-91](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-91) · [Test folder](https://debug.aplyd.org/en-US/projects/repository/7?node=194)

Control workload and operating exposure.

**Ownership scope:** Genie operations

**Dependencies:** OPS-01

### OPS-201 — P0

**BTF:** [GENIE-92](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-92) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2776) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2777) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2778)

As an operator, I can enforce tenant and global quotas.

**Acceptance criteria**

- AC1: Limits apply before inference.

- AC2: One tenant cannot consume the entire queue.

- AC3: Quota errors explain when retry is useful.

### OPS-202 — P0

**BTF:** [GENIE-93](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-93) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2779) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2780) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2781)

As an operator, I reserve estimated cost before inference.

**Acceptance criteria**

- AC1: Reservations include in-flight work.

- AC2: Usage reconciliation adjusts reservations.

- AC3: Safety headroom accounts for estimation error.

### OPS-203 — P1

**BTF:** [GENIE-94](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-94) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2782) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2783) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2784)

As an administrator, I can inspect workflow usage and cost.

**Acceptance criteria**

- AC1: Estimated and reconciled figures are distinguished.

- AC2: Failed and retried usage is included.

- AC3: Access to tenant reports is restricted.

### OPS-204 — P0

**BTF:** [GENIE-95](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-95) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2785) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2786) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2787)

As a user, I receive a clear capacity response.

**Acceptance criteria**

- AC1: Queue depth and request expiry are bounded.

- AC2: Overload does not create unlimited jobs.

- AC3: Provider unavailability is not presented as a user error.

### OPS-205 — P0

**BTF:** [GENIE-96](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-96) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2788) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2789) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2790)

As a user, I can keep using apps during AI downtime.

**Acceptance criteria**

- AC1: Manual CRUD does not depend on inference.

- AC2: Inference kill switch prevents new paid work.

- AC3: Pending workflow status remains readable.

## OPS-03 Quality security and release evaluation

**Live epic:** [GENIE-97](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-97) · [Test folder](https://debug.aplyd.org/en-US/projects/repository/7?node=195)

Release evidence-backed changes.

**Ownership scope:** Genie operations

**Dependencies:** OPS-01, AGENT-03

### OPS-301 — P0

**BTF:** [GENIE-98](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-98) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2791) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2792) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2793)

As an engineer, I evaluate representative workflows before release.

**Acceptance criteria**

- AC1: Dataset covers successful, ambiguous and unsupported requests.

- AC2: Correctness and latency results are recorded.

- AC3: A model or prompt change reruns affected evaluations.

### OPS-302 — P0

**BTF:** [GENIE-99](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-99) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2794) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2795) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2796)

As an engineer, I test malicious document and email instructions.

**Acceptance criteria**

- AC1: Source text cannot expand tool access.

- AC2: Cross-tenant negative tests prevent disclosure.

- AC3: External communication approval cannot be bypassed.

### OPS-303 — P0

**BTF:** [GENIE-100](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-100) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2797) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2798) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2799)

As an operator, I investigate failures through redacted traces.

**Acceptance criteria**

- AC1: Secrets and unnecessary content are excluded.

- AC2: Traces connect workflow and tool attempts.

- AC3: Audit access and retention are explicit.

### OPS-304 — P1

**BTF:** [GENIE-101](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-101) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2800) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2801) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2802)

As an engineer, I compare model choices by useful outcomes.

**Acceptance criteria**

- AC1: Compare cost per successful workflow.

- AC2: Use the same workload for comparisons.

- AC3: GPU allocation and startup costs are included.

## SEC-01 Security audit and retention

**Live epic:** [GENIE-102](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-102) · [Test folder](https://debug.aplyd.org/en-US/projects/repository/7?node=196)

Preserve trust across all connectors.

**Ownership scope:** Genie platform

**Dependencies:** PLAT-01

### SEC-101 — P0

**BTF:** [GENIE-103](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-103) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2803) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2804) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2805)

As an administrator, I can audit automated mutations.

**Acceptance criteria**

- AC1: Record includes requester, tenant, approval, tool and result.

- AC2: Unexecuted proposals remain distinguishable.

- AC3: Sensitive trace access is restricted.

### SEC-102 — P0

**BTF:** [GENIE-104](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-104) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2806) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2807) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2808)

As an operator, I can rotate webhook secrets without exposing them.

**Acceptance criteria**

- AC1: Credentials remain server-side.

- AC2: Logs omit authorization values.

- AC3: Invalid credentials are rejected before expensive inference.

### SEC-103 — P1

**BTF:** [GENIE-105](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-105) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2809) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2810) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2811)

As an administrator, I can apply retention and deletion policies.

**Acceptance criteria**

- AC1: Policy covers conversations, sources, derived content and audit exceptions.

- AC2: Deletion state is observable.

- AC3: Backups follow documented retention boundaries.

## DELEG-01 Bounded delegation

**Live epic:** [GENIE-106](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-106) · [Test folder](https://debug.aplyd.org/en-US/projects/repository/7?node=197)

Reduce approvals only under explicit policies.

**Ownership scope:** Later Genie scope

**Dependencies:** AGENT-03, SEC-01

### DELEG-101 — P2

**BTF:** [GENIE-107](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-107) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2812) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2813) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2814)

As an administrator, I can define permitted delegated actions.

**Acceptance criteria**

- AC1: Policy specifies resources, tools, limits and expiry.

- AC2: Policy cannot exceed actor permissions.

- AC3: External sends and destructive actions remain separately governed.

### DELEG-102 — P2

**BTF:** [GENIE-108](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-108) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2815) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2816) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2817)

As a user, I can inspect and revoke my delegation policies.

**Acceptance criteria**

- AC1: Active scopes are visible.

- AC2: Revocation affects pending execution.

- AC3: Changes are audited.

## EXT-01 Additional application onboarding

**Live epic:** [GENIE-109](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-109) · [Test folder](https://debug.aplyd.org/en-US/projects/repository/7?node=198)

Extend Genie through verified contracts.

**Ownership scope:** Four application identities pending

**Dependencies:** None declared

### EXT-101 — P2

**BTF:** [GENIE-110](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-110) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2818) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2819) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2820)

As a product owner, I can register each remaining application's scope.

**Acceptance criteria**

- AC1: Name, users and entities are specified.

- AC2: Manual prerequisites and agent capabilities are separate.

- AC3: No capabilities are invented for unspecified apps.

### EXT-102 — P2

**BTF:** [GENIE-111](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-111) · **Draft tests:** [AC1](https://debug.aplyd.org/en-US/projects/repository/7/2821) · [AC2](https://debug.aplyd.org/en-US/projects/repository/7/2822) · [AC3](https://debug.aplyd.org/en-US/projects/repository/7/2823)

As an engineer, I can implement a connector against its approved contract.

**Acceptance criteria**

- AC1: Tools define schemas, ACLs, limits, approval and recovery.

- AC2: Context identifies resource and version.

- AC3: Connector passes isolation and duplicate tests.
