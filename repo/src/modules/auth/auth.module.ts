import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetTokenEntity } from './entities/password-reset-token.entity';
import { SecurityAnswerEntity } from './entities/security-answer.entity';
import { SecurityQuestionEntity } from './entities/security-question.entity';
import { SessionEntity } from './entities/session.entity';
import { UserEntity } from './entities/user.entity';
import { JwtService } from './jwt.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      SessionEntity,
      SecurityQuestionEntity,
      SecurityAnswerEntity,
      PasswordResetTokenEntity
    ]),
    forwardRef(() => AccessControlModule)
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtService, JwtAuthGuard],
  exports: [AuthService, JwtService, JwtAuthGuard]
})
export class AuthModule {}
