import jwt from 'jsonwebtoken';
import { config } from '../../../shared/config';
import { IMemberRepository } from '../../../domain/member/IMemberRepository';
import { UnauthorizedError } from '../../../shared/errors';

export interface LoginCommand {
  email: string;
}

export interface LoginResult {
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    team: string | null;
    region: string | null;
  };
}

export class LoginHandler {
  constructor(private readonly memberRepo: IMemberRepository) {}

  async execute(cmd: LoginCommand): Promise<LoginResult> {
    const member = await this.memberRepo.findByEmail(cmd.email);
    if (!member) {
      throw new UnauthorizedError('No account found for this email');
    }
    if (!member.isActive) {
      throw new UnauthorizedError('Account is deactivated');
    }

    const payload = { sub: member.id, email: member.email, role: member.role, name: member.name };
    const token = (jwt.sign as any)(payload, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN });

    return {
      token,
      user: {
        id: member.id,
        name: member.name,
        email: member.email,
        role: member.role,
        team: member.team,
        region: member.region,
      },
    };
  }
}
