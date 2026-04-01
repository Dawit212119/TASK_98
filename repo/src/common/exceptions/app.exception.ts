import { HttpException, HttpStatus } from '@nestjs/common';

export class AppException extends HttpException {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
    status: HttpStatus = HttpStatus.BAD_REQUEST
  ) {
    super({ message }, status);
    this.code = code;
    this.details = details;
  }
}
