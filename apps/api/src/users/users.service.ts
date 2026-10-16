import { Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { AuthRequestUser } from '../auth/decorators/current-user.decorator';
import { UpdatePreferencesDto } from '../auth/dto/auth.dto';

/**
 * Thin facade over AuthService for preferences + dashboard context.
 * Ownership is implicit (always the authenticated user via /users/me/*).
 */
@Injectable()
export class UsersService {
  constructor(private readonly auth: AuthService) {}

  getPreferences(user: AuthRequestUser) {
    return this.auth.getPreferences(user);
  }

  updatePreferences(user: AuthRequestUser, dto: UpdatePreferencesDto) {
    return this.auth.updatePreferences(user, dto);
  }

  dashboardContext(user: AuthRequestUser) {
    return this.auth.dashboardContext(user);
  }
}
