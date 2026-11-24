import {describe,it,expect} from 'vitest';
import {defaults,editable,taskProgress,applyChecklist,type Entry} from '../src/pages/office/office-view';
describe('office view state',()=>{
 it('does not submit server preflight output back as trusted fields',()=>{expect(editable({kind:'submission',content:{items:['Check'],warnings:['Wrong'],fileName:'file.png'}} as unknown as Entry)).toEqual({fileName:'file.png'});});
 it('creates independent lifecycle form state and counts actual completed tasks',()=>{const a=defaults('lifecycle'),b=defaults('lifecycle');(a.tasks as {done:boolean}[])[0].done=true;expect(taskProgress(a)).toBe('1/3 completed');expect(taskProgress(b)).toBe('0/3 completed');});
 it('changing a checklist clears previous checks but retains file metadata',()=>{const old={checked:[true],fileName:'1000010-cat.png',checklistVersion:1};expect(applyChecklist(old,{id:3,version:2,content:{items:['New check','Second check']}} as unknown as Entry)).toEqual({...old,checked:[false,false],checklistId:3,checklistVersion:2});expect(old.checked).toEqual([true]);});
});
