import {describe,it,expect} from 'vitest';
import {parsePoolView,viewSearch} from '../src/pages/targets/SavedViews';
describe('Shareable pool views',()=>{
 it('roundtrips names/search without query injection',()=>{const value={filter:'done',q:'B012345678 &other=x',staffId:'12',addedById:'4',from:'2026-09-01',to:'2026-09-28'};expect(parsePoolView(viewSearch(value))).toMatchObject(value);});
 it('roundtrips Review filters and rejects invalid values',()=>{const view={filter:'to_review',q:'',staffId:'',addedById:'',from:'',to:'',reviewType:'deleted',reviewReason:'copyright',reviewAge:'',reviewSort:'newest_deleted',reviewUndated:'true'};expect(parsePoolView(viewSearch(view))).toMatchObject(view);expect(parsePoolView('?reviewType=admin&reviewReason=fake&reviewSort=bad')).toMatchObject({reviewType:'',reviewReason:'',reviewSort:''});});
 it('does not restore removed queues or invalid staff IDs',()=>{expect(parsePoolView('?filter=to_upload&staffId=-1&addedById=abc&from=oops')).toMatchObject({filter:'all',staffId:'',addedById:'',from:''});});
 it('bounds externally supplied search text',()=>{expect(parsePoolView('?q='+('x'.repeat(1000))).q).toHaveLength(200);});
});
