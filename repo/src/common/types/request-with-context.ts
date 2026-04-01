import { Request } from 'express';

export type AuthenticatedUser = {
  userId: string;
  sessionId: string;
  jti: string;
};

export type RequestWithContext = Request & {
  requestId?: string;
  user?: AuthenticatedUser;
};
