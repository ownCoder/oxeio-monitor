import {describe,expect,it,vi} from 'vitest';
import {UserRole} from '@prisma/client';
import {TelegramAiDataService} from '../src/telegram-ai/telegram-ai-data.service';
import {TelegramAiDataController} from '../src/telegram-ai/telegram-ai-data.controller';
import {TelegramAiAnswerService} from '../src/telegram-ai/telegram-ai-answer.service';
import type {PrismaService} from '../src/prisma/prisma.service';
import type {MeService} from '../src/me/me.service';
import type {ReportsService} from '../src/reports/reports.service';

describe('KIA live data boundary',()=>{
 it('rejects staff team and salary reads before querying the database',async()=>{
  const count=vi.fn();
  const data=new TelegramAiDataService({designTarget:{count},salaryPayment:{count}} as unknown as PrismaService);
  const staff={role:UserRole.employee,employeeId:7};
  await expect(data.read(staff,'pool')).rejects.toMatchObject({status:403});
  await expect(data.read(staff,'salary')).rejects.toMatchObject({status:403});
  expect(count).not.toHaveBeenCalled();
 });

 it('scopes the office snapshot to the linked employee',async()=>{
  const officeCount=vi.fn().mockResolvedValue(2);
  const targetCount=vi.fn().mockResolvedValue(4);
  const data=new TelegramAiDataService({officeEntry:{count:officeCount},designTarget:{count:targetCount}} as unknown as PrismaService);
  const result=await data.read({role:UserRole.employee,employeeId:7},'office');
  expect(result).toMatchObject({topic:'office',scope:'self',openHelp:2,assignedDesigns:4});
  expect(officeCount.mock.calls[0][0].where.employeeId).toBe(7);
  expect(targetCount.mock.calls[0][0].where.assignedToId).toBe(7);
 });

 it('returns current payment record counts only to the owner without amounts',async()=>{
  const employeeCount=vi.fn().mockResolvedValue(10);
  const paymentCount=vi.fn().mockResolvedValueOnce(8).mockResolvedValueOnce(5).mockResolvedValueOnce(2).mockResolvedValueOnce(1);
  const data=new TelegramAiDataService({employee:{count:employeeCount},salaryPayment:{count:paymentCount}} as unknown as PrismaService);
  await expect(data.read({role:UserRole.manager,employeeId:null},'salary')).rejects.toMatchObject({status:403});
  const result=await data.read({role:UserRole.owner,employeeId:null},'salary');
  expect(result).toMatchObject({topic:'salary',paid:5,partial:2,unpaid:1,unknown:2});
  expect(JSON.stringify(result)).not.toContain('paidAmount');
  expect(paymentCount.mock.calls[0][0].where.employee.status).toBe('active');
 });

 it('uses the same live data service for private bot commands',async()=>{
  const data={read:vi.fn().mockResolvedValue({topic:'pool',asOf:'2026-10-11',available:12,inHand:3,completed:9,skipped:2,deleted:1}),render:TelegramAiDataService.prototype.render};
  const answers=new TelegramAiAnswerService({} as PrismaService,{} as MeService,{} as ReportsService,data as unknown as TelegramAiDataService);
  const response=await answers.answer({id:1,fullName:'Owner',role:UserRole.owner,employeeId:null},'/pool');
  expect(response).toContain('Pool 12');
  expect(data.read).toHaveBeenCalledWith(expect.objectContaining({role:UserRole.owner}),'pool');
 });

 it('rejects unknown endpoint topics',()=>{
  const controller=new TelegramAiDataController({} as TelegramAiDataService);
  expect(()=>controller.read({role:UserRole.owner,employeeId:null} as never,'all-secrets')).toThrow('Choose a supported data topic');
 });
});
