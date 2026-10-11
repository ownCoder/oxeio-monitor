import {describe,it,expect} from 'vitest';
import {parsePoolView,viewSearch} from '../src/pages/targets/SavedViews';
describe('Shareable pool views',()=>{
 it('roundtrips names/search without query injection',()=>{const value={filter:'done',q:'B012345678 &other=x',staffId:'12',addedById:'4',from:'2026-09-01',to:'2026-09-28'};expect(parsePoolView(viewSearch(value))).toMatchObject(value);});
 it('roundtrips Review filters and rejects invalid values',()=>{const view={filter:'to_review',q:'',staffId:'',addedById:'',from:'',to:'',reviewType:'deleted',reviewReason:'copyright',reviewAge:'',reviewSort:'newest_deleted',reviewUndated:'true'};expect(parsePoolView(viewSearch(view))).toMatchObject(view);expect(parsePoolView('?reviewType=admin&reviewReason=fake&reviewSort=bad')).toMatchObject({reviewType:'',reviewReason:'',reviewSort:''});});
 it('preserves Birthday in review and pool reason links',()=>{expect(parsePoolView('?reviewReason=birthday&poolReason=birthday')).toMatchObject({reviewReason:'birthday',poolReason:'birthday'});});
 it('roundtrips Design Pool progress, reason, added dates and sort',()=>{const view={filter:'all',q:'',staffId:'',addedById:'',from:'',to:'',poolProgress:'started',poolReason:'copyright',addedFrom:'2026-10-01',addedTo:'2026-10-10',poolSort:'added_oldest'};expect(parsePoolView(viewSearch(view))).toMatchObject(view);expect(parsePoolView('?poolProgress=done&poolReason=fake&addedFrom=oops&poolSort=random')).toMatchObject({poolProgress:'',poolReason:'',addedFrom:'',poolSort:''});});
 it('does not restore removed queues or invalid staff IDs',()=>{expect(parsePoolView('?filter=to_upload&staffId=-1&addedById=abc&from=oops')).toMatchObject({filter:'all',staffId:'',addedById:'',from:''});});
 it('bounds externally supplied search text',()=>{expect(parsePoolView('?q='+('x'.repeat(1000))).q).toHaveLength(200);});
});
