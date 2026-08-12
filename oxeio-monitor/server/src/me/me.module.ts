import { Module } from '@nestjs/common';

import { AgentModule } from '../agent/agent.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

/**
 * **J04 · J05 · J08** — কর্মীর নিজের পাতা।
 *
 * ⚠️ `AgentModule` ইমপোর্ট করা হয়েছে শুধু `ProgressService`-এর জন্য।
 * নকল করে আরেকটা হিসাব লিখলে একদিন tray আর ওয়েব দুই সংখ্যা দেখাত —
 * আর যে ফিচারের পুরো উদ্দেশ্য আস্থা, সেটাই তখন আস্থা ভাঙত।
 *
 * ⚠️ `PrismaModule` `@Global`, তাই আলাদা import লাগে না।
 */
@Module({
  imports: [AgentModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
