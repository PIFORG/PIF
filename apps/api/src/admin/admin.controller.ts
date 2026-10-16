import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { AuditOutcome, UserRole, UserStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Request } from 'express';
import { AuthRequestUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ApiDoc } from '../common/swagger/api-doc.decorator';
import { API_TAGS } from '../common/swagger/api-tags';
import { AdminService } from './admin.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListUsersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsIn(['true', 'false'])
  emailVerified?: 'true' | 'false';
}

export class UpdateStatusDto {
  @IsEnum(UserStatus)
  status!: UserStatus;

  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'Provide a reason of at least 3 characters' })
  @MaxLength(200)
  reason!: string;
}

export class UpdateRoleDto {
  @IsEnum(UserRole)
  role!: UserRole;

  @IsString()
  @MaxLength(256)
  password!: string;

  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'Authenticator code must be 6 digits' })
  totpCode?: string;
}

export class AuditQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @Matches(/^[A-Z][A-Z0-9_]{0,79}$/, { message: 'Invalid event type' })
  eventType?: string;

  @IsOptional()
  @IsEnum(AuditOutcome)
  outcome?: AuditOutcome;

  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @IsOptional()
  @IsUUID()
  subjectUserId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

@ApiBearerAuth()
@Controller('admin')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @ApiDoc(API_TAGS.administration, 'Get platform overview', 'User counts by status, verification and MFA, with recent security activity.')
  @Get('overview')
  overview(@CurrentUser() user: AuthRequestUser) {
    return this.admin.overview(user);
  }

  @ApiDoc(API_TAGS.administration, 'Search users', 'Paginated, filterable by text, status, role and email verification.')
  @Get('users')
  listUsers(@CurrentUser() user: AuthRequestUser, @Query() query: ListUsersQueryDto) {
    return this.admin.listUsers(user, query);
  }

  @ApiDoc(API_TAGS.administration, 'Get user details')
  @Get('users/:id')
  getUser(@CurrentUser() user: AuthRequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getUser(user, id);
  }

  @ApiDoc(
    API_TAGS.administration,
    'Change account status',
    'Suspend, reactivate or deactivate an account. A reason is required and recorded in the audit log.',
  )
  @Patch('users/:id/status')
  updateStatus(
    @CurrentUser() user: AuthRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateStatusDto,
    @Req() req: Request,
  ) {
    return this.admin.updateStatus(user, id, body, req);
  }

  @ApiDoc(
    API_TAGS.administration,
    'Change user role',
    'Requires the administrator to reauthenticate. At least one active administrator must remain.',
  )
  @Patch('users/:id/role')
  updateRole(
    @CurrentUser() user: AuthRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateRoleDto,
    @Req() req: Request,
  ) {
    return this.admin.updateRole(user, id, body, req);
  }

  @ApiDoc(
    API_TAGS.auditLogs,
    'Search audit events',
    'Paginated, filterable by event type, outcome, actor, subject and date range.',
  )
  @Get('audit-events')
  auditEvents(@CurrentUser() user: AuthRequestUser, @Query() query: AuditQueryDto) {
    return this.admin.listAuditEvents(user, query);
  }
}
