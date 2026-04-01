import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sign, verify } from 'jsonwebtoken';
import { AppException } from '../../common/exceptions/app.exception';

type AccessTokenPayload = {
  sub: string;
  session_id: string;
  jti: string;
};

@Injectable()
export class JwtService {
  constructor(private readonly configService: ConfigService) {}

  signAccessToken(payload: AccessTokenPayload): string {
    return sign(payload, this.configService.getOrThrow<string>('JWT_SECRET'), {
      expiresIn: this.configService.getOrThrow<number>('JWT_EXPIRES_IN_SECONDS')
    });
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      return verify(token, this.configService.getOrThrow<string>('JWT_SECRET')) as AccessTokenPayload;
    } catch {
      throw new AppException('UNAUTHORIZED', 'Invalid or expired access token', {}, 401);
    }
  }
}
