import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SafeUser } from '@deployforge/shared-types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SafeUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  }
);
