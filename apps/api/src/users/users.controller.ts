import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { AuthRequestUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { UpdatePreferencesDto } from '../auth/dto/auth.dto';
import { serializePreferences } from '../common/serializers/user.serializer';
import { ApiDoc } from '../common/swagger/api-doc.decorator';
import { API_TAGS } from '../common/swagger/api-tags';
import { UsersService } from './users.service';

@ApiBearerAuth()
@Controller('users/me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @ApiDoc(API_TAGS.userManagement, 'Get preferences')
  @Get('preferences')
  async preferences(@CurrentUser() user: AuthRequestUser) {
    return serializePreferences(await this.users.getPreferences(user));
  }

  @ApiDoc(API_TAGS.userManagement, 'Update preferences')
  @Patch('preferences')
  async updatePreferences(
    @CurrentUser() user: AuthRequestUser,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return serializePreferences(await this.users.updatePreferences(user, dto));
  }

  @ApiDoc(
    API_TAGS.userManagement,
    'Get dashboard context',
    'Role, capabilities, module availability and required actions used to build the dashboard.',
  )
  @Get('dashboard-context')
  dashboardContext(@CurrentUser() user: AuthRequestUser) {
    return this.users.dashboardContext(user);
  }
}
