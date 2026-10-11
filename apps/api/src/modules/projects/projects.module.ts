import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { AuthModule } from '../auth/auth.module';
import { ProjectOwnershipGuard } from '../../common/guards/project-ownership.guard';

@Module({
  imports: [AuthModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectOwnershipGuard],
  exports: [ProjectsService, ProjectOwnershipGuard],
})
export class ProjectsModule {}
