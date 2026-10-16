import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ExperienceLevel } from '@prisma/client';
import { Transform } from 'class-transformer';
import { PASSWORD_MIN_LENGTH } from '../../common/crypto/password.util';

const PASSWORD_RULE_DESCRIPTION = `${PASSWORD_MIN_LENGTH}–128 characters with at least one letter, one number and one symbol`;

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * The global pipe enables implicit conversion, which would coerce the string "false" to
 * `true`. Validate the raw JSON value instead so only real booleans are accepted.
 */
function rawValue({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  return obj[key];
}

/** Currency and time-zone lists come from the runtime's ICU data, not a hand-made list. */
export const SUPPORTED_CURRENCIES: readonly string[] = Intl.supportedValuesOf('currency');
export const SUPPORTED_TIME_ZONES: readonly string[] = Array.from(
  new Set(['UTC', ...Intl.supportedValuesOf('timeZone')]),
);
/** DESIGN DECISION: closed sets so the UI can render every stored value. */
export const CHART_THEMES = ['trading_desk', 'light', 'dark'] as const;
export const TRAINING_DIFFICULTIES = ['adaptive', 'beginner', 'intermediate', 'advanced'] as const;

export class RegisterDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName!: string;

  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: 128, description: PASSWORD_RULE_DESCRIPTION })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(128)
  passwordConfirmation?: string;
}

export class VerifyEmailDto {
  @ApiProperty()
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  token!: string;
}

export class ResendVerificationDto {
  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email!: string;
}

export class LoginDto {
  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class MfaVerifyLoginDto {
  @ApiProperty()
  @IsString()
  @MinLength(32)
  mfaChallengeToken!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/)
  totpCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(32)
  recoveryCode?: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(32)
  token!: string;

  @ApiProperty({ description: PASSWORD_RULE_DESCRIPTION })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(128)
  password!: string;

  @ApiProperty()
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(128)
  passwordConfirmation!: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ description: PASSWORD_RULE_DESCRIPTION })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(128)
  newPassword!: string;

  @ApiProperty()
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(128)
  newPasswordConfirmation!: string;

  @ApiPropertyOptional({ description: 'Required when MFA is enabled' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/)
  totpCode?: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName?: string;

  @ApiPropertyOptional({ enum: ExperienceLevel })
  @IsOptional()
  @IsEnum(ExperienceLevel)
  experienceLevel?: ExperienceLevel;
}

export class UpdatePreferencesDto {
  @ApiPropertyOptional({ description: 'ISO 4217 code known to the runtime, e.g. USD, EUR, TND' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @IsIn(SUPPORTED_CURRENCIES, { message: 'preferredCurrency must be a supported ISO 4217 currency code' })
  preferredCurrency?: string;

  @ApiPropertyOptional({ description: 'IANA time zone, e.g. UTC or Africa/Tunis' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsIn(SUPPORTED_TIME_ZONES, { message: 'timezone must be a valid IANA time zone' })
  timezone?: string;

  @ApiPropertyOptional({ enum: CHART_THEMES })
  @IsOptional()
  @IsIn(CHART_THEMES)
  chartTheme?: (typeof CHART_THEMES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(rawValue)
  @IsBoolean()
  notifyEmailSecurity?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(rawValue)
  @IsBoolean()
  notifyMarketDigest?: boolean;

  @ApiPropertyOptional({ enum: TRAINING_DIFFICULTIES })
  @IsOptional()
  @IsIn(TRAINING_DIFFICULTIES)
  trainingDifficulty?: (typeof TRAINING_DIFFICULTIES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(rawValue)
  @IsBoolean()
  reduceMotion?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(rawValue)
  @IsBoolean()
  highContrast?: boolean;
}

export class ChangeEmailRequestDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  newEmail!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/)
  totpCode?: string;
}

export class ChangeEmailConfirmDto {
  @ApiProperty()
  @IsString()
  @MinLength(32)
  token!: string;
}

export class StepUpPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/)
  totpCode?: string;
}

export class MfaEnableDto {
  @ApiProperty()
  @IsString()
  @Matches(/^\d{6}$/)
  totpCode!: string;
}

/** Password plus either a current TOTP code or an unused recovery code (lost-device path). */
export class MfaDisableDto extends StepUpPasswordDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(32)
  recoveryCode?: string;
}

export class DeactivateAccountDto extends StepUpPasswordDto {
  @ApiProperty()
  @IsString()
  @Matches(/^DEACTIVATE$/)
  confirmation!: string;
}

export class DeleteAccountDto extends StepUpPasswordDto {
  @ApiProperty()
  @IsString()
  @Matches(/^DELETE$/)
  confirmation!: string;
}

export class SessionIdParamDto {
  @IsUUID()
  id!: string;
}
