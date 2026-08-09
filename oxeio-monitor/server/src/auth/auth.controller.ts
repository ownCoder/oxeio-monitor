import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { AuthService, type MeResult } from './auth.service';
import {
  AllowWhileMustChangePw,
  CurrentUser,
  Public,
} from './decorators';
import { ChangePasswordDto, LoginDto } from './dto';
import { TokenService } from './token.service';
import type { SessionUser } from './types';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ mustChangePassword: boolean }> {
    const { user, mustChangePassword } = await this.auth.login(
      dto.email,
      dto.password,
      ip,
    );
    await this.tokens.issue(res, user);
    return { mustChangePassword };
  }

  @AllowWhileMustChangePw()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) res: Response): void {
    this.tokens.clear(res);
  }

  @AllowWhileMustChangePw()
  @Get('me')
  me(@CurrentUser() user: SessionUser): Promise<MeResult> {
    return this.auth.me(user.userId);
  }

  @AllowWhileMustChangePw()
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: SessionUser,
    @Body() dto: ChangePasswordDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.changePassword(
      user.userId,
      dto.currentPassword,
      dto.newPassword,
      ip,
    );
    // টোকেনে mustChangePw বসানো আছে — নতুন করে ইস্যু না করলে
    // পাসওয়ার্ড বদলানোর পরেও ইউজার আটকে থাকত
    await this.tokens.issue(res, { ...user, mustChangePw: false });
  }
}
