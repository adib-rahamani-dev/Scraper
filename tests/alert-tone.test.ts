import {expect,it,vi} from 'vitest';
import {playAlertTone} from '../src/shared/alert-tone.js';
function fixture(state='running') {
  const oscillators:Array<{type:string;frequency:{value:number};connect:ReturnType<typeof vi.fn>;disconnect:ReturnType<typeof vi.fn>;start:ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>;onended:null|(()=>void)}>=[];
  const gains:Array<{gain:{setValueAtTime:ReturnType<typeof vi.fn>;linearRampToValueAtTime:ReturnType<typeof vi.fn>;exponentialRampToValueAtTime:ReturnType<typeof vi.fn>};connect:ReturnType<typeof vi.fn>;disconnect:ReturnType<typeof vi.fn>}>=[];
  const context={state,currentTime:10,destination:{},createOscillator:()=>{const oscillator={type:'',frequency:{value:0},connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn(),onended:null};oscillators.push(oscillator);return oscillator;},createGain:()=>{const gain={gain:{setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()},connect:vi.fn(),disconnect:vi.fn()};gains.push(gain);return gain;}};
  return {context:context as unknown as Parameters<typeof playAlertTone>[0],oscillators,gains};
}
it('plays three spaced low-volume tones and releases each audio node',()=>{
  const f=fixture();playAlertTone(f.context);expect(f.oscillators).toHaveLength(3);
  f.oscillators.forEach((oscillator,index)=>{expect(oscillator.start).toHaveBeenCalledWith(10+index*0.3);expect(f.gains[index]!.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.12,10+index*0.3+0.02);oscillator.onended?.();expect(oscillator.disconnect).toHaveBeenCalledOnce();expect(f.gains[index]!.disconnect).toHaveBeenCalledOnce();});
});
it('does not claim to play while the browser has suspended audio',()=>{
  const f=fixture('suspended');expect(()=>playAlertTone(f.context)).toThrow('متوقف');expect(f.oscillators).toHaveLength(0);
});
