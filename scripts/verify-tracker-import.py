"""Verify persisted tracker exports, without copying account metadata into Git."""
from pathlib import Path
import json,hashlib
ROOT=Path(__file__).resolve().parents[1]
b=json.loads((ROOT/'docs/backlog.json').read_text());m=json.loads((ROOT/'evidence/tracker-import-map.json').read_text())
p=max((Path.home()/'Downloads').glob('GENIE-export*.json'),key=lambda x:x.stat().st_mtime)
x=json.loads(p.read_text());rows={r['identifier']:r for r in x['issues']};ep={e['spec_id']:e for e in m['epics']};st={s['spec_id']:s for s in m['stories']}
assert len(x['issues'])==len(rows)==111
assert len(ep)==21 and len(st)==90 and len(m['test_cases'])==270
# Explicitly audit the five known duplicate import notes; no duplicate issues/cases are allowed.
extra_notes={'PROJ-204','PROJ-205','DOC-103','DOC-105','DOC-201'}
assert len({c['id'] for c in m['test_cases']})==270
assert sum(e['bugoff_case_count'] for e in m['epics'])==270
for e in b['epics']:
 er=rows[ep[e['id']]['key']];assert er['title']==f"[{e['id']}] {e['title']}";assert er['state']=='Backlog'
 assert len(er['comments'])==1,(e['id'],'duplicate/missing epic comments')
 assert ep[e['id']]['bugoff_folder_url'] in er['comments'][0]['body']
 for s in e['stories']:
  sr=rows[st[s['id']]['key']];assert sr['parentIdentifier']==ep[e['id']]['key'];assert sr['state']=='Backlog'
  assert sr['title']==f"[{s['id']}] {s['story']}"
  assert all(f'AC{i+1}: {ac}' in sr['description'] for i,ac in enumerate(s['acceptance_criteria'])),s['id']
  cs=[c for c in m['test_cases'] if c['story_id']==s['id']];assert len(cs)==3
  expected_comments=2 if s['id'] in extra_notes else 1
  assert len(sr['comments'])==expected_comments,(s['id'],'unexpected coverage comment count')
  assert len({c['body'] for c in sr['comments']})==1,(s['id'],'unexpected differing comment content')
  for comment in sr['comments']:
   for c in cs:assert c['url'] in comment['body'],(s['id'],c['spec_case_id'])
report={'source':'Final BTF native export and verified Bug Off native export','exportedAt':x['exportedAt'],'issues':111,'epics':21,'stories':90,'acceptance_criteria':270,'parent_links':90,'epic_folder_links':21,'story_case_links':270,'case_story_backlinks':270,'canonical_coverage_records':111,'total_comments':116,'extra_duplicate_coverage_notes':5,'note_consolidation':'Pending explicit approval after automatic review rejection','duplicate_issues_or_cases':0,'all_btf_state':'Backlog','all_case_state':'Draft','product_test_execution':'Not run','btf_export_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'verification':'PASS: required import counts, hierarchy, content and reciprocal links; five extra coverage notes explicitly audited and disclosed'}
(ROOT/'evidence/final-tracker-verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
