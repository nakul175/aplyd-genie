"""Generate draft Bug Off cases from the approved specification and actual BTF keys."""
from pathlib import Path
import csv, json
ROOT=Path(__file__).resolve().parents[1]
# Each line contains the distinct manual action for AC1, AC2 and AC3 respectively.
SCENARIOS='''
PLAT-101|Send a signed-in request with conflicting browser-supplied user and tenant values|Deactivate the fixture member and request a protected resource|Sign out and reopen a previously accessible Genie conversation URL
PLAT-102|Attempt membership changes as an administrator and then an ordinary member|Deactivate a fixture member and attempt both a read and a mutation|Invite and deactivate a fixture member and inspect the audit history
PLAT-103|Give a fixture user read-only access and attempt read and mutation operations|Change the fixture role and repeat UI, tool and queued execution requests|Attempt to grant a permission above the fixture administrator's allowed scope
PLAT-104|Switch between two fixture workspaces and inspect the active-workspace indicator|Open search and conversation history after switching workspaces|Queue a request in workspace A then switch to workspace B before it executes
PLAT-105|Approve a mutation then revoke the fixture user's permission before execution|Run the approved action after access revocation and inspect its result|Inspect the denied-action trace using an authorized operator account
PLAT-201|Create a task from a document and reopen its saved source reference|Revoke document access then follow the generated task's source link|Inspect the task backlinks after source access has been revoked
PLAT-202|Make equivalent manual and Genie edits and inspect the activity actors|Complete a Genie mutation and follow its workflow reference|Create and reject a proposal then inspect the resource activity history
PLAT-203|Link tasks, events and documents then inspect as an authorized and restricted user|Delete or make a linked fixture target unavailable and follow its reference|Rename a linked resource and reopen its original reference
PLAT-204|Complete and partially fail two fixture workflows and inspect notifications|Redeliver a completed job and inspect notifications for duplicate alerts|Disable the relevant notification preference and complete a fixture workflow
PROJ-101|Submit a project without its required fields and then with valid values|Attempt project creation as an authorized and unauthorized workspace member|Create a fixture project then reopen the authorized project list
PROJ-102|Attempt to assign a task to eligible and ineligible workspace members|Create a date-only task deadline and compare it with a timed calendar event|Submit the same invalid and valid fields through UI and Genie tools
PROJ-103|Search and filter tasks as a member without access to a second fixture project|Combine owner, status and date filters against known fixture tasks|Compare an empty filter result with a controlled task-list service failure
PROJ-104|Attempt supported and unsupported task status transitions|Open the same task in two sessions and save conflicting changes|Change task status and inspect its actor and timestamp in activity
PROJ-105|Attempt a task comment as an authorized and restricted collaborator|Post a fixture comment and inspect the activity actor|Cause a controlled comment-save failure with unsent text in the editor
PROJ-106|Attempt dependency links to accessible and inaccessible fixture tasks|Attempt a self-dependency and then a cycle across fixture tasks|Block a task and compare dependency state with completion state
PROJ-201|Query upcoming tasks at a timezone date boundary with known ownership|Run the same query as a user lacking access to one matching task|Open every returned task link and compare it with the cited result
PROJ-202|Extract tasks from fixture notes and inspect every proposed field|Use notes with an ambiguous owner and unspecified project|Approve task creation and repeat delivery with the same operation identity
PROJ-203|Ask Genie to update a task when two accessible tasks share its name|Request a task change and inspect the proposed before and after fields|Edit or revoke access to the task after preview and before execution
PROJ-204|Request a summary from a fixture project with known task states|Include recorded blockers and merely inferred delivery risks in the fixture|Request summaries for two explicit reporting periods and compare boundaries
PROJ-205|Request a batch larger than the configured task update limit|Inspect approval for a batch affecting multiple fixture tasks|Fail one mutation in an approved batch and inspect individual results
DOC-101|Edit a document and inspect saving, saved and error indicators|Trigger a controlled save failure then reopen the unsaved editor|Save multiple revisions and inspect the stable document and version references
DOC-102|Attempt sharing changes as a document owner and a read-only user|Attempt edits with read-only access and then with edit access|Revoke fixture access and request content through the normal service API
DOC-103|Select a passage and inspect its captured document and version references|Clear the selection and submit a selection-based Genie request|Submit selected text then navigate to a different document before processing
DOC-104|Revoke access then attempt to open an earlier fixture document revision|Restore an earlier revision and inspect the resulting activity and version|Open a restore target and compare its preview before confirming
DOC-105|Comment on a selected passage then inspect the retained source anchor|Delete a commented fixture passage and reopen its comment|Attempt to view and add comments after document access revocation
DOC-106|Edit overlapping passages from two fixture sessions concurrently|Disconnect one editor, make edits, then reconnect and compare content|Run the agreed concurrent-edit workload separately from ordinary API traffic
DOC-201|Select one passage and ask Genie to summarize this|Request a whole-document and a selected-passage summary and compare scope labels|Submit source content above the configured context bound
DOC-202|Extract action items from notes containing confirmed decisions and tentative suggestions|Extract tasks from notes that omit owners and dates|Embed instructions to invoke unauthorized tools inside fixture meeting notes
DOC-203|Request a rewrite of a selected passage and inspect the proposed affected region|Request a rewrite but reject it and compare the saved source|Edit the source in another session before applying the approved rewrite
DOC-204|Ask a factual question with a known supporting passage|Ask a question whose answer does not appear in the fixture document|Revoke source access before a document question is retrieved
DOC-205|Request a draft from a mix of accessible and inaccessible project records|Create a draft then edit its generated content normally|Inspect source links and metadata in a draft after source access restrictions
CAL-101|View a known event in two explicitly configured timezones|Change the display timezone and compare the stored event instant|Create an all-day event and inspect it across timezone boundaries
CAL-102|Attempt an event mutation on writable and read-only calendars|Cancel a fixture event and reopen the calendar|Trigger a controlled provider failure during event creation
CAL-103|Save working hours and inspect the saved timezone association|Submit overlapping or invalid working-hour ranges|Save scheduling preferences and inspect whether any event is created without a request
CAL-104|Compose an invitation and inspect its recipients before submission|Accept and decline fixture invitations and inspect the corresponding event|Compare creation of a private block with an attendee invitation
CAL-105|Choose single-occurrence and whole-series edits on a fixture recurrence|Create an exception and inspect its occurrence date|Attempt to change a recurring event without choosing occurrence or series scope
CAL-201|Request free slots across the user's week boundary|Request slots without supplying a required duration|Request a meeting with a participant whose calendar availability is unavailable
CAL-202|Propose a task focus block and inspect times and destination calendar|Create a conflicting event after approval but before block creation|Ask only for a task deadline and inspect whether Genie creates a block
CAL-203|Inspect approval for an event with a known attendee list|Change the attendee list after approval and attempt execution|Request an event on a calendar the fixture user cannot modify
CAL-204|Request rescheduling when two events share the same title|Propose a new time overlapping a known conflict|Approve an occurrence-only change and inspect all other occurrences
MAIL-101|Connect a supported test mailbox and inspect requested provider scopes|Inspect allowed diagnostics and client responses for token exposure|Disconnect the mailbox and attempt a new read while checking retention behavior
MAIL-102|Open mailbox threads as the owner and as an unauthorized fixture user|Inspect synchronization freshness after a new provider message|Cause a controlled synchronization failure and inspect recovery controls
MAIL-103|Save a draft then reopen and edit it|Cause a draft-save failure and inspect preserved editor input|Repeat a draft-save operation with the same request identity
MAIL-104|Inspect recipient and body before manually submitting a fixture email|Save a draft and compare it with an explicit send operation|Simulate an uncertain provider response and request a retry
MAIL-105|Reconnect a test mailbox and compare existing message and thread identities|Revoke provider consent then attempt synchronization|Run reconnection and compare requested scopes with the original integration scopes
MAIL-201|Summarize one thread while another inaccessible thread contains similar text|Summarize a thread containing firm commitments and tentative proposals|Open the summary's source reference and compare its supporting thread
MAIL-202|Request a reply with an ambiguous or missing recipient|Generate a reply draft then edit its contents|Inspect available Genie email tools and attempt to request an automatic send
MAIL-203|Extract an email commitment into a task for an inaccessible then accessible project|Inspect the task proposal's source reference|Approve task creation then repeat delivery of its operation
MAIL-204|Request a project update for a specified date interval|Compare the draft's claims against accessible project fixture records|Create the draft and inspect provider sent-mail state
AGENT-101|Open Genie from each supported application|Open, navigate and close Genie using the keyboard|Disable inference and inspect access to ordinary manual application controls
AGENT-102|Open Genie with a selected document and inspect its source indicator|Correct the selected context before submitting a request|Open Genie as a user unable to read a referenced resource
AGENT-103|Move between supported apps within one authorized workspace conversation|Submit a document request then change active apps before execution|After navigation start a new request and inspect its displayed context
AGENT-104|Inspect saved preferences alongside pending workflow approvals|Change a saved preference then submit a new request|Delete a preference and inspect subsequent context and derived-memory handling
AGENT-201|Submit a supported request with complete and incomplete required inputs|Submit equivalent phrasings of the same supported outcome|Request an unsupported tool or operation through natural language
AGENT-202|Submit a request with exactly one missing required field|Submit ambiguous person and project names|Answer a clarification and inspect whether changes occur before approval
AGENT-203|Start a workflow and inspect its registered planning tool scope|Submit malformed model arguments in a controlled test harness|Exceed each configured context, model-call, action and runtime bound
AGENT-204|Request an unsupported mutation and compare affected resource state|Request an unsupported action that has a supported draft-only alternative|Repeat an unsupported request and inspect bounded planner attempts
AGENT-301|Request a mutation and inspect every proposed target and field|Request an invitation and inspect the disclosed external consequences|Approve a plan then compare the stored approval with the approved version
AGENT-302|Reject a proposed mutation and inspect source state|Edit a material field after approval and attempt execution|Edit a proposal and inspect the newly displayed preview
AGENT-303|Simulate generated success text without an application execution receipt|Cause one approved step to fail after another step succeeds|Revoke access to a created resource before opening its result link
AGENT-304|Retry failed work after another step has already completed|Interrupt execution after an uncertain external mutation then retry|Revoke access or expire the job before retrying its failed step
AGENT-305|Cancel a workflow with queued and running cancellable steps|Cancel after one step completes and inspect the result history|Cancel a workflow containing an operation without compensation support
CTX-101|Request work on a known selected source and inspect retrieval calls|Submit a selected passage then compare captured and displayed scope|Capture source context then inspect its document-version reference
CTX-102|Change current permission or availability and request the corresponding action|Inject an authorization claim into model output in a controlled harness|Inspect a structured retrieval response for unnecessary resource fields
CTX-103|Submit a conversation and source above the configured budgets|Request a full-source answer when only a bounded passage can fit|Submit an oversized document and inspect narrowing or processing behavior
CTX-104|Change a relevant source version after planning|Attempt execution against a detected source conflict|Refresh a stale plan that changes its material proposed actions
CTX-201|Search a matching term across accessible and inaccessible fixture tenants|Search by an exact known resource reference|Compare an empty search result with a controlled search-service outage
CTX-202|Run representative semantic queries with known relevance judgments|Retrieve a large matching corpus and inspect supplied context size|Revoke access to a semantically matching passage before retrieval
CTX-203|Open cited passages and inspect resource and version references|Ask for evidence missing from all accessible fixture sources|Revoke source access then follow a previously displayed citation
CTX-204|Delete indexed content and inspect chunks and applicable derived summaries|Revoke source access while deliberately retaining a stale index fixture|Cause a controlled indexing or purge failure and inspect operator diagnostics
OPS-101|Submit a job then disconnect before the acceptance response is displayed|Reopen an accepted workflow from a fresh authorized session|Repeat submission with the same request identity
OPS-102|Restart a worker after an accepted job is persisted|Interrupt a worker after a mutation but before result persistence|Inspect database sessions during a controlled slow inference call
OPS-103|Run a workflow through queue, planning, approval and execution|Refresh a partially completed workflow|Return model-generated completion text without executing its actions
OPS-104|Compare handling of a transient provider fault and a permanently invalid request|Keep a provider unavailable beyond attempt and deadline limits|Attempt to resume an expired action
OPS-201|Submit a request after exhausting the fixture tenant's quota|Flood the queue from one tenant while another submits an interactive request|Inspect the response after a per-user quota limit is reached
OPS-202|Admit concurrent jobs against a nearly exhausted fixture budget|Reconcile estimated reservations with actual measured usage|Inject a bounded cost-estimation error near the spending ceiling
OPS-203|Open a usage report containing estimated and reconciled entries|Fail and retry an inference workflow then inspect reported usage|Attempt to open another tenant's cost report
OPS-204|Submit work beyond queue depth and request-expiry limits|Sustain overload and inspect admitted job counts|Make the GPU provider unavailable and inspect the user-visible error
OPS-205|Disable inference and perform ordinary authorized app reads and writes|Activate the inference kill switch then submit new paid work|Open existing job status while the inference service is unavailable
OPS-301|Inspect the release dataset for success, ambiguity and unsupported examples|Run the agreed evaluation and inspect recorded correctness and latency|Change a prompt or model revision and inspect affected evaluation gates
OPS-302|Embed malicious tool-expansion instructions in fixture source text|Run cross-tenant negative retrieval and mutation cases|Request an external communication through malicious source instructions
OPS-303|Trigger a controlled failure and inspect ordinary diagnostic logs|Follow a workflow trace into its individual tool attempts|Attempt audit access with authorized and restricted operator accounts
OPS-304|Compare two model configurations on completed and failed workflows|Run both configurations against the identical fixture workload|Inspect cost attribution for model startup and allocated GPU idle time
SEC-101|Complete an approved mutation and inspect its audit record|Create a proposal without executing it and inspect audit classification|Attempt sensitive trace access from a non-operator account
SEC-102|Inspect browser-facing responses after configuring server-side webhook credentials|Trigger invalid webhook authentication and inspect logs|Submit an invalid credential and inspect whether GPU work is allocated
SEC-103|Apply fixture retention rules to conversations, derived content and audit exceptions|Request deletion and inspect completion and failure status|Inspect backup retention and restore behavior after source deletion
DELEG-101|Create a delegation policy with tool, resource, limit and expiry bounds|Attempt to define a policy broader than the actor's permissions|Attempt delegated external sending or a destructive operation
DELEG-102|Open the delegation-policy view and inspect its active scopes|Revoke delegation before a queued action executes|Change and revoke a fixture policy then inspect its audit history
EXT-101|Register a remaining application's name, users and entities|Classify proposed manual prerequisites separately from agent capabilities|Attempt to enable capabilities for an undefined application
EXT-102|Review and exercise a connector's schemas, ACLs, limits, approval and recovery|Capture connector context for a versioned resource|Run cross-tenant and duplicate-delivery connector cases
'''
scenario_map={p[0]:p[1:] for p in (line.split('|') for line in SCENARIOS.strip().splitlines())}
b=json.loads((ROOT/'docs/backlog.json').read_text())
m=json.loads((ROOT/'evidence/tracker-import-map.json').read_text())
byid={s['spec_id']:s for s in m['stories']}
allstories=[s for e in b['epics'] for s in e['stories']]
assert set(scenario_map)=={s['id'] for s in allstories}
cases=[]
for e in b['epics']:
 for s in e['stories']:
  for i,ac in enumerate(s['acceptance_criteria']):
   cid=f"TC-{s['id']}-AC{i+1}"
   action=scenario_map[s['id']][i]
   target=byid.get(s['id'],{}).get('url')
   steps=[
    {'stepNumber':1,'step':f"In an approved isolated staging workspace, prepare the fixture required for this scenario: {action}. Use synthetic records and roles; capture baseline state before mutation.",'expectedResult':'Required accounts, permissions, source versions and baseline records are documented; no production fixture is used.'},
    {'stepNumber':2,'step':action+'. Capture the resulting UI/API response and workflow or resource identifier.','expectedResult':ac},
    {'stepNumber':3,'step':f"Reopen the affected resource or workflow using the normal authorized UI and inspect the supporting response, activity or operator evidence for {s['id']} AC{i+1}. Restore only disposable fixture changes after recording evidence.",'expectedResult':ac+' The observed evidence is attached to this case; no success is inferred from generated text alone.'}
   ]
   cases.append({'spec_case_id':cid,'story_id':s['id'],'epic_id':e['id'],'name':f'{cid} — {action}','folder':e['id']+' '+e['title'],'description':f"Aplyd Genie acceptance scenario {cid}\nUser story: {s['story']}\nAcceptance criterion AC{i+1}: {ac}\nBTF story: {target or 'PENDING ACTUAL KEY'}\nOwnership: {e['scope']}\nPreconditions: approved staging environment, synthetic tenant A and tenant B, appropriate member/admin fixtures and applicable connector configured. If the feature is unavailable, record Blocked rather than Passed.\nManual test script: {cid}. Status: Draft / Not run.\nSpecification: https://github.com/nakul175/aplyd-genie/blob/main/docs/EPICS-AND-USER-STORIES.md",'steps':steps,'expected':ac,'priority':s['priority'],'btf_url':target,'status':'Draft','result':'Not run'})
assert len(cases)==270 and len({x['spec_case_id'] for x in cases})==270
out=ROOT/'imports';out.mkdir(exist_ok=True)
(out/'bugoff-cases.json').write_text(json.dumps(cases,indent=2)+'\n')
if all(c['btf_url'] for c in cases):
 with (out/'bugoff-cases.csv').open('w',newline='') as f:
  w=csv.DictWriter(f,fieldnames=['Name','Folder','Description','Steps','Expected','Tags'])
  w.writeheader()
  for c in cases:w.writerow({'Name':c['name'],'Folder':c['folder'],'Description':c['description'],'Steps':json.dumps(c['steps']),'Expected':c['expected'],'Tags':f"Aplyd Genie,{c['story_id']},{c['spec_case_id']},{c['priority']}"})
 print('READY: 270 cases with actual BTF URLs')
else:print(f"Prepared 270 cases; CSV waits for actual BTF keys ({sum(bool(c['btf_url']) for c in cases)//3}/90 mapped).")
