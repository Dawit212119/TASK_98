import { registerDecorator, ValidationOptions } from 'class-validator';

/** At least one uppercase, lowercase, digit, and non-alphanumeric; 8–200 chars. */
export const STRONG_PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,200}$/;

/** Obvious keyboard / default phrases (substring match). */
const SUBSTRING_DENYLIST = ['qwerty', 'letmein', 'changeme', 'carereserve', 'welcome'];

const EXACT_DENYLIST = new Set([
  'password',
  'password1',
  'password123',
  'welcome',
  'welcome1',
  'admin123',
  '12345678',
  '11111111'
]);

function isBannedPassword(value: string): boolean {
  const lower = value.toLowerCase();
  if (EXACT_DENYLIST.has(lower)) {
    return true;
  }
  return SUBSTRING_DENYLIST.some((w) => lower.includes(w));
}

/**
 * Healthcare-oriented password rule: complexity plus a small common-password substring blocklist.
 */
export function IsStrongPassword(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isStrongPassword',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') {
            return false;
          }
          if (!STRONG_PASSWORD_REGEX.test(value)) {
            return false;
          }
          return !isBannedPassword(value);
        },
        defaultMessage(): string {
          return (
            'password must be 8-200 characters and include uppercase, lowercase, a digit, and a special ' +
            'character; it must not contain common weak-password substrings'
          );
        }
      }
    });
  };
}
