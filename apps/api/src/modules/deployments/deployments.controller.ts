import { Controller, Post, Get, Body, Param, Query, UseGuards } from '@nestjs/common';
import { DeploymentsService } from './deployments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectOwnershipGuard } from '../../common/guards/project-ownership.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SafeUser, TriggerType } from '@deployforge/shared-types';

@Controller('projects/:projectId/deployments')
@UseGuards(JwtAuthGuard, ProjectOwnershipGuard)
export class DeploymentsController {
  constructor(private readonly deploymentsService: DeploymentsService) {}

  @Post()
  async triggerDeployment(
    @Param('projectId') projectId: string,
    @CurrentUser() user: SafeUser,
    @Body() body: unknown
  ) {
    return this.deploymentsService.triggerDeployment(projectId, user.id, TriggerType.MANUAL, body);
  }

  @Get()
  async listDeployments(
    @Param('projectId') projectId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.deploymentsService.listDeployments(projectId, pageNum, limitNum);
  }

  @Get(':deploymentId')
  async getDeployment(
    @Param('projectId') projectId: string,
    @Param('deploymentId') deploymentId: string
  ) {
    return this.deploymentsService.getDeployment(projectId, deploymentId);
  }

  @Post(':deploymentId/cancel')
  async cancelDeployment(
    @Param('projectId') projectId: string,
    @Param('deploymentId') deploymentId: string,
    @CurrentUser() user: SafeUser
  ) {
    return this.deploymentsService.cancelDeployment(projectId, deploymentId, user.id);
  }

  @Post(':deploymentId/rollback')
  async rollback(
    @Param('projectId') projectId: string,
    @Param('deploymentId') deploymentId: string,
    @CurrentUser() user: SafeUser
  ) {
    return this.deploymentsService.rollback(projectId, deploymentId, user.id);
  }
}
