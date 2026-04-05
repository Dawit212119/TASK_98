import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto, SystemRole } from '../src/modules/auth/dto/register.dto';
import { ProvisionUserDto, ProvisionableSystemRole } from '../src/modules/access-control/dto/provision-user.dto';
import { ConfirmPasswordResetDto } from '../src/modules/auth/dto/confirm-password-reset.dto';

describe('Strong password + registration DTOs', () => {
  const validRegister = (): Record<string, unknown> => ({
    username: 'pat_demo',
    password: 'Password123!',
    role: SystemRole.PATIENT,
    security_question_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    security_answer: 'blue'
  });

  it('RegisterDto rejects password without special character', async () => {
    const dto = plainToInstance(RegisterDto, { ...validRegister(), password: 'Password11aA' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('RegisterDto rejects password containing blocked substring', async () => {
    const dto = plainToInstance(RegisterDto, { ...validRegister(), password: 'Welcome1Aa!' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('RegisterDto rejects missing security_answer', async () => {
    const raw = { ...validRegister() };
    delete (raw as { security_answer?: string }).security_answer;
    const dto = plainToInstance(RegisterDto, raw);
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'security_answer')).toBe(true);
  });

  it('RegisterDto accepts valid payload', async () => {
    const dto = plainToInstance(RegisterDto, validRegister());
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('ProvisionUserDto enforces strong password', async () => {
    const dto = plainToInstance(ProvisionUserDto, {
      username: 'staff_x',
      password: 'Letmein1Aa!',
      role: ProvisionableSystemRole.STAFF,
      security_question_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      security_answer: 'x'
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('ConfirmPasswordResetDto enforces strong password', async () => {
    const dto = plainToInstance(ConfirmPasswordResetDto, {
      reset_token: 'a'.repeat(20),
      new_password: 'Qwerty123!X'
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'new_password')).toBe(true);
  });
});
