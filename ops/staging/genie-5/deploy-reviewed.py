import fcntl,hashlib,io,json,os,subprocess,tarfile,time,urllib.request
from pathlib import Path,PurePosixPath
assert os.geteuid()==0
base=Path('/opt/aplyd-genie-staging'); revision='f05382771e6343d5c217a1212a64509919df890e'
lock=open('/run/lock/aplyd-genie-staging.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
old=(base/'current').resolve();assert old.name=='1e74e5e','Staging baseline changed'
release=base/'releases'/revision[:7];assert not release.exists(),'Candidate exists: inspect before replay'
private=base/'private';assert (private/'export-worker.env').stat().st_mode&0o777==0o600
archive=urllib.request.urlopen('https://codeload.github.com/nakul175/aplyd-genie/tar.gz/'+revision,timeout=30).read(20_000_001)
assert len(archive)<=20_000_000
release.mkdir(mode=0o755)
with tarfile.open(fileobj=io.BytesIO(archive),mode='r:gz') as tf:
 for member in tf.getmembers():
  parts=PurePosixPath(member.name).parts[1:]
  if not parts:continue
  assert '..' not in parts and not member.issym() and not member.islnk()
  destination=release.joinpath(*parts)
  if member.isdir():destination.mkdir(parents=True,exist_ok=True,mode=0o755)
  elif member.isfile():
   destination.parent.mkdir(parents=True,exist_ok=True,mode=0o755)
   destination.write_bytes(tf.extractfile(member).read());os.chmod(destination,0o644)
  else:raise RuntimeError('Unexpected archive entry')
for p in (old/'migrations').glob('00[1-7]*.sql'):assert p.read_bytes()==(release/'migrations'/p.name).read_bytes(),'Immutable migration changed'
backup=private/('genie5-before-'+str(int(time.time())));backup.mkdir(mode=0o700)
with open(backup/'genie.sql','xb') as out:
 os.chmod(backup/'genie.sql',0o600)
 subprocess.run(['docker','exec','aplyd-genie-staging-database-1','pg_dump','-U','genie_migrator','-d','genie_staging'],stdout=out,check=True)
(backup/'DEPLOYED.json').write_bytes((base/'DEPLOYED.json').read_bytes());os.chmod(backup/'DEPLOYED.json',0o600)
node='node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9'
common=['docker','run','--rm','--network','host','--memory','256m','--cpus','0.5','--cap-drop','ALL','--security-opt','no-new-privileges']
def run(command,label):
 with open(backup/(label+'.log'),'wb') as log:
  result=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT)
 assert result.returncode==0,label+' failed; inspect private log'
run(common+['-v',str(release)+':/app','-w','/app',node,'npm','ci','--omit=dev','--ignore-scripts'],'dependencies')
for n in (1,2):run(common+['--user','1000:1000','--env-file',str(private/'migration.env'),'-v',str(release)+':/app:ro','-w','/app',node,'node','scripts/migrate.mjs'],'migrate-'+str(n))
def apply_sql(name):
 with open(release/'ops/staging/genie-5'/(name+'.sql'),'rb') as source,open(backup/(name+'.log'),'wb') as log:
  subprocess.run(['docker','exec','-i','aplyd-genie-staging-database-1','psql','-X','-v','ON_ERROR_STOP=1','-U','genie_migrator','-d','genie_staging'],stdin=source,stdout=log,stderr=subprocess.STDOUT,check=True)
apply_sql('grants')
temporary=base/'current.genie5';assert not temporary.exists();temporary.symlink_to(release);os.replace(temporary,base/'current')
run(['docker','compose','-f',str(base/'compose.yml'),'up','-d','--no-deps','--force-recreate','app'],'restart-app')
for attempt in range(20):
 try:
  with urllib.request.urlopen('http://127.0.0.1:3910/health/live',timeout=3) as response:assert json.load(response)=={'status':'live'}
  break
 except Exception:
  if attempt==19:raise
  time.sleep(1)
apply_sql('fixture')
receipt={'status':'GENIE-5 deployed; acceptance pending','revision':revision,'previous_release':old.name,'new_migrations':['008','009'],
 'worker':'existing isolated credential; --once acceptance only','fixture':'only the approved synthetic workspace B and its two reviewed memberships','backup':str(backup)}
(base/'DEPLOYED.json').write_text(json.dumps(receipt,indent=2)+'\n')
print('GENIE5_DEPLOYED',revision,'migrations applied and replayed; app healthy; exact grants and synthetic fixture prepared')
