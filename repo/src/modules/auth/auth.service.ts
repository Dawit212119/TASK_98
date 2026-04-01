import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { AppException } from '../../common/exceptions/app.exception';
import { AccessControlService } from '../access-control/access-control.service';
import { ConfirmPasswordResetDto } from './dto/confirm-password-reset.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifySecurityAnswerDto } from './dto/verify-security-answer.dto';
import { PasswordResetTokenEntity } from './entities/password-reset-token.entity';
import { SecurityAnswerEntity } from './entities/security-answer.entity';
import { SecurityQuestionEntity } from './entities/security-question.entity';
import { SessionEntity } from './entities/session.entity';
import { UserEntity } from './entities/user.entity';
import { JwtService } from './jwt.service';
import { computeLoginLockoutUntil, DEFAULT_LOGIN_LOCK_THRESHOLD } from './auth-lockout.policy';

const LOGIN_LOCK_THRESHOLD = DEFAULT_LOGIN_LOCK_THRESHOLD;
const RESET_VERIFY_LOCK_THRESHOLD = 5;
const RESET_VERIFY_LOCK_MINUTES = 15;

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    @Inject(forwardRef(() => AccessControlService))
    private readonly accessControlService: AccessControlService,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(SessionEntity)
    private readonly sessionRepository: Repository<SessionEntity>,
    @InjectRepository(SecurityQuestionEntity)
    private readonly securityQuestionRepository: Repository<SecurityQuestionEntity>,
    @InjectRepository(SecurityAnswerEntity)
    private readonly securityAnswerRepository: Repository<SecurityAnswerEntity>,
    @InjectRepository(PasswordResetTokenEntity)
    private readonly passwordResetTokenRepository: Repository<PasswordResetTokenEntity>
  ) {}

  async register(payload: RegisterDto): Promise<{
    user_id: string;
    username: string;
    role: string;
    access_token: string;
    expires_in: number;
    session_id: string;
  }> {
    if (payload.role !== 'patient') {
      throw new AppException(
        'AUTH_REGISTRATION_ROLE_NOT_ALLOWED',
        'Public self-registration only supports the patient role',
        {},
        422
      );
    }

    const existing = await this.userRepository.findOne({ where: { username: payload.username } });
    if (existing) {
      throw new AppException('AUTH_USERNAME_TAKEN', 'Username is already registered', {}, 409);
    }

    const qRaw = (payload.security_question_id ?? '').trim();
    const aRaw =
      typeof payload.security_answer === 'string' ? payload.security_answer.trim() : '';
    const hasQuestion = qRaw.length > 0;
    const hasAnswer = aRaw.length > 0;

    if (hasQuestion !== hasAnswer) {
      throw new AppException(
        'AUTH_SECURITY_PAIR_INCOMPLETE',
        'Provide both security_question_id and security_answer, or omit both',
        {},
        422
      );
    }

    let questionIdForSave: string | null = null;
    let answerHashForSave: string | null = null;

    if (hasQuestion && hasAnswer) {
      const question = await this.securityQuestionRepository.findOne({
        where: { id: qRaw, active: true }
      });

      if (!question) {
        throw new AppException('AUTH_SECURITY_QUESTION_NOT_FOUND', 'Security question not found', {}, 404);
      }

      questionIdForSave = qRaw;
      answerHashForSave = await bcrypt.hash(aRaw.toLowerCase(), 10);
    }

    const role = await this.accessControlService.findRoleByName(payload.role);
    if (!role) {
      throw new AppException('AUTH_ROLE_NOT_FOUND', 'Requested role is not available', {}, 422);
    }

    const passwordHash = await bcrypt.hash(payload.password, 10);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let savedUser: UserEntity;
    try {
      savedUser = await queryRunner.manager.save(
        UserEntity,
        this.userRepository.create({
          username: payload.username,
          passwordHash,
          status: 'ACTIVE'
        })
      );

      if (questionIdForSave && answerHashForSave) {
        await queryRunner.manager.save(
          SecurityAnswerEntity,
          this.securityAnswerRepository.create({
            userId: savedUser.id,
            questionId: questionIdForSave,
            answerHash: answerHashForSave
          })
        );
      }

      await this.accessControlService.assignRoleIdsToUser(savedUser.id, [role.id], queryRunner.manager);

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    const auth = await this.createAuthenticatedSession(savedUser.id);

    return {
      user_id: savedUser.id,
      username: savedUser.username,
      role: role.name,
      ...auth
    };
  }

  /** New JWT session for an existing user (e.g. idempotent register replay with a legacy cached body). */
  async issueAuthenticatedSession(userId: string): Promise<{
    access_token: string;
    expires_in: number;
    session_id: string;
  }> {
    return this.createAuthenticatedSession(userId);
  }

  async login(payload: LoginDto): Promise<{
    access_token?: string;
    expires_in?: number;
    session_id?: string;
    lockout_remaining_seconds?: number;
  }> {
    const user = await this.userRepository.findOne({ where: { username: payload.username } });
    if (!user) {
      throw new AppException('AUTH_INVALID_CREDENTIALS', 'Invalid credentials', {}, 401);
    }

    const now = new Date();
    if (user.lockoutUntil && user.lockoutUntil.getTime() > now.getTime()) {
      return {
        lockout_remaining_seconds: Math.ceil((user.lockoutUntil.getTime() - now.getTime()) / 1000)
      };
    }

    const passwordValid = await bcrypt.compare(payload.password, user.passwordHash);
    if (!passwordValid) {
      user.failedLoginAttempts += 1;

      if (user.failedLoginAttempts >= LOGIN_LOCK_THRESHOLD) {
        user.failedLoginAttempts = 0;
        const lockMinutes = this.getLoginLockMinutes();
        user.lockoutUntil = computeLoginLockoutUntil(now.getTime(), lockMinutes);
      }

      await this.userRepository.save(user);
      throw new AppException('AUTH_INVALID_CREDENTIALS', 'Invalid credentials', {}, 401);
    }

    user.failedLoginAttempts = 0;
    user.lockoutUntil = null;
    await this.userRepository.save(user);

    return this.createAuthenticatedSession(user.id);
  }

  private async createAuthenticatedSession(userId: string): Promise<{
    access_token: string;
    expires_in: number;
    session_id: string;
  }> {
    const now = new Date();
    const expiresInSeconds = this.configService.getOrThrow<number>('JWT_EXPIRES_IN_SECONDS');
    const sessionId = randomUUID();
    const tokenJti = randomUUID();
    const expiresAt = new Date(now.getTime() + expiresInSeconds * 1000);

    await this.sessionRepository.save(
      this.sessionRepository.create({
        id: sessionId,
        userId,
        tokenJti,
        expiresAt,
        invalidatedAt: null
      })
    );

    const accessToken = this.jwtService.signAccessToken({
      sub: userId,
      session_id: sessionId,
      jti: tokenJti
    });

    return {
      access_token: accessToken,
      expires_in: expiresInSeconds,
      session_id: sessionId
    };
  }

  async logout(sessionId: string): Promise<void> {
    const session = await this.sessionRepository.findOne({ where: { id: sessionId } });
    if (!session || session.invalidatedAt) {
      return;
    }

    session.invalidatedAt = new Date();
    await this.sessionRepository.save(session);
  }

  async me(userId: string): Promise<{ user_id: string; username: string; roles: string[]; permissions: string[] }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new AppException('AUTH_USER_NOT_FOUND', 'User not found', {}, 404);
    }

    const roles = await this.accessControlService.getUserRoleNames(userId);
    const permissions = await this.accessControlService.getUserPermissions(userId);

    return {
      user_id: user.id,
      username: user.username,
      roles,
      permissions
    };
  }

  listSecurityQuestions(): Promise<SecurityQuestionEntity[]> {
    return this.securityQuestionRepository.find({
      where: { active: true },
      select: {
        id: true,
        question: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        version: true,
        deletedAt: true
      },
      order: { createdAt: 'ASC' }
    });
  }

  async verifySecurityAnswer(payload: VerifySecurityAnswerDto): Promise<{ reset_token: string }> {
    const user = await this.userRepository.findOne({ where: { username: payload.username } });
    if (!user) {
      throw new AppException('AUTH_INVALID_SECURITY_ANSWER', 'Invalid security answer', {}, 422);
    }

    const answer = await this.securityAnswerRepository.findOne({
      where: {
        userId: user.id,
        questionId: payload.security_question_id
      }
    });

    if (!answer) {
      throw new AppException('AUTH_INVALID_SECURITY_ANSWER', 'Invalid security answer', {}, 422);
    }

    const now = new Date();
    if (answer.verifyLockedUntil && answer.verifyLockedUntil.getTime() > now.getTime()) {
      throw new AppException(
        'AUTH_SECURITY_ANSWER_LOCKED',
        'Security answer verification is temporarily locked',
        {
          lockout_remaining_seconds: Math.ceil((answer.verifyLockedUntil.getTime() - now.getTime()) / 1000)
        },
        429
      );
    }

    const normalizedAnswer = payload.security_answer.toLowerCase().trim();
    const validAnswer = await bcrypt.compare(normalizedAnswer, answer.answerHash);

    if (!validAnswer) {
      answer.verifyFailedAttempts += 1;

      if (answer.verifyFailedAttempts >= RESET_VERIFY_LOCK_THRESHOLD) {
        answer.verifyFailedAttempts = 0;
        answer.verifyLockedUntil = new Date(now.getTime() + RESET_VERIFY_LOCK_MINUTES * 60 * 1000);
      }

      await this.securityAnswerRepository.save(answer);
      throw new AppException('AUTH_INVALID_SECURITY_ANSWER', 'Invalid security answer', {}, 422);
    }

    answer.verifyFailedAttempts = 0;
    answer.verifyLockedUntil = null;
    await this.securityAnswerRepository.save(answer);

    const token = randomBytes(48).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresInMinutes = this.configService.getOrThrow<number>('RESET_TOKEN_EXPIRES_IN_MINUTES');

    await this.passwordResetTokenRepository.save(
      this.passwordResetTokenRepository.create({
        userId: user.id,
        tokenHash,
        expiresAt: new Date(now.getTime() + expiresInMinutes * 60 * 1000),
        consumedAt: null
      })
    );

    return { reset_token: token };
  }

  async confirmPasswordReset(payload: ConfirmPasswordResetDto): Promise<void> {
    const tokenHash = createHash('sha256').update(payload.reset_token).digest('hex');
    const tokenRecord = await this.passwordResetTokenRepository.findOne({ where: { tokenHash } });

    if (!tokenRecord || tokenRecord.consumedAt || tokenRecord.expiresAt.getTime() < Date.now()) {
      throw new AppException('AUTH_INVALID_RESET_TOKEN', 'Reset token is invalid or expired', {}, 422);
    }

    const user = await this.userRepository.findOne({ where: { id: tokenRecord.userId } });
    if (!user) {
      throw new AppException('AUTH_USER_NOT_FOUND', 'User not found', {}, 404);
    }

    user.passwordHash = await bcrypt.hash(payload.new_password, 10);
    user.failedLoginAttempts = 0;
    user.lockoutUntil = null;
    await this.userRepository.save(user);

    tokenRecord.consumedAt = new Date();
    await this.passwordResetTokenRepository.save(tokenRecord);

    await this.sessionRepository
      .createQueryBuilder()
      .update(SessionEntity)
      .set({ invalidatedAt: new Date() })
      .where('user_id = :userId', { userId: user.id })
      .andWhere('invalidated_at IS NULL')
      .execute();
  }

  async validateAccessToken(token: string): Promise<{ userId: string; sessionId: string; jti: string }> {
    const payload = this.jwtService.verifyAccessToken(token);

    const session = await this.sessionRepository.findOne({
      where: {
        id: payload.session_id,
        tokenJti: payload.jti
      }
    });

    if (!session || session.invalidatedAt || session.expiresAt.getTime() < Date.now()) {
      throw new AppException('UNAUTHORIZED', 'Session is invalid or expired', {}, 401);
    }

    return {
      userId: payload.sub,
      sessionId: payload.session_id,
      jti: payload.jti
    };
  }

  private getLoginLockMinutes(): number {
    const raw = this.configService.get<number>('AUTH_LOGIN_LOCK_MINUTES');
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 && raw <= 24 * 60) {
      return Math.floor(raw);
    }
    return 15;
  }
}
