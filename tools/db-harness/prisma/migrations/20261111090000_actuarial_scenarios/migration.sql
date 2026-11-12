-- Actuarial lab: user-owned saved pricing scenarios. Additive only (new enum, table, indexes and FK);
-- no existing table or row is modified. Rollback: DROP TABLE "actuarial_scenarios"; DROP TYPE "ActuarialScenarioKind";

-- CreateEnum
CREATE TYPE "ActuarialScenarioKind" AS ENUM ('PRICING');

-- CreateTable
CREATE TABLE "actuarial_scenarios" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "kind" "ActuarialScenarioKind" NOT NULL,
    "model_version" VARCHAR(40) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'TND',
    "inputs" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "actuarial_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "actuarial_scenarios_user_id_updated_at_idx" ON "actuarial_scenarios"("user_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "actuarial_scenarios_user_id_name_key" ON "actuarial_scenarios"("user_id", "name");

-- AddForeignKey
ALTER TABLE "actuarial_scenarios" ADD CONSTRAINT "actuarial_scenarios_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
