import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../../common/types/request-with-context';
import { AuthService } from './auth.service';
import { ConfirmPasswordResetDto } from './dto/confirm-password-reset.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { VerifySecurityAnswerDto } from './dto/verify-security-answer.dto';

@Controller('auth')
@ApiTags('Auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register user (public patient self-registration)' })
  @ApiCreatedResponse({
    description:
      'User registered; response body includes access_token, expires_in, and session_id (same as login) so the client can authenticate immediately.'
  })
  @ApiConflictResponse({ description: 'Username taken or idempotency conflict' })
  @ApiUnprocessableEntityResponse({ description: 'Role not allowed or validation error' })
  register(@Body() payload: RegisterDto): Promise<{
    user_id: string;
    username: string;
    role: string;
    access_token: string;
    expires_in: number;
    session_id: string;
    refresh_token: string;
  }> {
    return this.authService.register(payload);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login and create authenticated session' })
  @ApiOkResponse({ description: 'Authenticated session with access token' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  login(@Body() payload: LoginDto): Promise<{
    access_token?: string;
    expires_in?: number;
    session_id?: string;
    refresh_token?: string;
    lockout_remaining_seconds?: number;
  }> {
    return this.authService.login(payload);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue a new access token using refresh token (rotates refresh token)' })
  @ApiOkResponse({ description: 'New access and refresh tokens' })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired refresh credentials' })
  refresh(@Body() payload: RefreshTokenDto): Promise<{
    access_token: string;
    expires_in: number;
    session_id: string;
    refresh_token: string;
  }> {
    return this.authService.refreshTokens(payload);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Logout and invalidate current session' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing token' })
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.authService.logout(user.sessionId);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Get current user profile and permissions' })
  @ApiOkResponse({ description: 'Authenticated user profile' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing token' })
  me(@CurrentUser() user: AuthenticatedUser): Promise<{
    user_id: string;
    username: string;
    roles: string[];
    permissions: string[];
  }> {
    return this.authService.me(user.userId);
  }

  @Get('security-questions')
  @ApiOperation({ summary: 'List active security questions (public)' })
  @ApiOkResponse({ description: 'Security questions list' })
  listSecurityQuestions(): Promise<unknown[]> {
    return this.authService.listSecurityQuestions();
  }

  @Post('password-reset/verify-security-answer')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify security answer and issue reset token' })
  @ApiOkResponse({ description: 'Reset token generated' })
  @ApiUnprocessableEntityResponse({ description: 'Invalid answer or validation error' })
  verifySecurityAnswer(@Body() payload: VerifySecurityAnswerDto): Promise<{ reset_token: string }> {
    return this.authService.verifySecurityAnswer(payload);
  }

  @Post('password-reset/confirm')
  @Idempotent()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Confirm password reset and invalidate existing sessions' })
  @ApiUnprocessableEntityResponse({ description: 'Invalid or expired reset token' })
  async confirmPasswordReset(@Body() payload: ConfirmPasswordResetDto): Promise<void> {
    await this.authService.confirmPasswordReset(payload);
  }
}
