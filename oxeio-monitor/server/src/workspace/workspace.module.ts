import {Module} from '@nestjs/common';
import {OfficeModule} from '../office/office.module';
import {WorkspaceController} from './workspace.controller';
import {WorkspaceService} from './workspace.service';
@Module({imports:[OfficeModule],controllers:[WorkspaceController],providers:[WorkspaceService]})
export class WorkspaceModule {}
