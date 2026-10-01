export const BROWSER_INTERVAL_MS=30_000;
export const MAX_BROWSER_ADS=20;

// Fixed pacing reduces load. This is not fingerprinting or bot-detection evasion.
export async function waitForBrowserSlot(source:string,read:(source:string)=>number,write:(source:string,next:number)=>void,cancelled:()=>boolean,sleep:(ms:number)=>Promise<unknown>,now:()=>number=Date.now){
  while(!cancelled()){
    const remaining=read(source)-now();
    if(remaining<=0){write(source,now()+BROWSER_INTERVAL_MS);return true;}
    await sleep(Math.min(remaining,1000));
  }
  return false;
}
