/// <reference types="jest" />
/// <reference types="node" />
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ForbiddenException } from '@nestjs/common';
import { ProjectOwnershipGuard } from '../src/common/guards/project-ownership.guard';
import { ProjectsService } from '../src/modules/projects/projects.service';
import { EnvVarsService } from '../src/modules/env-vars/env-vars.service';
import { UserRole } from '@deployforge/shared-types';
import { prisma } from '@deployforge/database';

describe('Security & Multi-Tenant Isolation', () => {
  let guard: ProjectOwnershipGuard;

  beforeEach(() => {
    guard = new ProjectOwnershipGuard();
  });

  it('should deny User B from accessing User A project (BOLA/IDOR prevention)', async () => {
    const userA = { id: 'user-a-uuid', role: UserRole.USER };
    const userB = { id: 'user-b-uuid', role: UserRole.USER };

    const mockProject = {
      id: 'project-123',
      ownerId: 'user-a-uuid',
      members: [],
    };

    // Simulate ExecutionContext for User B attempting to access Project of User A
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: userB,
          params: { id: mockProject.id },
        }),
      }),
    } as any;

    // Spy on prisma
    const prismaSpy = jest.spyOn(prisma.project, 'findUnique');
    prismaSpy.mockResolvedValue(mockProject as any);

    await expect(guard.canActivate(mockContext)).rejects.toThrow(ForbiddenException);

    // Verify User A is granted access
    const mockContextUserA = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: userA,
          params: { id: mockProject.id },
        }),
      }),
    } as any;

    const allowed = await guard.canActivate(mockContextUserA);
    expect(allowed).toBe(true);
  });

  it('should allow Admin user to access any project', async () => {
    const adminUser = { id: 'admin-uuid', role: UserRole.ADMIN };
    const mockProject = {
      id: 'project-123',
      ownerId: 'user-a-uuid',
      members: [],
    };

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: adminUser,
          params: { id: mockProject.id },
        }),
      }),
    } as any;

    jest.spyOn(require('@deployforge/database').prisma.project, 'findUnique').mockResolvedValue(mockProject);

    const allowed = await guard.canActivate(mockContext);
    expect(allowed).toBe(true);
  });
});
