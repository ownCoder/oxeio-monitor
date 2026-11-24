import { Module } from '@nestjs/common';
import { OfficeController } from './office.controller';
import { OfficeService } from './office.service';
@Module({ controllers: [OfficeController], providers: [OfficeService], exports: [OfficeService] })
export class OfficeModule {}
