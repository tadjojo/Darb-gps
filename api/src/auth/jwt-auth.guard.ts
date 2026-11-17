import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { AuthenticatedRequest } from './auth.types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  async canActivate(
    context: ExecutionContext,
  ): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();

    const authorization =
      request.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing access token',
      );
    }

    const token = authorization.slice(7).trim();

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;

    if (!url || !key) {
      throw new UnauthorizedException(
        'Authentication is not configured',
      );
    }

    const supabase = createClient(url, key);

    const { data, error } =
      await supabase.auth.getUser(token);

    if (error || !data.user) {
      throw new UnauthorizedException(
        'Invalid access token',
      );
    }

    request.user = {
      sub: data.user.id,
      email: data.user.email,
      phone: data.user.phone,
    };

    return true;
  }
}
