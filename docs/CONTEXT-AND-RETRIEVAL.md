# Aplyd Genie Context and Retrieval

## Context sources

| Need | Source |
|---|---|
| Current document, selected text, open task | Verified application context |
| Owner, deadline, permission, live availability | Application services and PostgreSQL |
| Relevant historical passages | Authorized keyword/semantic retrieval |
| Preferences | Editable user-scoped records |
| Approval and execution state | Durable workflow records |

An open-weight model does not inherently require a vector database. Known resources should be fetched directly. Begin keyword search in PostgreSQL; add pgvector when evaluation shows semantic retrieval improves supported workflows. A separate vector service is not an initial requirement.

## Request context contract

Capture authenticated user and tenant, active application, verified resource identifiers, source version, selection, timezone, available capabilities, conversation reference, request ID, and workflow version. Browser location is a hint, not authorization. Navigation after submission must not retarget the request.

## Retrieval lifecycle

1. Resolve the user's current access and query scope.
2. Prefer direct retrieval or structured queries for known entities.
3. For discovery, combine keyword and semantic candidates where useful.
4. Authorize content before it is returned to the model.
5. Select bounded passages; retain resource, version, and passage references.
6. Cite supporting resources in factual answers.

Store embeddings with tenant, source, version, chunk, embedding-model revision and index timestamp. Reindex changed sources; remove deleted sources and derived summaries according to retention policy. Track index lag and purge status. Changing an embedding model requires an explicit migration/rebuild strategy.

Vector similarity never grants permission. PostgreSQL permission filtering and candidate selection must be tested together; restrictive access must not be weakened to improve recall. Live permissions, task state, and calendar availability always come from authoritative services.

## Token controls

- Supply only the selected workflow's tool schemas.
- Use the selected passage instead of entire files where adequate.
- Fetch structured fields rather than serializing full resource objects.
- Bound conversation history and use explicit workflow state.
- Execute approved actions deterministically rather than asking the model per action.
- Use stable prompts and safe caching where supported; cache keys include tenant/access/version boundaries.
- Measure context quality and successful outcomes alongside token counts.

Fewer tokens may reduce inference work, but GPU allocation, batching, startup and idle retention also determine billing. No percentage savings are assumed.
