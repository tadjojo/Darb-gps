
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
console.log('[AUTH ENV CHECK]', {
  SUPABASE_URL_EXISTS: Boolean(url),
  SUPABASE_KEY_EXISTS: Boolean(key),
  SUPABASE_URL_FORMAT_OK:
    Boolean(url?.startsWith('https://') &&
    url.includes('.supabase.co')),
  SUPABASE_KEY_FORMAT_OK:
    Boolean(key?.startsWith('sb_publishable_')),
});
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
