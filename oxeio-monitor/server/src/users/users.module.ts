import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { EmployeePortalController } from './employee-portal.controller';
import { UsersController } from './users.controller';

@Module({
  imports: [AuthModule],
  controllers: [UsersController, EmployeePortalController],
})
export class UsersModule {}
