

import {
  Body,
  BadRequestException,
  Controller,
  HttpCode,
  Headers,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
  ) {}

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: { refreshToken: string }) {
    if (typeof body?.refreshToken !== 'string' || !body.refreshToken.trim()) {
      throw new BadRequestException('Refresh token is required');
    }
    return this.authService.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { refreshToken: string },
  ) {
    if (typeof body?.refreshToken !== 'string' || !body.refreshToken.trim()) {
      throw new BadRequestException('Refresh token is required');
    }
    const accessToken = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : undefined;
    await this.authService.logout(accessToken, body.refreshToken);
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body()
    body: {
      identifier: string;
      password: string;
    },
  ) {
    if (
      typeof body?.identifier !== 'string' ||
      typeof body?.password !== 'string' ||
      !body.identifier.trim() ||
      !body.password
    ) {
      throw new BadRequestException(
        'يرجى إدخال البريد الإلكتروني أو الهاتف وكلمة المرور',
      );
    }

    return this.authService.login(
      body.identifier,
      body.password,
    );
  }
}
