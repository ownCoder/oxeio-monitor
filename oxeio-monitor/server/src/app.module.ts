import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import { ActivityModule } from './activity/activity.module';
import { AdminModule } from './admin/admin.module';
import { AgentModule } from './agent/agent.module';
import { AlertsModule } from './alerts/alerts.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { PayrollModule } from './payroll/payroll.module';
import { ReportsModule } from './reports/reports.module';
import { ScreenshotsModule } from './screenshots/screenshots.module';
import { SummaryModule } from './summary/summary.module';
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
    ActivityModule,
    AdminModule,
    DashboardModule,
    PayrollModule,
    ReportsModule,
    ScreenshotsModule,
    // ⚠️ SummaryModule নিজের ভেতরে ScheduleModule.forRoot() রাখে (টেস্টে বাদ পড়ে)।
    // এখানে আলাদা করে forRoot() বসিয়ো না — দুটো explorer একই @Cron দুবার
    // রেজিস্টার করতে গিয়ে bootstrap-এই "cron job already exists" দিয়ে ভাঙবে।
    SummaryModule,
    AlertsModule,
    HealthModule,
  ],
})
export class AppModule {}
