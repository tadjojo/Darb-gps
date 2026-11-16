

import {
  Body,
  BadRequestException,
  Controller,
  HttpCode,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
  ) {}

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
