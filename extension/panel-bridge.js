(() => {
  const allowed=['status','configure','login','search','stop','resume','options'];
  window.addEventListener('message',async event=>{
    if(event.source!==window||event.origin!==location.origin||event.data?.type!=='lead-radar-command'||!allowed.includes(event.data.action))return;
    const {id,action,payload}=event.data;
    try{const response=await chrome.runtime.sendMessage({action,...payload});window.postMessage({type:'lead-radar-response',id,...response},location.origin);}
    catch(error){window.postMessage({type:'lead-radar-response',id,error:error.message},location.origin);}
  });
})();
