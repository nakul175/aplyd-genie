from pathlib import Path
import json,csv,re
ROOT=Path(__file__).resolve().parents[1]
m=json.loads((ROOT/'evidence/tracker-import-map.json').read_text());b=json.loads((ROOT/'docs/backlog.json').read_text())
def debug_link(url):
    return url.replace('https://bugoff.aplyd.org/en-US/projects/', 'https://debug.aplyd.org/en-US/projects/', 1)

ep={e['spec_id']:e for e in m['epics']};st={s['spec_id']:s for s in m['stories']};cases=m['test_cases']
for e in b['epics']:
 x=ep[e['id']];e['tracker_issue']=x['key'];e['tracker_url']=x['url'];e['bugoff_folder_url']=debug_link(x['bugoff_folder_url'])
 for s in e['stories']:
  y=st[s['id']];s['tracker_issue']=y['key'];s['tracker_url']=y['url'];s['status']='Backlog';s['test_cases']=[{'id':c['spec_case_id'],'bugoff_id':c['id'],'url':debug_link(c['url']),'state':'Draft','result':'Not run'} for c in sorted(cases,key=lambda c:c['spec_case_id']) if c['story_id']==s['id']]
b['note']='All 21 epics and 90 stories are imported into BTF. Every story has three linked Draft / Not run Debug cases. Specification IDs remain stable; actual tracker keys and URLs are recorded. No implementation or product test execution is claimed.'
(ROOT/'docs/backlog.json').write_text(json.dumps(b,indent=2)+'\n')
lines=['# Aplyd Genie Live Traceability','6 November 2026','All items are imported. BTF items remain Backlog; Debug cases remain Draft / Not run. One case covers each acceptance criterion. Each case contains preconditions, three ordered steps and per-step expected results, its acceptance criterion and its BTF story backlink. BTF stories contain direct coverage links in comments.','## Coverage totals','| Record | Count |','|---|---:|','| BTF epics | 21 |','| BTF user stories | 90 |','| Native parent-child links | 90 |','| Acceptance criteria and Debug cases | 270 |','| Ordered manual steps and expected results | 810 |','| Epic test folders | 21 |']
for e in b['epics']:
 x=ep[e['id']];lines += [f"## {e['id']} {e['title']}",f"[BTF epic {x['key']}]({x['url']}) · [Debug folder]({e['bugoff_folder_url']})",'| Specification story | BTF story | AC1 case | AC2 case | AC3 case |','|---|---|---|---|---|']
 for s in e['stories']:
  cs=s['test_cases'];lines.append(f"| {s['id']} | [{s['tracker_issue']}]({s['tracker_url']}) | "+' | '.join(f"[{c['bugoff_id']}]({c['url']})" for c in cs)+' |')
# Preserve contiguous Markdown table rows while separating other paragraphs.
text='\n\n'.join(lines)+'\n';text=re.sub(r'(?m)(\|[^\n]*\|)\n\n(?=\|)',r'\1\n',text)
(ROOT/'docs/TRACEABILITY.md').write_text(text)
p=ROOT/'docs/EPICS-AND-USER-STORIES.md';text=p.read_text();text=text.replace('All stories are proposed and unimplemented. Stable specification IDs are retained from the earlier baseline; they are not live BTF issue IDs.','All stories are imported into BTF in Backlog and have linked Draft / Not run Debug cases. Stable specification IDs remain distinct from actual BTF keys; see [live traceability](TRACEABILITY.md). No implementation or product test execution is claimed.')
for e in b['epics']:
 head=f"## {e['id']} {e['title']}"
 if head+'\n\n**Live epic:**' not in text:text=text.replace(head,head+f"\n\n**Live epic:** [{e['tracker_issue']}]({e['tracker_url']}) · [Test folder]({e['bugoff_folder_url']})")
 for s in e['stories']:
  head=f"### {s['id']} — {s['priority']}"
  if head+'\n\n**BTF:**' not in text:text=text.replace(head,head+f"\n\n**BTF:** [{s['tracker_issue']}]({s['tracker_url']}) · **Draft tests:** "+' · '.join(f"[AC{i+1}]({c['url']})" for i,c in enumerate(s['test_cases'])))
p.write_text(text)
with (ROOT/'docs/backlog.csv').open('w',newline='') as f:
 w=csv.writer(f,lineterminator="\n");w.writerow(['Product','Epic','Epic title','Story ID','Priority','Story','Acceptance criteria','Scope','Status','BTF epic','BTF story','AC1 case','AC2 case','AC3 case'])
 for e in b['epics']:
  for s in e['stories']:w.writerow(['Aplyd Genie',e['id'],e['title'],s['id'],s['priority'],s['story'],'\n'.join(s['acceptance_criteria']),e['scope'],'Backlog',e['tracker_url'],s['tracker_url'],*[c['url'] for c in s['test_cases']]])
(ROOT/'docs/ACCEPTANCE-COVERAGE.md').write_text('# Aplyd Genie Acceptance Coverage\n\nAll 270 acceptance criteria have corresponding Debug cases, organized into 21 epic folders. Each of the 90 BTF stories links to its three cases; each case links back to the story.\n\nSee [live traceability](TRACEABILITY.md) for every actual tracker link and [detailed specifications](EPICS-AND-USER-STORIES.md) for the criteria.\n\nAll cases are Draft / Not run. Import verification checks persisted content and mappings; it does not execute product tests or establish release acceptance.\n\nCoverage includes authorization and tenant isolation, stale sources, retries and duplicate protection, partial completion, timezone handling, prompt injection, quota exhaustion, provider failures, retention, and recovery.\n')
p=ROOT/'README.md';text=p.read_text().replace('- [Structured backlog](docs/backlog.json)','- [Live tracker traceability](docs/TRACEABILITY.md)\n- [Structured backlog](docs/backlog.json)');text=text.replace('Product definition baseline. Runtime implementation is not included.','Product definition and tracker import complete: 21 BTF epics, 90 BTF stories and 270 Draft / Not run Debug cases, with reciprocal links. Runtime implementation is not included.');p.write_text(text)
print('Updated documentation with actual BTF and Debug IDs and links.')
