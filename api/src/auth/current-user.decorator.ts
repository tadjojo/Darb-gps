import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthenticatedRequest } from './auth.types';

export const CurrentUser = createParamDecorator(
  (
    data: keyof AuthenticatedRequest['user'] | undefined,
    context: ExecutionContext,
  ) => {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();

    const user = request.user;

    if (!user) {
      throw new UnauthorizedException(
        'User not authenticated',
      );
    }

    return data ? user[data] : user;
  },
);