import {expect,it} from 'vitest';
import {exportPhoneOnly} from '../src/shared/export-filter.js';
it('honors the complete work-list export without weakening default contact-only exports',()=>{
  expect(exportPhoneOnly('0')).toBe(false);
  for(const value of [undefined,'1','true',['0'],null])expect(exportPhoneOnly(value)).toBe(true);
});
