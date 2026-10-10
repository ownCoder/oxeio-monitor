import {createHash,randomBytes} from 'node:crypto';
import {ConflictException,Injectable} from '@nestjs/common';
import {PrismaService} from '../prisma/prisma.service';

const hashCode=(code:string)=>createHash('sha256').update(code.toUpperCase()).digest('hex');

@Injectable()
export class TelegramAiLinkService {
 constructor(private readonly prisma:PrismaService){}

 async status(userId:number){
  const row=await this.prisma.telegramAiAccount.findUnique({where:{userId},select:{linkedAt:true}});
  return {linked:Boolean(row?.linkedAt),linkedAt:row?.linkedAt?.toISOString()??null};
 }

 async createCode(userId:number){
  const code=randomBytes(6).toString('hex').toUpperCase();
  const expiresAt=new Date(Date.now()+10*60_000);
  await this.prisma.telegramAiAccount.upsert({
   where:{userId},
   create:{userId,codeHash:hashCode(code),codeExpiresAt:expiresAt},
   update:{codeHash:hashCode(code),codeExpiresAt:expiresAt},
  });
  return {code,expiresAt:expiresAt.toISOString()};
 }

 async unlink(userId:number){
  await this.prisma.telegramAiAccount.deleteMany({where:{userId}});
  return {linked:false};
 }

 async link(code:string,chatId:string,telegramUserId:string):Promise<boolean>{
  if(!/^[A-F0-9]{12}$/i.test(code)) return false;
  const codeHash=hashCode(code);
  const row=await this.prisma.telegramAiAccount.findUnique({
   where:{codeHash},include:{user:{select:{isActive:true,mustChangePw:true}}},
  });
  if(!row?.user.isActive||row.user.mustChangePw||!row.codeExpiresAt||row.codeExpiresAt<=new Date()) return false;
  const already=await this.prisma.telegramAiAccount.findFirst({where:{OR:[{chatId},{telegramUserId}],userId:{not:row.userId}},select:{userId:true}});
  if(already) throw new ConflictException('This Telegram account is linked to another portal user. Unlink it in the portal first.');
  const updated=await this.prisma.telegramAiAccount.updateMany({
   where:{userId:row.userId,codeHash,codeExpiresAt:{gt:new Date()}},
   data:{chatId,telegramUserId,linkedAt:new Date(),codeHash:null,codeExpiresAt:null},
  });
  return updated.count===1;
 }

 async linkedUser(chatId:string,telegramUserId:string){
  const row=await this.prisma.telegramAiAccount.findFirst({
   where:{chatId,telegramUserId,linkedAt:{not:null}},
   include:{user:{select:{id:true,fullName:true,role:true,employeeId:true,isActive:true,mustChangePw:true}}},
  });
  if(!row?.user.isActive||row.user.mustChangePw) return null;
  return row.user;
 }
}
