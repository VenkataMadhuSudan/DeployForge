import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { loadConfig } from '@deployforge/configuration';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const config = loadConfig();

    let token = request.cookies?.['deployforge_token'];

    if (!token && request.headers.authorization) {
      const parts = request.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
        token = parts[1];
      }
    }

    if (!token) {
      throw new UnauthorizedException('Authentication credentials missing');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: config.JWT_SECRET,
      });
      request.user = {
        id: payload.sub,
        email: payload.email,
        name: payload.name ?? null,
        role: payload.role,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired authentication token');
    }
  }
}
