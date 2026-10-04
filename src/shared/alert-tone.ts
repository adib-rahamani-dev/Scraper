// No remote sound assets: a short three-note warning at a modest volume.
type ToneNode={connect(destination:object):unknown;disconnect():void};
type ToneDevice={state:string;currentTime:number;destination:object;createOscillator:()=>ToneNode & {type:string;frequency:{value:number};onended:unknown;start:(time:number)=>void;stop:(time:number)=>void};createGain:()=>ToneNode & {gain:{setValueAtTime:(value:number,time:number)=>unknown;linearRampToValueAtTime:(value:number,time:number)=>unknown;exponentialRampToValueAtTime:(value:number,time:number)=>unknown}}};
export function playAlertTone(context:ToneDevice) {
  if(context.state!=='running')throw new Error('پخش صدا در مرورگر متوقف است؛ دکمهٔ فعال‌کردن صدا را بزن.');
  const start=context.currentTime;
  for(let index=0;index<3;index++) {
    const oscillator=context.createOscillator();const gain=context.createGain();
    const at=start+index*0.3;
    oscillator.type='sine';oscillator.frequency.value=index===1?1040:780;
    gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(0.12,at+0.02);gain.gain.exponentialRampToValueAtTime(0.001,at+0.22);
    oscillator.connect(gain);gain.connect(context.destination);
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
    oscillator.start(at);oscillator.stop(at+0.24);
  }
}
