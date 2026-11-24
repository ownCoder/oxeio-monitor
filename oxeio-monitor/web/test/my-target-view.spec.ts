import {afterEach,describe,expect,it,vi} from 'vitest';
import {byJobNumber,readSelectedTarget,rememberSelectedTarget} from '../src/pages/targets/my-target-view';
afterEach(()=>vi.unstubAllGlobals());
describe('Personal target view',()=>{
 it('orders numbers numerically, keeps unnumbered targets last and preserves the API array',()=>{const rows=[{id:1,jobNumber:100},{id:2,jobNumber:null},{id:3,jobNumber:9},{id:4,jobNumber:10}];expect(byJobNumber(rows).map(r=>r.id)).toEqual([3,4,1,2]);expect(rows.map(r=>r.id)).toEqual([1,2,3,4]);});
 it('restores selection for its own account only',()=>{const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)});rememberSelectedTarget(1,42);expect(readSelectedTarget(1)).toBe(42);expect(readSelectedTarget(2)).toBe(null);});
 it('tolerates blocked browser storage',()=>{vi.stubGlobal('localStorage',{getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('blocked');}});expect(readSelectedTarget(1)).toBe(null);expect(()=>rememberSelectedTarget(1,42)).not.toThrow();});
});
