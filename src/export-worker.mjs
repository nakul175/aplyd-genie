import pg from 'pg';
import {setTimeout as delay} from 'node:timers/promises';
import {readConfig} from './config.mjs';
import {IdentityStore} from './store.mjs';
import {createAccounts} from './accounts.mjs';
import {createSessionAuthenticator} from './authentication.mjs';
import {Permissions} from './permissions.mjs';
import {MemberExports,runMemberExport} from './exports.mjs';

// Separate bounded worker process. No model, user input, session hash or result is logged.
const once=process.argv.includes('--once');
let pool;
const stop=new AbortController();
process.once('SIGTERM',()=>stop.abort());
process.once('SIGINT',()=>stop.abort());
try{
 const config=readConfig(process.env);
 if(!process.env.DATABASE_URL)throw Error('Missing database');
 pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:3000,idleTimeoutMillis:30_000,statement_timeout:5000});
 pool.on('error',()=>console.error('genie_export_database_failed'));
 const dependencies={exports:new MemberExports(pool),permissions:new Permissions(pool),
  authenticateSession:createSessionAuthenticator({config,store:new IdentityStore(pool),accounts:createAccounts(config),background:true})};
 do{
  let result;
  try{result=await runMemberExport(dependencies);if(once||result.status!=='idle')console.log('genie_export_'+result.status);}
  catch{console.error('genie_export_attempt_failed');if(once)throw Error('Worker failed');}
  if(once||stop.signal.aborted)break;
  // Successful jobs drain serially. Idle/error waits do not reserve a DB connection.
  if(!result||result.status==='idle')await delay(2000,undefined,{signal:stop.signal}).catch(error=>{if(error.name!=='AbortError')throw error;});
 }while(!stop.signal.aborted);
}catch{console.error('genie_export_worker_failed');process.exitCode=1;}
finally{await pool?.end();}
