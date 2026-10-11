import { CanActivate, ExecutionContext, Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { prisma } from '@deployforge/database';
import { UserRole } from '@deployforge/shared-types';

@Injectable()
export class ProjectOwnershipGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('User is not authenticated');
    }

    const projectId = request.params.projectId || request.params.id;
    if (!projectId) {
      return true; // No project parameter on route
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        members: {
          where: { userId: user.id },
        },
      },
    });

    if (!project) {
      throw new NotFoundException(`Project not found`);
    }

    // Admins bypass project-level ownership
    if (user.role === UserRole.ADMIN) {
      request.project = project;
      return true;
    }

    const isOwner = project.ownerId === user.id;
    const isMember = project.members.length > 0;

    if (!isOwner && !isMember) {
      throw new ForbiddenException('You do not have authorization to access this project');
    }

    request.project = project;
    return true;
  }
}
