-- Actuarial lab: user-owned Monte Carlo runs (summarised results only, never individual samples).
-- Additive only (new table, index, FK and CHECK constraints); no existing table or row is modified.
-- Rollback: DROP TABLE "actuarial_simulation_runs";

-- CreateTable
CREATE TABLE "actuarial_simulation_runs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "label" VARCHAR(80),
    "engine_version" VARCHAR(40) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'TND',
    "seed" INTEGER NOT NULL,
    "simulations" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "inputs" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "actuarial_simulation_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "actuarial_simulation_runs_seed_check" CHECK ("seed" >= 1),
    CONSTRAINT "actuarial_simulation_runs_simulations_check" CHECK ("simulations" BETWEEN 1000 AND 200000),
    CONSTRAINT "actuarial_simulation_runs_duration_check" CHECK ("duration_ms" >= 0)
);

-- CreateIndex
CREATE INDEX "actuarial_simulation_runs_user_id_created_at_idx" ON "actuarial_simulation_runs"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "actuarial_simulation_runs" ADD CONSTRAINT "actuarial_simulation_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
