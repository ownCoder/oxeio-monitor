import {describe,expect,it} from 'vitest';
import {normalize,preflight} from '../src/office/office.rules';
describe('office content boundaries',()=>{
 it('rejects unsupported fields, arbitrary states and invalid calendar dates',()=>{
   expect(()=>normalize('sop',{body:'Instructions',salary:1})).toThrow('Unsupported');
   expect(()=>normalize('blocker',{category:'brief',detail:'Help',state:'approved'})).toThrow();
   expect(()=>normalize('asset',{tag:'PC-01',state:'spare',warranty:'2026-02-30'})).toThrow();
 });
 it('resets completed items in reusable lifecycle templates',()=>{
   expect(normalize('lifecycle_template',{type:'joining',tasks:[{label:'Training',done:true}]}).tasks).toEqual([{label:'Training',done:false,responsible:''}]);
 });
 it('warns about wrong file metadata, job number and incomplete checklist',()=>{
   expect(preflight({fileName:'wrong.png',format:'jpeg',width:1,height:2,checked:[false]},{format:'png',width:4500,height:5400,items:['Review']},1000010)).toHaveLength(5);
   expect(preflight({fileName:'1000010-design.png',format:'png',width:4500,height:5400,checked:[true]},{format:'png',width:4500,height:5400,items:['Review']},1000010)).toEqual([]);
 });
});
