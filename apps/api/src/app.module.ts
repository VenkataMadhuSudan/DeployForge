import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { EnvVarsModule } from './modules/env-vars/env-vars.module';
import { DeploymentsModule } from './modules/deployments/deployments.module';
import { LogsModule } from './modules/logs/logs.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    AuthModule,
    ProjectsModule,
    EnvVarsModule,
    DeploymentsModule,
    LogsModule,
    WebhooksModule,
    HealthModule,
  ],
})
export class AppModule {}
