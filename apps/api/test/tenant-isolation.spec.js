"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@nestjs/common");
const project_ownership_guard_1 = require("../src/common/guards/project-ownership.guard");
const shared_types_1 = require("@deployforge/shared-types");
describe('Security & Multi-Tenant Isolation', () => {
    let guard;
    beforeEach(() => {
        guard = new project_ownership_guard_1.ProjectOwnershipGuard();
    });
    it('should deny User B from accessing User A project (BOLA/IDOR prevention)', async () => {
        const userA = { id: 'user-a-uuid', role: shared_types_1.UserRole.USER };
        const userB = { id: 'user-b-uuid', role: shared_types_1.UserRole.USER };
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
        };
        // Spy on prisma
        const prismaSpy = jest.spyOn(require('@deployforge/database').prisma.project, 'findUnique');
        prismaSpy.mockResolvedValue(mockProject);
        await expect(guard.canActivate(mockContext)).rejects.toThrow(common_1.ForbiddenException);
        // Verify User A is granted access
        const mockContextUserA = {
            switchToHttp: () => ({
                getRequest: () => ({
                    user: userA,
                    params: { id: mockProject.id },
                }),
            }),
        };
        const allowed = await guard.canActivate(mockContextUserA);
        expect(allowed).toBe(true);
    });
    it('should allow Admin user to access any project', async () => {
        const adminUser = { id: 'admin-uuid', role: shared_types_1.UserRole.ADMIN };
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
        };
        jest.spyOn(require('@deployforge/database').prisma.project, 'findUnique').mockResolvedValue(mockProject);
        const allowed = await guard.canActivate(mockContext);
        expect(allowed).toBe(true);
    });
});
//# sourceMappingURL=tenant-isolation.spec.js.map