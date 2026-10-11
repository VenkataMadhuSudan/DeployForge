import { Module } from '@nestjs/common';
import { EnvVarsController } from './env-vars.controller';
import { EnvVarsService } from './env-vars.service';
import { AuthModule } from '../auth/auth.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [AuthModule, ProjectsModule],
  controllers: [EnvVarsController],
  providers: [EnvVarsService],
  exports: [EnvVarsService],
})
export class EnvVarsModule {}
