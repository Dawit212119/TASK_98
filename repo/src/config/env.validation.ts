import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsOptional()
  @IsIn(['development', 'test', 'production'])
  NODE_ENV?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  PORT?: number;

  @IsOptional()
  @IsString()
  API_PREFIX?: string;

  @IsString()
  DB_HOST!: string;

  @IsInt()
  @Min(1)
  DB_PORT!: number;

  @IsString()
  DB_USERNAME!: string;

  @IsString()
  DB_PASSWORD!: string;

  @IsString()
  DB_NAME!: string;

  @IsString()
  JWT_SECRET!: string;

  @IsInt()
  @Min(60)
  JWT_EXPIRES_IN_SECONDS!: number;

  @IsInt()
  @Min(1)
  RESET_TOKEN_EXPIRES_IN_MINUTES!: number;

  @IsOptional()
  @IsString()
  UPLOAD_DIR?: string;

  @IsOptional()
  @IsString()
  SENSITIVE_WORDS?: string;

  @IsString()
  IDENTITY_DOC_ENCRYPTION_KEY!: string;

  @IsOptional()
  @IsString()
  BUSINESS_TZ?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  BUSINESS_DAY_START_HOUR?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  BUSINESS_DAY_END_HOUR?: number;

  @IsOptional()
  @IsString()
  BUSINESS_WORK_DAYS?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  AUDIT_RETENTION_YEARS?: number;

  @IsOptional()
  @IsString()
  WORKFLOW_SLA_USE_CLOCK_HOURS?: string;

  @IsOptional()
  @IsString()
  BUSINESS_HOLIDAYS?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  WORKFLOW_REMINDER_LEAD_HOURS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  AUTH_LOGIN_LOCK_MINUTES?: number;

  /** Set to 'false' to disable the 03:00 UTC credit-tier cron (e.g. in some test environments). */
  @IsOptional()
  @IsIn(['true', 'false'])
  TRUST_CREDIT_TIER_CRON_ENABLED?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  assertStrongSecret('JWT_SECRET', validated.JWT_SECRET);
  assertStrongSecret('IDENTITY_DOC_ENCRYPTION_KEY', validated.IDENTITY_DOC_ENCRYPTION_KEY);

  return validated;
}

function assertStrongSecret(name: string, value: string): void {
  const trimmed = value.trim();
  const normalized = trimmed.toLowerCase();

  const weakDefaults = new Set([
    'change-me',
    'change_me',
    'changeme',
    'change-me-identity-doc-key',
    'secret',
    'default',
    'password',
    'test',
    'dev'
  ]);

  if (weakDefaults.has(normalized) || normalized.includes('change-me')) {
    throw new Error(`${name} is insecure. Use a strong, non-default secret.`);
  }

  if (trimmed.length < 32) {
    throw new Error(`${name} is too short. Minimum length is 32 characters.`);
  }

  const hasUpper = /[A-Z]/.test(trimmed);
  const hasLower = /[a-z]/.test(trimmed);
  const hasDigit = /\d/.test(trimmed);
  const hasSymbol = /[^A-Za-z0-9]/.test(trimmed);
  const complexityScore = [hasUpper, hasLower, hasDigit, hasSymbol].filter(Boolean).length;
  const uniqueChars = new Set(trimmed).size;

  if (complexityScore < 3 || uniqueChars < 10) {
    throw new Error(`${name} must be high-entropy (mixed character classes and low repetition).`);
  }
}
