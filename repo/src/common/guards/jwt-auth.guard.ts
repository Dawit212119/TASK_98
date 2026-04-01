import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from '../../modules/auth/auth.service';
import { AppException } from '../exceptions/app.exception';
import { RequestWithContext } from '../types/request-with-context';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const authorization = request.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      throw new AppException('UNAUTHORIZED', 'Missing or invalid Authorization header', {}, 401);
    }

    const token = authorization.replace('Bearer ', '').trim();
    const user = await this.authService.validateAccessToken(token);
    request.user = user;
    return true;
  }
}
