import { Request, Response, NextFunction } from 'express';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import { AppError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';
import { config } from '../../../shared/config';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  // Handle JWT-specific errors before AppError to give precise codes
  if (err instanceof TokenExpiredError) {
    res.status(401).json({
      error: { code: 'TOKEN_EXPIRED', message: 'Token expired' },
    });
    return;
  }

  if (err instanceof JsonWebTokenError) {
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Invalid token' },
    });
    return;
  }

  // Handle all application errors (ValidationError, NotFoundError, ConflictError,
  // ForbiddenError, UnauthorizedError, IntegrationError all extend AppError)
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
    return;
  }

  // Unknown / unhandled errors — never leak stack traces in production
  logger.error('Unhandled error', { err, path: req.path, method: req.method });
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      ...(config.NODE_ENV !== 'production' && { detail: err.message }),
    },
  });
}
