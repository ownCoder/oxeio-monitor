import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser, Roles } from '../auth/decorators';
import type { SessionUser } from '../auth/types';
import {
  CreateEmployeeDto,
  DeactivateEmployeeDto,
  PolicySignedDto,
  UpdateEmployeeDto,
} from './dto';
import { EmployeesService } from './employees.service';
import type { EmployeeView } from './redact';

/**
 * E10 — স্টাফ ম্যানেজমেন্টের **লেখার** দিক। পুরো ক্লাসটাই owner-only,
 * মেথড-লেভেলে নয় — পরে কেউ নতুন endpoint যোগ করলে সেটাও আপনাআপনি
 * owner-only থাকবে (স্পেক § ৪.৩)।
 *
 * ⭐ **ব্যতিক্রম দুটো** — `create` ও `update`-এ ম্যানেজারও আছেন
 * *(১৫ আগস্ট)*। ⚠️ ওগুলোতে role **মেথডেই** শিথিল করা হয়েছে, ক্লাসে নয়:
 * তাহলে `deactivate` · `reactivate` · `policy-signed` · `agent/turn-on`
 * আগের মতোই owner-only থাকে, আর ভবিষ্যতের নতুন রুটও তাই থাকবে।
 *
 * ⚠️ পড়ার রুট (`GET /employees`) এখানে **নেই** — সেগুলো
 * `employees-read.controller.ts`-এ, কারণ ম্যানেজারেরও তালিকা দেখা লাগে।
 * এই ফাইলে `@Get` লিখলে ম্যানেজার স্টাফের নামও দেখতে পেত না।
 *
 * ⚠️ **কর্মী মোছার** কোনো `@Delete` নেই — ইচ্ছাকৃত, নিচে `deactivate` দেখুন।
 *    একমাত্র `DELETE` রুটটা `policy-signed`-এর, আর সেটা কর্মীর সারি নয়,
 *    শুধু একটা ভুল করে বসানো তারিখ তোলে।
 */
@Roles(UserRole.owner)
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  /**
   * `POST /api/v1/employees`
   *
   * ⭐ **ম্যানেজারও পারেন** *(মালিকের সিদ্ধান্ত, ১৫ আগস্ট)* — নতুন কর্মী
   * যোগ করা রোজকার কাজ, আর ওটার জন্য owner-কে ডাকতে হলে রোলআউটের দিন
   * সবাই আটকে থাকত।
   *
   * ⚠️ **বেতন তবু owner-এরই** — `EmployeesService` সেটা আলাদা করে আটকায়
   * ([ADR-023](../../../docs/05-Options-Decisions.md))। এখানে role
   * শিথিল করা আর ওখানে না আটকানো হলে ম্যানেজার এমন একটা ঘরে **লিখতে**
   * পারতেন যেটা তিনি **পড়তেও** পারেন না — দুটোর চেয়েও খারাপ।
   */
  @Roles(UserRole.owner, UserRole.manager)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() actor: SessionUser,
    @Body() dto: CreateEmployeeDto,
    @Ip() ip: string,
  ): Promise<EmployeeView> {
    return this.employees.create(actor, dto, ip);
  }

  /**
   * `PATCH /api/v1/employees/:id` — শুধু পাঠানো ফিল্ডগুলোই বদলায়।
   *
   * ⭐ ম্যানেজারও পারেন; ⚠️ বেতন বাদে (উপরে `create`-এর নোট)।
   */
  @Roles(UserRole.owner, UserRole.manager)
  @Patch(':id')
  update(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEmployeeDto,
    @Ip() ip: string,
  ): Promise<EmployeeView> {
    return this.employees.update(actor, id, dto, ip);
  }

  /**
   * `POST /api/v1/employees/:id/deactivate`
   *
   * ⚠️ ডিলিটের বদলে এটাই। DELETE রাখা হয়নি যাতে ফ্রন্টএন্ডে ভুল করেও
   * "মুছে ফেলা" বোতাম বসানোর সুযোগ না থাকে — সারিটা মুছলে ওই কর্মীর মাসের
   * হিসাব, স্ক্রিনশট আর audit trail সব অনাথ হয়ে যেত।
   */
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeactivateEmployeeDto,
    @Ip() ip: string,
  ): Promise<EmployeeView> {
    return this.employees.deactivate(actor, id, dto, ip);
  }

  /** `POST /api/v1/employees/:id/reactivate` */
  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Ip() ip: string,
  ): Promise<EmployeeView> {
    return this.employees.reactivate(actor, id, ip);
  }

  /**
   * ⭐ `POST /api/v1/employees/:id/agent/turn-on` — বন্ধ হয়ে যাওয়া এজেন্ট ফেরানো।
   *
   * ⚠️ কর্মী ধরে, ডিভাইস ধরে নয় — মালিক "ডিভাইস #৬১" নিয়ে ভাবেন না,
   * ভাবেন "Belal-এর PC" নিয়ে।
   */
  @Post(':id/agent/turn-on')
  @HttpCode(HttpStatus.OK)
  turnAgentOn(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Ip() ip: string,
  ): Promise<{ restored: number }> {
    return this.employees.turnAgentOn(actor, id, ip);
  }

  /**
   * ⭐ `POST /api/v1/employees/:id/policy-signed` — সই করা মনিটরিং পলিসি।
   *
   * বডি ঐচ্ছিক: `{ "signedOn": "2026-08-03" }`। না দিলে আজকের ঢাকার তারিখ।
   *
   * ⚠️ এটাই রোলআউটের একমাত্র শর্ত রেকর্ড করার জায়গা
   * ([01 § রোলআউট](../../../docs/01-Planning.md))। এতদিন কলামটা ছিল, পড়াও
   * হতো — শুধু বসানোর কোনো পথ ছিল না।
   */
  @Post(':id/policy-signed')
  @HttpCode(HttpStatus.OK)
  policySigned(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PolicySignedDto,
    @Ip() ip: string,
  ): Promise<EmployeeView> {
    return this.employees.setPolicySigned(actor, id, dto.signedOn, ip);
  }

  /**
   * `DELETE /api/v1/employees/:id/policy-signed` — ভুল করে বসানো সই তোলা।
   *
   * ⚠️ কর্মীর সারি মোছে না, শুধু তারিখটা শূন্য করে — আর ঘটনাটা audit-এ
   * আলাদা action হয়ে বসে।
   */
  @Delete(':id/policy-signed')
  @HttpCode(HttpStatus.OK)
  clearPolicySigned(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Ip() ip: string,
  ): Promise<EmployeeView> {
    return this.employees.clearPolicySigned(actor, id, ip);
  }
}
