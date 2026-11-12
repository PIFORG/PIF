-- Additive, non-destructive: lets pending (unconfirmed) MFA enrollments expire.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfa_pending_created_at" TIMESTAMP(3);
