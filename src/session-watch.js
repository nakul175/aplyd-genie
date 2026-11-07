// UI hygiene only. Every native request independently checks current authority.
(() => {
  let pending=false, stopped=false, uncertain=false;
  const content=document.querySelector('main');
  if(!content)return;
  const clear=(message,signin)=>{
    const title=document.createElement('h1');title.textContent=message;
    const link=document.createElement('a');link.href=signin?'/auth/sign-in':'/workspace';
    link.textContent=signin?'Continue with Aplyd':'Try workspace again';
    content.replaceChildren(title,link);
  };
  async function check(){
    if(pending||stopped||document.visibilityState==='hidden')return;
    pending=true;
    try{
      const response=await fetch('/api/auth/session',{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(4000)});
      if([401,403,409].includes(response.status)){
        stopped=true;clear('Your workspace access changed',true);clearInterval(timer);
      }else if(!response.ok){uncertain=true;clear('Workspace access could not be verified',false)}
      else if(uncertain){stopped=true;location.reload()}
    }catch{uncertain=true;clear('Workspace access could not be verified',false)}
    finally{pending=false}
  }
  const timer=setInterval(check,5000);
  window.addEventListener('focus',check);
  document.addEventListener('visibilitychange',check);
  window.addEventListener('pagehide',()=>{stopped=true;clearInterval(timer)},{once:true});
  check();
})();
