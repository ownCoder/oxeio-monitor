import {
  Body,
  Controller,
  Get,
  Header,
  Ip,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Type, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../auth/decorators';
import type { SessionUser } from '../auth/types';
import { ProductionService } from './production.service';
import { ProductResultsService } from './product-results.service';
import { QUEUES, type Queue } from './production.rules';
import { ActionDigestService } from './action-digest.service';
import { MonitorService } from './monitor.service';
import { TargetEvidenceService } from './target-evidence.service';

class DigestDto {
  @IsBoolean() enabled!: boolean;
  @IsInt() @Min(1) @Max(720) staleHours!: number;
}

class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  staffId?: number;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  before?: number;
  @IsOptional() @IsIn([...QUEUES]) queue?: Queue;
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period?: string;
}
class RangeQuery {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) from!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) to!: string;
}
class ReasonDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
class PlanDto extends ReasonDto {
  @IsInt() @Min(0) @Max(2) priority!: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDay?: string | null;
}
class AssignDto extends ReasonDto {
  @IsInt() @Min(1) employeeId!: number;
}
class UploadDto {
  @IsString() @MinLength(1) @MaxLength(120) filename!: string;
  @IsString() @MinLength(4) @MaxLength(2800000) base64!: string;
  @IsString() @MaxLength(1000) note!: string;
}
class CommentDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  x?: number;
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  y?: number;
}
class ResolveDto {
  @IsBoolean() resolved!: boolean;
}
class CsvDto {
  @IsString() @MinLength(1) @MaxLength(1000000) csv!: string;
}
class ImportDto extends CsvDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsBoolean() acceptUnmatched!: boolean;
}
class LinkDto {
  @IsInt() @Min(1) targetId!: number;
}
class CostDto {
  @IsString() @Matches(/^\d{1,10}(\.\d{1,2})?$/) amount!: string;
  @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsString() @MinLength(3) @MaxLength(500) note!: string;
}

@Controller('production')
@Roles(UserRole.owner, UserRole.manager, UserRole.researcher)
export class ProductionController {
  constructor(
    private readonly production: ProductionService,
    private readonly products: ProductResultsService,
    private readonly digest: ActionDigestService,
    private readonly monitor: MonitorService,
    private readonly evidence: TargetEvidenceService,
  ) {}
  @Roles(UserRole.owner, UserRole.manager, UserRole.researcher, UserRole.employee)
  @Get('targets/:id/evidence')
  @Header('Cache-Control', 'private, no-store')
  evidenceView(@CurrentUser() actor: SessionUser, @Param('id', ParseIntPipe) id: number, @Ip() ip: string) {
    return this.evidence.read(actor, id, ip);
  }
  @Roles(UserRole.owner) @Get('digest') digestPreview() {
    return this.digest.preview();
  }
  @Roles(UserRole.owner) @Patch('digest') digestConfig(
    @CurrentUser() actor: SessionUser,
    @Body() dto: DigestDto,
  ) {
    return this.digest.save(actor.userId, dto.enabled, dto.staleHours);
  }
  @Roles(UserRole.owner) @Get('monitor') monitoring() {
    return this.monitor.status();
  }
  @Get('board') board(@Query() q: PageQuery) {
    return this.production.board(q.staffId, q.q);
  }
  @Get('queue') queue(@Query() q: PageQuery) {
    return this.production.queue(
      q.queue ?? 'unstarted',
      q.page,
      q.staffId,
      q.q,
    );
  }
  @Roles(UserRole.owner, UserRole.manager) @Get('workload') workload() {
    return this.production.workload();
  }
  @Roles(UserRole.owner, UserRole.manager) @Get('quality') quality(
    @Query() q: RangeQuery,
  ) {
    return this.production.quality(q.from, q.to);
  }
  @Roles(UserRole.owner, UserRole.manager) @Patch('targets/:id/plan') plan(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PlanDto,
  ) {
    return this.production.plan(
      actor,
      id,
      dto.priority,
      dto.dueDay ?? null,
      dto.reason,
    );
  }
  @Roles(UserRole.owner, UserRole.manager)
  @Post('targets/:id/reassign')
  reassign(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignDto,
  ) {
    return this.production.reassign(actor, id, dto.employeeId, dto.reason);
  }
  @Roles(
    UserRole.owner,
    UserRole.manager,
    UserRole.researcher,
    UserRole.employee,
  )
  @Get('targets/:id/history')
  history(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() q: PageQuery,
  ) {
    return this.production.history(actor, id, q.before);
  }
  @Roles(
    UserRole.owner,
    UserRole.manager,
    UserRole.researcher,
    UserRole.employee,
  )
  @Get('targets/:id/previews')
  previews(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.production.previews(actor, id);
  }
  @Roles(
    UserRole.owner,
    UserRole.manager,
    UserRole.researcher,
    UserRole.employee,
  )
  @Post('targets/:id/previews')
  upload(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UploadDto,
  ) {
    return this.production.upload(
      actor,
      id,
      dto.filename,
      dto.base64,
      dto.note,
    );
  }
  @Roles(
    UserRole.owner,
    UserRole.manager,
    UserRole.researcher,
    UserRole.employee,
  )
  @Get('previews/:id/image')
  async image(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    const preview = await this.production.previewImage(actor, id);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(Buffer.from(preview.image), {
      type: preview.mime,
      disposition: 'inline',
    });
  }
  @Roles(
    UserRole.owner,
    UserRole.manager,
    UserRole.researcher,
    UserRole.employee,
  )
  @Post('previews/:id/comments')
  comment(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CommentDto,
  ) {
    return this.production.comment(actor, id, dto.text, dto.x, dto.y);
  }
  @Roles(
    UserRole.owner,
    UserRole.manager,
    UserRole.researcher,
    UserRole.employee,
  )
  @Patch('comments/:id')
  resolve(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolveDto,
  ) {
    return this.production.resolve(actor, id, dto.resolved);
  }

  @Roles(UserRole.owner) @Post('sales/preview') csvPreview(
    @Body() dto: CsvDto,
  ) {
    return this.products.preview(dto.csv);
  }
  @Roles(UserRole.owner) @Post('sales/import') csvImport(
    @CurrentUser() actor: SessionUser,
    @Body() dto: ImportDto,
  ) {
    return this.products.import(
      actor.userId,
      dto.csv,
      dto.name,
      dto.acceptUnmatched,
    );
  }
  @Roles(UserRole.owner) @Get('sales') sales(@Query() q: PageQuery) {
    return this.products.results(q.period, q.page);
  }
  @Roles(UserRole.owner) @Post('sales/:id/link') link(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LinkDto,
  ) {
    return this.products.link(actor.userId, id, dto.targetId);
  }
  @Roles(UserRole.owner) @Patch('targets/:id/cost') cost(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CostDto,
  ) {
    return this.products.cost(
      actor.userId,
      id,
      dto.amount,
      dto.currency,
      dto.note,
    );
  }
}
