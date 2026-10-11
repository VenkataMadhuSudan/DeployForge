import { Controller, Post, Get, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { EnvVarsService } from './env-vars.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectOwnershipGuard } from '../../common/guards/project-ownership.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SafeUser } from '@deployforge/shared-types';

@Controller('projects/:projectId/env')
@UseGuards(JwtAuthGuard, ProjectOwnershipGuard)
export class EnvVarsController {
  constructor(private readonly envVarsService: EnvVarsService) {}

  @Post()
  async setVariable(
    @Param('projectId') projectId: string,
    @CurrentUser() user: SafeUser,
    @Body() body: unknown
  ) {
    return this.envVarsService.setVariable(projectId, user.id, body);
  }

  @Get()
  async listVariables(@Param('projectId') projectId: string) {
    return this.envVarsService.listVariables(projectId);
  }

  @Delete(':varId')
  async deleteVariable(
    @Param('projectId') projectId: string,
    @Param('varId') varId: string,
    @CurrentUser() user: SafeUser
  ) {
    return this.envVarsService.deleteVariable(projectId, varId, user.id);
  }
}
