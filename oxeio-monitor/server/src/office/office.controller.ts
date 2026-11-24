import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Patch,
  Query,
} from '@nestjs/common';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser } from '../auth/decorators';
import type { SessionUser } from '../auth/types';
import { KINDS, type Kind } from './office.rules';
import { OfficeService } from './office.service';
class EntryDto {
  @IsIn(KINDS) kind!: Kind;
  @IsString() @MinLength(1) @MaxLength(120) title!: string;
  @IsObject() content!: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(1) @Max(2147483647) employeeId?: number;
  @IsOptional() @IsInt() @Min(1) @Max(2147483647) targetId?: number;
  @IsOptional() @IsInt() @Min(1) version?: number;
}
class PageDto {
  @IsOptional() @IsIn(KINDS) kind?: Kind;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page?: number;
  @IsOptional() @IsIn(['yes']) archived?: string;
}
class VersionDto {
  @IsInt() @Min(1) version!: number;
}
class ArchiveDto extends VersionDto {
  @IsBoolean() archived!: boolean;
}
@Controller('office')
export class OfficeController {
  constructor(private readonly office: OfficeService) {}
  @Get() list(@CurrentUser() actor: SessionUser, @Query() q: PageDto) {
    return this.office.list(actor, q);
  }
  @Get('people') people(@CurrentUser() actor: SessionUser) {
    return this.office.people(actor);
  }
  @Get('today') today(@CurrentUser() actor: SessionUser) {
    return this.office.today(actor);
  }
  @Get('designs') designs(
    @CurrentUser() actor: SessionUser,
    @Query() q: PageDto,
  ) {
    return this.office.designs(actor, q.q);
  }
  @Get('devices') devices(@CurrentUser() actor: SessionUser) {
    return this.office.devices(actor);
  }
  @Get(':id') get(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.office.get(actor, id);
  }
  @Post() create(@CurrentUser() actor: SessionUser, @Body() dto: EntryDto) {
    return this.office.save(actor, dto);
  }
  @Patch(':id') update(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EntryDto,
  ) {
    return this.office.save(actor, dto, id);
  }
  @Post(':id/ack') ack(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VersionDto,
  ) {
    return this.office.ack(actor, id, dto.version);
  }
  @Post(':id/archive') archive(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ArchiveDto,
  ) {
    return this.office.archive(actor, id, dto);
  }
}
