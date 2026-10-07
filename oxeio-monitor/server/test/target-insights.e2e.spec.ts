import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {TargetInsightsController,insightRange} from '../src/targets/target-insights.controller';
import {createHarness,resetDatabase,loginReady,hashPassword,OWNER_EMAIL,OWNER_PASSWORD,type Harness} from './setup/harness';
import {dhakaNoon} from './setup/clock';
let h:Harness,controller:TargetInsightsController,owner:number,employee:number,target:number;
const at=dhakaNoon(); const day=new Date(at.getTime()+21600000).toISOString().slice(0,10);
beforeAll(async()=>{h=await createHarness();controller=h.app.get(TargetInsightsController);});
afterAll(async()=>{await h.close();});
beforeEach(async()=>{await resetDatabase(h.prisma,h.app);owner=(await h.prisma.user.findFirstOrThrow({where:{role:'owner'}})).id;employee=(await h.prisma.employee.create({data:{empCode:'INSIGHT-1',fullName:'Insight fixture',staffType:'designer'}})).id;target=(await h.prisma.designTarget.create({data:{asin:'B000000001',addedById:owner}})).id;});
async function assigned(id=target) {await h.prisma.designTargetEvent.create({data:{targetId:id,action:'assigned',source:'fixture',afterState:{status:'assigned',assigned_to_id:employee},recordedAt:at}});}
async function skip(decision:string,id=target) {await h.prisma.designSkipRequest.create({data:{targetId:id,employeeId:employee,decision,reason:'copyright',requestedAt:at}});}
describe('Recorded target insights',()=>{
 it('rejects invalid/reversed/oversized dates and uses Dhaka midnight',()=>{for(const [from,to] of [['2026-02-30',day],[day,'bad'],['2026-09-02','2026-09-01'],['2025-01-01','2026-09-01']])expect(()=>insightRange(from,to)).toThrow();expect(insightRange('2026-09-28','2026-09-28').start.toISOString()).toBe('2026-09-27T18:00:00.000Z');});
 it('does not double count repeated assignments or rejected/repeated requests in rate',async()=>{await assigned();await assigned();await skip('automatic');await skip('rejected');const result=await controller.skips(day,day);expect(result.rows).toEqual([expect.objectContaining({assigned:1,requests:2,automatic:1,rejected:1,cohortSkipped:1,skipRate:100,outsideCohort:0})]);});
 it('keeps carry-in requests visible with an unknown rate',async()=>{await skip('pending');expect((await controller.skips(day,day)).rows).toEqual([expect.objectContaining({assigned:0,pending:1,outsideCohort:1,skipRate:null})]);});
 it('shows zero percent when recorded assignments have no request',async()=>{await assigned();expect((await controller.skips(day,day)).rows).toEqual([expect.objectContaining({requests:0,assigned:1,skipRate:0})]);});
 it('counts daily completions and successful skips, with pending separate',async()=>{
  await h.prisma.designTarget.update({where:{id:target},data:{assignedToId:employee,status:'done',completedAt:at}});
  await skip('automatic');await skip('approved');await skip('rejected');
  const another=(await h.prisma.designTarget.create({data:{asin:'B000000002',addedById:owner}})).id;
  await skip('pending',another);
  const row=(await controller.daily(day,day)).rows.find(r=>r.employeeId===employee);
  expect(row).toMatchObject({date:day,completed:1,skipped:3,pending:1});
 });
 it('shows issued work, skip reason and a replacement moving from owed to delivered',async()=>{
  await assigned();
  const request=await h.prisma.designSkipRequest.create({data:{targetId:target,employeeId:employee,decision:'automatic',reason:'events',requestedAt:at,replacementDue:true}});
  expect((await controller.daily(day,day)).rows.find(r=>r.employeeId===employee)).toMatchObject({issued:1,skipped:1,events:1,notFound:0,copyright:0,replacementOwed:1,replacementIssued:0});
  const replacement=(await h.prisma.designTarget.create({data:{asin:'B000000003',addedById:owner}})).id;
  await h.prisma.designSkipRequest.update({where:{id:request.id},data:{replacementDue:false,replacementTargetId:replacement,replacementIssuedAt:at}});
  expect((await controller.daily(day,day)).rows.find(r=>r.employeeId===employee)).toMatchObject({replacementOwed:0,replacementIssued:1});
 });
 it('shows unavailable historical skips instead of zero and limits daily ranges',async()=>{
  const old=(await controller.daily('2026-09-27','2026-09-27')).rows.find(r=>r.employeeId===employee);
  expect(old).toMatchObject({completed:0,skipped:null,pending:null});
  await expect(controller.daily('2026-09-01','2026-10-03')).rejects.toThrow();
 });
 it('paginates timeline without duplicates and rejects bad cursors',async()=>{await h.prisma.designTargetEvent.createMany({data:Array.from({length:53},()=>({targetId:target,action:'assigned',source:'fixture',afterState:{status:'assigned'},recordedAt:at}))});const first=await controller.history(target);expect(first.rows).toHaveLength(50);const next=await controller.history(target,String(first.nextBefore));expect(next.rows.some(r=>first.rows.some(f=>f.id===r.id))).toBe(false);await expect(controller.history(target,'NaN')).rejects.toThrow();await expect(controller.history(target+10000)).rejects.toThrow();});
 it('restricts all actual HTTP routes to management',async()=>{await h.prisma.user.create({data:{email:'research-insight@test.local',fullName:'Researcher fixture',role:'researcher',passwordHash:await hashPassword('insight-password-123'),mustChangePw:false}});const research=await loginReady(h,'research-insight@test.local','insight-password-123');await research.http.get(`/api/v1/target-insights/daily?from=${day}&to=${day}`).expect(403);await research.http.get(`/api/v1/target-insights/skips?from=${day}&to=${day}`).expect(403);await research.http.get(`/api/v1/target-insights/${target}/history`).expect(403);const boss=await loginReady(h,OWNER_EMAIL,OWNER_PASSWORD);await boss.http.get(`/api/v1/target-insights/daily?from=${day}&to=${day}`).expect(200);await boss.http.get(`/api/v1/target-insights/skips?from=${day}&to=${day}`).expect(200);await boss.http.get(`/api/v1/target-insights/${target}/history?before=bad`).expect(400);});
});
