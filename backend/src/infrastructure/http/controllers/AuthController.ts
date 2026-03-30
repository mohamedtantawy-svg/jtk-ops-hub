import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { LoginHandler } from '../../../application/auth/handlers/LoginHandler';

const LoginSchema = z.object({
  email: z.string().email(),
});

export class AuthController {
  constructor(private readonly loginHandler: LoginHandler) {}

  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = LoginSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        return;
      }
      const result = await this.loginHandler.execute({ email: parsed.data.email });
      res.json(result);
    } catch (err) {
      next(err);
    }
  };
}
