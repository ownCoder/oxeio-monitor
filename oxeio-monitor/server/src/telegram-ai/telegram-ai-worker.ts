import {ConflictException,Injectable,Logger,OnApplicationBootstrap,OnModuleDestroy} from '@nestjs/common';
import {TelegramChannel} from '../alerts/telegram.channel';
import {PrismaService} from '../prisma/prisma.service';
import {TelegramAiAnswerService} from './telegram-ai-answer.service';
import {TelegramAiLinkService} from './telegram-ai-link.service';

type TelegramMessage={chat?:{id:number;type:string};from?:{id:number};text?:string};
type TelegramUpdate={update_id:number;message?:TelegramMessage};
type TelegramResult<T>={ok:boolean;result?:T};
const OFFSET_KEY='telegram_ai.update_offset';

@Injectable()
export class TelegramAiWorker implements OnApplicationBootstrap,OnModuleDestroy {
 private readonly logger=new Logger(TelegramAiWorker.name);
 private timer:NodeJS.Timeout|null=null;
 private running=false;
 private readonly recent=new Map<string,number[]>();
 constructor(private readonly prisma:PrismaService,private readonly telegram:TelegramChannel,private readonly links:TelegramAiLinkService,private readonly answers:TelegramAiAnswerService){}

 onApplicationBootstrap(){
  if(process.env.NODE_ENV==='test'||process.env.TELEGRAM_AI_ENABLED!=='true') return;
  this.timer=setInterval(()=>{void this.runOnce().catch(()=>this.logger.warn('Telegram AI poll failed'));},10_000);
  this.timer.unref();
  this.logger.log('Telegram AI polling enabled for private chats');
 }
 onModuleDestroy(){if(this.timer) clearInterval(this.timer);this.timer=null;}

 async runOnce():Promise<number>{
  if(this.running||process.env.TELEGRAM_AI_ENABLED!=='true') return 0;
  this.running=true;
  try{
   const settings=await this.telegram.resolve();
   if(!settings) return 0;
   const stored=await this.prisma.setting.findUnique({where:{key:OFFSET_KEY},select:{value:true}});
   const value=(stored?.value as {next?:unknown}|undefined)?.next;
   let offset=typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:0;
   const res=await fetch(`https://api.telegram.org/bot${settings.botToken}/getUpdates`,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({offset,limit:20,timeout:0,allowed_updates:['message']}),
    signal:AbortSignal.timeout(12_000),
   });
   if(!res.ok){this.logger.warn(`Telegram AI poll unavailable (HTTP ${res.status})`);return 0;}
   const payload=await res.json() as TelegramResult<TelegramUpdate[]>;
   if(!payload.ok||!Array.isArray(payload.result)) return 0;
   for(const update of payload.result){
    if(!Number.isSafeInteger(update.update_id)||update.update_id<offset) continue;
    if(update.message) await this.handle(settings.botToken,update.message);
    offset=update.update_id+1;
    await this.prisma.setting.upsert({
     where:{key:OFFSET_KEY},create:{key:OFFSET_KEY,value:{next:offset}},update:{value:{next:offset}},
    });
   }
   return payload.result.length;
  }finally{this.running=false;}
 }

 private async handle(token:string,message:TelegramMessage){
  if(message.chat?.type!=='private'||!message.from||!message.text||message.text.length>1500) return;
  const chatId=String(message.chat.id),telegramUserId=String(message.from.id);
  const text=message.text.trim();
  if(!text) return;
  if(!this.allowed(chatId)){
   await this.send(token,chatId,'এক মিনিটে অনেক প্রশ্ন হয়েছে। একটু পরে আবার চেষ্টা করুন।');
   return;
  }
  if(/^\/link(?:@\w+)?\s+/i.test(text)){
   const code=text.split(/\s+/)[1]??'';
   try{
    const linked=await this.links.link(code,chatId,telegramUserId);
    await this.send(token,chatId,linked?'Portal account যুক্ত হয়েছে। /help লিখে শুরু করুন।':'Code ভুল বা মেয়াদ শেষ। Portal থেকে নতুন code নিন।');
   }catch(err){
    await this.send(token,chatId,err instanceof ConflictException?'এই Telegram account অন্য portal user-এর সঙ্গে যুক্ত। আগে portal থেকে unlink করুন।':'Link করা যায়নি। একটু পরে চেষ্টা করুন।');
   }
   return;
  }
  const user=await this.links.linkedUser(chatId,telegramUserId);
  if(!user){await this.send(token,chatId,'প্রথমে oXeio portal-এর AI Manager পাতায় গিয়ে link code নিন, তারপর এখানে /link CODE পাঠান।');return;}
  if(/^\/unlink(?:@\w+)?$/i.test(text)){
   await this.links.unlink(user.id);
   await this.send(token,chatId,'Telegram account বিচ্ছিন্ন হয়েছে।');
   return;
  }
  const reply=await this.answers.answer(user,text);
  await this.send(token,chatId,reply);
 }

 private allowed(chatId:string){
  const now=Date.now();
  const recent=(this.recent.get(chatId)??[]).filter(time=>now-time<60_000);
  if(recent.length>=6){this.recent.set(chatId,recent);return false;}
  recent.push(now);this.recent.set(chatId,recent);
  return true;
 }

 private async send(token:string,chatId:string,text:string){
  try{
   const res=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({chat_id:chatId,text:text.slice(0,3500),disable_web_page_preview:true}),
    signal:AbortSignal.timeout(12_000),
   });
   if(!res.ok) this.logger.warn(`Telegram AI reply unavailable (HTTP ${res.status})`);
  }catch{this.logger.warn('Telegram AI reply failed');}
 }
}
