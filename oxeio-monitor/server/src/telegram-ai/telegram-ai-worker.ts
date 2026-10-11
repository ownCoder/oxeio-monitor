import {ConflictException,Injectable,Logger,OnApplicationBootstrap,OnModuleDestroy} from '@nestjs/common';
import {TelegramChannel} from '../alerts/telegram.channel';
import {PrismaService} from '../prisma/prisma.service';
import {TelegramAiAnswerService} from './telegram-ai-answer.service';
import {TelegramAiLinkService} from './telegram-ai-link.service';
import {dailyCompletionCap} from '../summary/design.rules';

type TelegramMessage={message_id?:number;chat?:{id:number;type:string;title?:string};from?:{id:number;is_bot?:boolean};text?:string};
type TelegramUpdate={update_id:number;message?:TelegramMessage};
type TelegramResult<T>={ok:boolean;result?:T};
const OFFSET_KEY='telegram_ai.update_offset';
const GROUP_KEY='telegram_ai.group';
const groupBotName=()=>process.env.TELEGRAM_AI_BOT_USERNAME?.trim()||'oXeioAlertsBot';
type GroupConfig={chatId:string;title:string;startTime:string;graceMinutes:number;enabled:boolean};
const dhakaParts=(date:Date)=>{
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
 const value=(part:string)=>parts.find(row=>row.type===part)?.value||'00';
 return {day:`${value('year')}-${value('month')}-${value('day')}`,time:`${value('hour')}:${value('minute')}`};
};

@Injectable()
export class TelegramAiWorker implements OnApplicationBootstrap,OnModuleDestroy {
 private readonly logger=new Logger(TelegramAiWorker.name);
 private timer:NodeJS.Timeout|null=null;
 private running=false;
 private readonly recent=new Map<string,number[]>();
 private reminderRunning=false;
 constructor(private readonly prisma:PrismaService,private readonly telegram:TelegramChannel,private readonly links:TelegramAiLinkService,private readonly answers:TelegramAiAnswerService){}

 onApplicationBootstrap(){
  if(process.env.NODE_ENV==='test'||process.env.TELEGRAM_AI_ENABLED!=='true') return;
  void this.runOnce().catch(()=>this.logger.warn('Telegram AI poll failed'));
  this.timer=setInterval(()=>{void this.runOnce().catch(()=>this.logger.warn('Telegram AI poll failed'));},2_000);
  this.timer.unref();
  this.logger.log('Telegram AI polling enabled for private and registered group chats');
 }
 onModuleDestroy(){if(this.timer) clearInterval(this.timer);this.timer=null;}

 async runOnce():Promise<number>{
  if(this.running||process.env.TELEGRAM_AI_ENABLED!=='true') return 0;
  this.running=true;
  try{
   const settings=await this.telegram.resolve();
   if(!settings) return 0;
   void this.runScheduled(settings.botToken).catch(()=>this.logger.warn('Telegram AI group reminder failed'));
   const stored=await this.prisma.setting.findUnique({where:{key:OFFSET_KEY},select:{value:true}});
   const value=(stored?.value as {next?:unknown}|undefined)?.next;
   let offset=typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:0;
   const res=await fetch(`https://api.telegram.org/bot${settings.botToken}/getUpdates`,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({offset,limit:20,timeout:20,allowed_updates:['message']}),
    signal:AbortSignal.timeout(27_000),
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
  if(!message.chat||!message.from||message.from.is_bot||!message.text||message.text.length>1500) return;
  if(message.chat.type==='group'||message.chat.type==='supergroup') return this.handleGroup(token,message);
  if(message.chat.type!=='private') return;
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
  let typingInterval:NodeJS.Timeout|null=null;
  const typingDelay=setTimeout(()=>{
   void this.typing(token,chatId);
   typingInterval=setInterval(()=>{void this.typing(token,chatId);},4_000);
   typingInterval.unref();
  },1_000);
  typingDelay.unref();
  const started=Date.now();
  let reply:string;
  try{reply=await this.answers.answer(user,text);}
  finally{clearTimeout(typingDelay);if(typingInterval) clearInterval(typingInterval);}
  const elapsed=Date.now()-started;
  if(elapsed>10_000) this.logger.warn(`Telegram AI answer took ${elapsed}ms`);
  await this.send(token,chatId,reply);
 }

 private async groupConfig():Promise<GroupConfig|null>{
  const row=await this.prisma.setting.findUnique({where:{key:GROUP_KEY},select:{value:true}});
  const value=row?.value;
  if(!value||typeof value!=='object'||Array.isArray(value)) return null;
  const config=value as Record<string,unknown>;
  if(typeof config.chatId!=='string'||typeof config.title!=='string'||typeof config.startTime!=='string'||typeof config.graceMinutes!=='number') return null;
  return {chatId:config.chatId,title:config.title,startTime:config.startTime,graceMinutes:config.graceMinutes,enabled:config.enabled===true};
 }

 private async groupAdmin(token:string,chatId:string,userId:number):Promise<boolean>{
  try{
   const res=await fetch(`https://api.telegram.org/bot${token}/getChatMember`,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({chat_id:chatId,user_id:userId}),signal:AbortSignal.timeout(8_000),
   });
   if(!res.ok) return false;
   const payload=await res.json() as TelegramResult<{status?:string}>;
   return payload.ok&&(payload.result?.status==='creator'||payload.result?.status==='administrator');
  }catch{return false;}
 }

 private async handleGroup(token:string,message:TelegramMessage){
  const chat=message.chat,from=message.from;
  if(!chat||!from||!message.text) return;
  const chatId=String(chat.id),bot=groupBotName(),raw=message.text.trim();
  const command=/^\/([a-z]+)(?:@([A-Za-z0-9_]+))?(?:\s|$)/i.exec(raw);
  if(command?.[2]&&command[2].toLowerCase()!==bot.toLowerCase()) return;
  const mention=new RegExp(`@${bot}(?![A-Za-z0-9_])`,'i');
  if(!command&&!mention.test(raw)) return;
  if(!this.allowed(`${chatId}:${from.id}`)) return;
  const user=await this.links.linkedUserByTelegramId(String(from.id));
  const reply=(text:string)=>this.send(token,chatId,text,message.message_id);
  if(command?.[1]?.toLowerCase()==='setup'){
   if(!user||!['owner','manager'].includes(user.role)||!await this.groupAdmin(token,chatId,from.id)){
    await reply('Group চালু করতে linked owner/manager-কে Telegram group admin হতে হবে। আগে bot-এর private chat-এ portal থেকে /link CODE দিয়ে যুক্ত হন।');return;
   }
   const existing=await this.groupConfig();
   if(existing?.enabled&&existing.chatId!==chatId){
    const ownerRebind=user.role==='owner'&&existing.title===chat.title&&/^\/setup(?:@\w+)?\s+migrate$/i.test(raw);
    if(!ownerRebind){await reply('AI Manager অন্য chat ID-তে চালু আছে। Telegram group upgrade হলে linked owner এই group-এ /setup@'+bot+' migrate দিন; অন্য group হলে পুরোনো group-এ /groupoff দিন।');return;}
   }
   const config:GroupConfig=existing?.enabled||existing?.chatId===chatId?{...existing,chatId,title:(chat.title||existing.title).slice(0,100),enabled:true}:
    {chatId,title:(chat.title||'oXeio Office').slice(0,100),startTime:'09:00',graceMinutes:15,enabled:true};
   await this.prisma.setting.upsert({where:{key:GROUP_KEY},create:{key:GROUP_KEY,value:config,updatedById:user.id},update:{value:config,updatedById:user.id}});
   await reply('oXeio AI Manager এই group-এ চালু। প্রশ্ন করতে @'+bot+' লিখুন বা /guide@'+bot+' দিন। ব্যক্তিগত account আগে bot-এর private chat-এ link করতে হবে। সকাল, tracked-start, skip-review এবং সন্ধ্যার কাজের reminder চালু আছে; /schedule দিয়ে start time বদলানো যায়।');
   return;
  }
  const config=await this.groupConfig();
  if(!config?.enabled||config.chatId!==chatId) return;
  if(!user){await reply('AI Manager ব্যবহার করতে আগে bot-এর private chat-এ portal থেকে /link CODE দিয়ে account যুক্ত করুন। Code group-এ লিখবেন না।');return;}
  const action=command?.[1]?.toLowerCase();
  if(action==='groupoff'){
   if(!['owner','manager'].includes(user.role)||!await this.groupAdmin(token,chatId,from.id)){await reply('শুধু linked owner/manager group admin এটি বন্ধ করতে পারেন।');return;}
   await this.prisma.setting.update({where:{key:GROUP_KEY},data:{value:{...config,enabled:false},updatedById:user.id}});
   await reply('AI Manager group mode বন্ধ করা হয়েছে। Private chat চালু আছে।');return;
  }
  if(action==='schedule'){
   if(!['owner','manager'].includes(user.role)||!await this.groupAdmin(token,chatId,from.id)){await reply('শুধু linked owner/manager group admin সময় বদলাতে পারেন।');return;}
   const parts=raw.split(/\s+/),time=parts[1],grace=Number(parts[2]);
   if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time||'')||!Number.isInteger(grace)||grace<0||grace>90){await reply('ব্যবহার: /schedule@'+bot+' HH:mm grace_minutes — যেমন 09:00 15। ঢাকা সময়।');return;}
   await this.prisma.setting.update({where:{key:GROUP_KEY},data:{value:{...config,startTime:time,graceMinutes:grace},updatedById:user.id}});
   await reply(`Tracked-start check: ${time} + ${grace} মিনিট। এটি PC-র প্রথম tracked activity, অফিসে আসার প্রমাণ নয়।`);return;
  }
  if(action==='groupstatus'){await reply(`Group mode চালু। ঢাকা সময় start ${config.startTime} + ${config.graceMinutes} মিনিট grace। Morning 08:05, first-activity 12:00, skip review 15:00, hours/praise 18:45।`);return;}
  const question=raw.replace(new RegExp(`@${bot}(?![A-Za-z0-9_])`,'ig'),'').trim();
  if(!question) {await reply('প্রশ্নটি @'+bot+'-এর পরে লিখুন, অথবা /guide@'+bot+' দিন।');return;}
  if(action==='hours'||/(?:ঘণ্টা|hours|hour|কতক্ষণ)/iu.test(question)){
   const report=await this.scheduledText('evening',config,dhakaParts(new Date()).day);
   await reply(report||'আজকের credited hours এখনও রেকর্ড হয়নি। কিছুক্ষণ পরে আবার দেখুন।');return;
  }
  if(action==='late'||/(?:late|দেরি)/iu.test(question)){
   const report=await this.scheduledText('late',config,dhakaParts(new Date()).day);
   await reply(report||'আজ নির্ধারিত সময়ের পরে প্রথম tracked activity রেকর্ড নেই। এটি উপস্থিতির নিশ্চয়তা নয়।');return;
  }
  const answer=await this.answers.groupAnswer(user,question);
  await reply(answer);
 }

 private async runScheduled(token:string,now=new Date()):Promise<void>{
  if(this.reminderRunning) return;
  this.reminderRunning=true;
  try{
   const config=await this.groupConfig();
   if(!config?.enabled) return;
   const {day,time}=dhakaParts(now);
   const windows=[{kind:'morning',at:'08:05',end:'08:25'},{kind:'late',at:'12:00',end:'12:20'},
    {kind:'review',at:'15:00',end:'15:20'},{kind:'evening',at:'18:45',end:'19:05'}] as const;
   for(const window of windows){
    if(time<window.at||time>window.end) continue;
    const key=`telegram_ai.group_notice.${window.kind}`;
    const marker=await this.prisma.setting.findUnique({where:{key},select:{value:true}});
    const previous=marker?.value;
    if(previous&&typeof previous==='object'&&!Array.isArray(previous)&&previous.day===day&&previous.chatId===config.chatId) continue;
    const message=await this.scheduledText(window.kind,config,day);
    if(!message) continue;
    if(await this.send(token,config.chatId,message)){
     await this.prisma.setting.upsert({where:{key},create:{key,value:{day,chatId:config.chatId}},update:{value:{day,chatId:config.chatId}}});
    }
   }
  }finally{this.reminderRunning=false;}
 }

 private async scheduledText(kind:'morning'|'late'|'review'|'evening',config:GroupConfig,day:string):Promise<string|null>{
  const dayStart=new Date(`${day}T00:00:00+06:00`),dayEnd=new Date(dayStart.getTime()+86_400_000);
  if(kind==='morning'){
   const assigned=await this.prisma.designTarget.count({where:{assignedAt:{gte:dayStart,lt:dayEnd}}});
   return assigned>0?`🌅 আজ ${assigned}টি design assignment দেওয়া হয়েছে। প্রত্যেকে My Data-তে নিজের কাজ ও অগ্রাধিকার দেখে শুরু করুন। বাধা থাকলে group-এ @${groupBotName()} লিখে জিজ্ঞেস করুন।`:null;
  }
  if(kind==='review'){
   const pending=await this.prisma.designSkipRequest.count({where:{decision:'pending'}});
   return pending>0?`📌 ${pending}টি skip request manager review-এর অপেক্ষায় আছে। Manager/owner, portal-এর Review page দেখে সিদ্ধান্ত দিন।`:null;
  }
  const summaries=await this.prisma.dailySummary.findMany({where:{workDate:new Date(`${day}T00:00:00Z`)},
   select:{employeeId:true,firstActivityAt:true,creditedSec:true,designsDone:true,dayType:true}});
  if(kind==='late'){
   const threshold=new Date(`${day}T${config.startTime}:00+06:00`).getTime()+config.graceMinutes*60_000;
   const late=summaries.filter(row=>row.firstActivityAt&&row.firstActivityAt.getTime()>threshold&&row.dayType!=='holiday');
   if(late.length===0) return null;
   const employees=await this.prisma.employee.findMany({where:{id:{in:late.map(row=>row.employeeId)},status:'active'},select:{id:true,empCode:true,fullName:true}});
   const byId=new Map(employees.map(row=>[row.id,row]));
   const lines=late.flatMap(row=>{
    const employee=byId.get(row.employeeId);
    if(!employee||!row.firstActivityAt) return [];
    const first=dhakaParts(row.firstActivityAt).time;
    return [`${employee.empCode} ${employee.fullName}: ${first}`];
   });
   return lines.length?`🕘 আজ ${config.startTime} + ${config.graceMinutes} মিনিটের পরে প্রথম tracked PC activity:\n${lines.join('\n')}\nএটি অফিসে পৌঁছানোর সময়ের প্রমাণ নয়; প্রয়োজন হলে attendance যাচাই করুন।`:null;
  }
  const employees=await this.prisma.employee.findMany({where:{status:'active'},
   select:{id:true,empCode:true,fullName:true,staffType:true,dailyDesignTarget:true,policy:{select:{dailyDesignTarget:true}}},orderBy:{empCode:'asc'}});
  const byId=new Map(summaries.map(row=>[row.employeeId,row]));
  if(!employees.some(employee=>byId.get(employee.id)?.creditedSec)) return null;
  const lines=employees.map(employee=>{
   const row=byId.get(employee.id);
   return `${employee.empCode} ${employee.fullName}: ${row?(Math.round(row.creditedSec/360)/10).toFixed(1)+'h':'tracked data নেই'}${row?.designsDone?`, ${row.designsDone} design`:''}`;
  });
  const praised=employees.filter(employee=>{
   const row=byId.get(employee.id),target=dailyCompletionCap(employee.staffType,employee.dailyDesignTarget,employee.policy?.dailyDesignTarget);
   return row&&target!==null&&row.creditedSec>=28_800&&row.designsDone>=target;
  }).map(employee=>`${employee.empCode} ${employee.fullName}`);
  return `📊 ${day} · 18:45 পর্যন্ত credited কাজ\n${lines.join('\n')}\n${praised.length?'🌟 ৮ ঘণ্টা ও design target—দুটোই পূরণ করেছেন: '+praised.join(', ')+'। দারুণ কাজ!':'আজকের progress চলমান; কাজ সম্পন্ন হলে My Data মিলিয়ে নিন।'}\nঘণ্টা পরে বদলাতে পারে; এটি attendance বা salary সিদ্ধান্ত নয়।`;
 }

 private async typing(token:string,chatId:string){
  try{
   await fetch(`https://api.telegram.org/bot${token}/sendChatAction`,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({chat_id:chatId,action:'typing'}),
    signal:AbortSignal.timeout(5_000),
   });
  }catch{/* The final answer is still attempted if the indicator fails. */}
 }

 private allowed(chatId:string){
  const now=Date.now();
  const recent=(this.recent.get(chatId)??[]).filter(time=>now-time<60_000);
  if(recent.length>=6){this.recent.set(chatId,recent);return false;}
  recent.push(now);this.recent.set(chatId,recent);
  return true;
 }

 private async send(token:string,chatId:string,text:string,replyTo?:number):Promise<boolean>{
  try{
   const res=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({chat_id:chatId,text:text.slice(0,3500),disable_web_page_preview:true,
     ...(replyTo?{reply_parameters:{message_id:replyTo,allow_sending_without_reply:true}}:{})}),
    signal:AbortSignal.timeout(12_000),
   });
   if(!res.ok) this.logger.warn(`Telegram AI reply unavailable (HTTP ${res.status})`);
   return res.ok;
  }catch{this.logger.warn('Telegram AI reply failed');return false;}
 }
}
