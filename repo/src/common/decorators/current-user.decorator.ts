import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser, RequestWithContext } from '../types/request-with-context';

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
  const request = ctx.switchToHttp().getRequest<RequestWithContext>();
  return request.user;
});
