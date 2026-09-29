import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import type {SessionUser} from '../src/auth/types';
import {WorkspaceService,deadlineState} from '../src/workspace/workspace.service';
import {OfficeService} from '../src/office/office.service';
import {createHarness,resetDatabase,realNow,type Harness} from './setup/harness';
let h:Harness,workspace:WorkspaceService,office:OfficeService,owner:SessionUser,alice:SessionUser,bob:SessionUser,targetId:number;
beforeAll(async()=>{h=await createHarness();workspace=h.app.get(WorkspaceService);office=h.app.get(OfficeService);});
afterAll(async()=>{await h.close();});
beforeEach(async()=>{
 await resetDatabase(h.prisma,h.app);
 const o=await h.prisma.user.findFirstOrThrow({where:{role:'owner'}});
 owner={userId:o.id,email:o.email,role:'owner',employeeId:null,mustChangePw:false,issuedAt:0};
 async function staff(code:string){const employee=await h.prisma.employee.create({data:{empCode:code,fullName:code,staffType:'designer'}});const user=await h.prisma.user.create({data:{email:`${code}@test.local`,fullName:code,passwordHash:o.passwordHash,role:'employee',employeeId:employee.id,mustChangePw:false}});return {...owner,userId:user.id,email:user.email,role:'employee' as const,employeeId:employee.id};}
 alice=await staff('ALICE');bob=await staff('BOB');
 targetId=(await h.prisma.designTarget.create({data:{asin:'B000000001',addedById:owner.userId,status:'assigned',assignedToId:alice.employeeId,assignedAt:realNow(),jobNumber:1000010,dueAt:new Date(realNow().getTime()+3600000)}})).id;
});
describe('workspace access, receipts and live reminders',()=>{
 it('search follows assignment and Office scopes, and exposes no other staff',async()=>{
  const entry=await office.save(alice,{kind:'blocker',title:'Private ALICE request',employeeId:alice.employeeId!,targetId,content:{category:'tool',detail:'Need help',state:'open',response:''}});
  expect((await workspace.search(bob,'B000000001')).rows).toHaveLength(0);
  expect((await workspace.search(bob,'ALICE')).rows).toHaveLength(0);
  expect((await workspace.search(alice,'1000010')).rows[0].href).toContain(`target=${targetId}`);
  expect((await workspace.search(owner,'Private')).rows[0].href).toContain(`entry=${entry.id}`);
  expect((await workspace.search(alice,' ')).rows).toHaveLength(0);
 });
 it('read receipts persist per account and cannot mark another users notice',async()=>{
  const inbox=await workspace.notices(alice);expect(inbox.unread).toBeGreaterThan(0);
  const key=inbox.rows.find(r=>r.category==='Assignment')!.key;
  await workspace.read(alice,key);await workspace.read(alice,key);
  expect((await workspace.notices(alice)).rows.find(r=>r.key===key)?.read).toBe(true);
  expect(await h.prisma.workspaceReceipt.count()).toBe(1);
  await expect(workspace.read(bob,key)).rejects.toThrow('not found');
  expect((await workspace.notices(owner)).rows.find(r=>r.key===key)?.read).toBe(false);
 });
 it('completion, reassignment and changed due dates remove stale reminders',async()=>{
  expect((await workspace.deadlines(alice)).rows[0].state).toBe('due-soon');
  expect((await workspace.notices(bob)).rows).toHaveLength(0);
  await h.prisma.designTarget.update({where:{id:targetId},data:{assignedToId:bob.employeeId}});
  expect((await workspace.deadlines(alice)).rows).toHaveLength(0);
  expect((await workspace.deadlines(bob)).rows).toHaveLength(1);
  await h.prisma.designTarget.update({where:{id:targetId},data:{status:'done',completedAt:realNow()}});
  expect((await workspace.deadlines(bob)).rows).toHaveLength(0);
  expect((await workspace.notices(bob)).rows).toHaveLength(0);
 });
 it('help responses notify their owner and stay private after search and inbox',async()=>{
  const row=await office.save(alice,{kind:'blocker',title:'Help for ALICE',employeeId:alice.employeeId!,targetId,content:{category:'tool',detail:'Need help',state:'open',response:''}});
  await office.save(owner,{kind:'blocker',title:row.title,employeeId:alice.employeeId!,targetId,version:row.version,content:{category:'tool',detail:'Need help',state:'resolved',response:'Fixed'}},row.id);
  expect((await workspace.notices(alice)).rows.some(r=>r.category==='Help update')).toBe(true);
  expect((await workspace.notices(bob)).rows).toHaveLength(0);
 });
 it('due-soon becomes a fresh overdue notice even if the earlier one was read',async()=>{
  const now=realNow();await h.prisma.designTarget.update({where:{id:targetId},data:{dueAt:new Date(now.getTime()+60000)}});
  const soon=(await workspace.notices(alice,now)).rows.find(r=>r.category==='Deadline')!;
  await workspace.read(alice,soon.key);
  const late=(await workspace.notices(alice,new Date(now.getTime()+120000))).rows.find(r=>r.category==='Deadline')!;
  expect(late.key).not.toBe(soon.key);expect(late.read).toBe(false);
  expect(deadlineState(new Date(now.getTime()+86400001),now)).toBe('scheduled');
 });
});
