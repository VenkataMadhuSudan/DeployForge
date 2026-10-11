import { Injectable, ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { prisma, UserRole as PrismaUserRole } from '@deployforge/database';
import { RegisterSchema, LoginSchema } from '@deployforge/validation';
import { SafeUser, UserRole } from '@deployforge/shared-types';

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  async register(body: unknown): Promise<{ user: SafeUser; token: string }> {
    const parsed = RegisterSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const { email, password, name } = parsed.data;

    const existing = await prisma.user.findUnique({
      where: { email },
    });
    if (existing) {
      throw new ConflictException('A user with this email address already exists');
    }

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: name ?? null,
        role: PrismaUserRole.USER,
      },
    });

    const token = await this.generateToken(user.id, user.email, user.name, user.role as unknown as UserRole);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role as unknown as UserRole,
        createdAt: user.createdAt.toISOString(),
      },
      token,
    };
  }

  async login(body: unknown): Promise<{ user: SafeUser; token: string }> {
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Invalid credentials payload');
    }

    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Use generic error message to prevent account enumeration
      throw new UnauthorizedException('Invalid email or password');
    }

    const isValid = await argon2.verify(user.passwordHash, password);
    if (!isValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const token = await this.generateToken(user.id, user.email, user.name, user.role as unknown as UserRole);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role as unknown as UserRole,
        createdAt: user.createdAt.toISOString(),
      },
      token,
    };
  }

  async getProfile(userId: string): Promise<SafeUser> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as unknown as UserRole,
      createdAt: user.createdAt.toISOString(),
    };
  }

  private async generateToken(userId: string, email: string, name: string | null, role: UserRole): Promise<string> {
    return this.jwtService.signAsync({
      sub: userId,
      email,
      name,
      role,
    });
  }
}
