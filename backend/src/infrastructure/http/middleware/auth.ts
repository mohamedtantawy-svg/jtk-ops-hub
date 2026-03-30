import { Request, Response, NextFunction } from 'express';
import jwt, { TokenExpiredError } from 'jsonwebtoken';
import { config } from '../../../shared/config';
import { UnauthorizedError, ForbiddenError } from '../../../shared/errors';

export interface AuthPayload {
  sub: string;       // user ID
  email: string;
  role: string;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      actor?: AuthPayload;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!config.JWT_SECRET) {
    return next(new UnauthorizedError('Auth not configured'));
  }

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing Bearer token'));
  }

  try {
    const token = header.slice(7);
    req.actor = jwt.verify(token, config.JWT_SECRET) as unknown as AuthPayload;
    next();
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      next(Object.assign(new UnauthorizedError('Token expired'), { code: 'TOKEN_EXPIRED' }));
    } else {
      next(new UnauthorizedError('Invalid token'));
    }
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.actor) {
      return next(new UnauthorizedError('Authentication required'));
    }
    if (!roles.includes(req.actor.role)) {
      return next(new ForbiddenError('Insufficient permissions'));
    }
    next();
  };
}
