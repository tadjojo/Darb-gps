
import {
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class AuthService {
  private createSupabaseClient() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
      throw new InternalServerErrorException(
        'Supabase environment variables are missing',
      );
    }

    return createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }

  async refresh(refreshToken: string) {
    if (!refreshToken || typeof refreshToken !== 'string') {
      throw new UnauthorizedException('Refresh token is required');
    }
    const supabase = this.createSupabaseClient();
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }
    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    };
  }

  async logout(accessToken: string | undefined, refreshToken: string) {
    if (!refreshToken || typeof refreshToken !== 'string') return;
    const supabase = this.createSupabaseClient();
    let sessionReady = false;
    if (accessToken) {
      const { data, error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      sessionReady = !error && Boolean(data.session);
    }
    if (!sessionReady) {
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
      sessionReady = !error && Boolean(data.session);
    }
    if (sessionReady) {
      await supabase.auth.signOut({ scope: 'local' });
    }
  }

  async login(identifier: string, password: string) {
    const supabase = this.createSupabaseClient();
    const value = identifier.trim();

    const credentials = value.includes('@')
      ? { email: value, password }
      : { phone: value, password };

    const { data, error } =
      await supabase.auth.signInWithPassword(credentials);

    if (error || !data.session) {
      throw new UnauthorizedException(
        'بيانات تسجيل الدخول غير صحيحة',
      );
    }

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    };
  }
}
