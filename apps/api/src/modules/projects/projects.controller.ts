import { Controller, Post, Get, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectOwnershipGuard } from '../../common/guards/project-ownership.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SafeUser } from '@deployforge/shared-types';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  async createProject(@CurrentUser() user: SafeUser, @Body() body: unknown) {
    return this.projectsService.createProject(user.id, body);
  }

  @Get()
  async listProjects(@CurrentUser() user: SafeUser) {
    return this.projectsService.listUserProjects(user.id);
  }

  @Get(':id')
  @UseGuards(ProjectOwnershipGuard)
  async getProject(@Param('id') id: string) {
    return this.projectsService.getProjectById(id);
  }

  @Patch(':id')
  @UseGuards(ProjectOwnershipGuard)
  async updateProject(@Param('id') id: string, @CurrentUser() user: SafeUser, @Body() body: unknown) {
    return this.projectsService.updateProject(id, user.id, body);
  }

  @Delete(':id')
  @UseGuards(ProjectOwnershipGuard)
  async deleteProject(@Param('id') id: string, @CurrentUser() user: SafeUser) {
    return this.projectsService.deleteProject(id, user.id);
  }
}
