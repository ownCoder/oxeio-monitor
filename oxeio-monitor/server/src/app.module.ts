import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import { AgentModule } from './agent/agent.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { PayrollModule } from './payroll/payroll.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        // টেস্টে প্রতিটি রিকোয়েস্টের লগ আসল ফলাফল ঢেকে দেয়
        level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
        transport:
          process.env.NODE_ENV === 'production' ||
          process.env.NODE_ENV === 'test'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
        redact: {
          // এজেন্টের টোকেন, সেশন cookie বা কারো পাসওয়ার্ড যেন কখনো লগে না ওঠে
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-csrf-token"]',
            'res.headers["set-cookie"]',
            'req.body.password',
            'req.body.currentPassword',
            'req.body.newPassword',
          ],
          remove: true,
        },
      },
    }),
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    AgentModule,
    PayrollModule,
    HealthModule,
  ],
})
export class AppModule {}
