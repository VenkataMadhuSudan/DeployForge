import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { prisma, Project } from '@deployforge/database';
import { CreateProjectSchema, UpdateProjectSchema } from '@deployforge/validation';
import { SafeProject, SafeDeploymentSummary, DeploymentStatus, TriggerType } from '@deployforge/shared-types';

@Injectable()
export class ProjectsService {
  async createProject(userId: string, body: unknown): Promise<SafeProject> {
    const parsed = CreateProjectSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '));
    }

    const data = parsed.data;
    // Generate clean URL-friendly slug
    const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const project = await prisma.project.create({
      data: {
        name: data.name,
        slug,
        ownerId: userId,
        repoUrl: data.repoUrl,
        repoOwner: data.repoOwner,
        repoName: data.repoName,
        defaultBranch: data.defaultBranch,
        framework: data.framework,
        buildCommand: data.buildCommand ?? null,
        installCommand: data.installCommand ?? null,
        outputDirectory: data.outputDirectory,
        deploymentProvider: data.deploymentProvider,
      },
    });

    // Record audit log
    await prisma.auditLog.create({
      data: {
        actorId: userId,
        projectId: project.id,
        action: 'PROJECT_CREATED',
        resourceType: 'PROJECT',
        resourceId: project.id,
        metadata: JSON.stringify({ name: project.name, repo: `${data.repoOwner}/${data.repoName}` }),
      },
    });

    return this.mapSafeProject(project, null);
  }

  async listUserProjects(userId: string): Promise<SafeProject[]> {
    const projects = await prisma.project.findMany({
      where: {
        OR: [
          { ownerId: userId },
          { members: { some: { userId } } },
        ],
      },
      include: {
        deployments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return projects.map((p) => {
      const latest = p.deployments[0] ? this.mapSafeDeployment(p.deployments[0]) : null;
      return this.mapSafeProject(p, latest);
    });
  }

  async getProjectById(projectId: string): Promise<SafeProject> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        deployments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const latest = project.deployments[0] ? this.mapSafeDeployment(project.deployments[0]) : null;
    return this.mapSafeProject(project, latest);
  }

  async updateProject(projectId: string, actorId: string, body: unknown): Promise<SafeProject> {
    const parsed = UpdateProjectSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const updated = await prisma.project.update({
      where: { id: projectId },
      data: parsed.data,
      include: {
        deployments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId,
        projectId,
        action: 'PROJECT_UPDATED',
        resourceType: 'PROJECT',
        resourceId: projectId,
        metadata: JSON.stringify(parsed.data),
      },
    });

    const latest = updated.deployments[0] ? this.mapSafeDeployment(updated.deployments[0]) : null;
    return this.mapSafeProject(updated, latest);
  }

  async deleteProject(projectId: string, actorId: string): Promise<{ success: boolean }> {
    await prisma.project.delete({
      where: { id: projectId },
    });

    await prisma.auditLog.create({
      data: {
        actorId,
        action: 'PROJECT_DELETED',
        resourceType: 'PROJECT',
        resourceId: projectId,
      },
    });

    return { success: true };
  }

  private mapSafeProject(project: Project, latestDeployment: SafeDeploymentSummary | null): SafeProject {
    return {
      id: project.id,
      name: project.name,
      slug: project.slug,
      ownerId: project.ownerId,
      repoUrl: project.repoUrl,
      repoOwner: project.repoOwner,
      repoName: project.repoName,
      defaultBranch: project.defaultBranch,
      framework: project.framework as any,
      buildCommand: project.buildCommand,
      installCommand: project.installCommand,
      outputDirectory: project.outputDirectory,
      deploymentProvider: project.deploymentProvider as any,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      latestDeployment,
    };
  }

  private mapSafeDeployment(d: any): SafeDeploymentSummary {
    return {
      id: d.id,
      commitSha: d.commitSha,
      commitMessage: d.commitMessage,
      branch: d.branch,
      status: d.status as DeploymentStatus,
      triggerType: d.triggerType as TriggerType,
      deploymentUrl: d.deploymentUrl,
      startedAt: d.startedAt ? d.startedAt.toISOString() : null,
      completedAt: d.completedAt ? d.completedAt.toISOString() : null,
      createdAt: d.createdAt.toISOString(),
    };
  }
}
