-- Actuarial lab: user-owned reserving runs (triangles and assumptions as submitted, results computed by the server).
-- Additive only (new table, index, FK and CHECK constraints); no existing table or row is modified.
-- Rollback: DROP TABLE "actuarial_reserving_runs";

-- CreateTable
CREATE TABLE "actuarial_reserving_runs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "model_version" VARCHAR(40) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'TND',
    "first_origin" INTEGER NOT NULL,
    "origin_count" INTEGER NOT NULL,
    "valuation_year" INTEGER NOT NULL,
    "data_checksum" CHAR(64) NOT NULL,
    "inputs" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "actuarial_reserving_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "actuarial_reserving_runs_origin_count_check" CHECK ("origin_count" BETWEEN 3 AND 25),
    CONSTRAINT "actuarial_reserving_runs_first_origin_check" CHECK ("first_origin" BETWEEN 1950 AND 2100),
    CONSTRAINT "actuarial_reserving_runs_valuation_year_check" CHECK ("valuation_year" = "first_origin" + "origin_count" - 1),
    CONSTRAINT "actuarial_reserving_runs_checksum_check" CHECK ("data_checksum" ~ '^[0-9a-f]{64}$')
);

-- CreateIndex
CREATE INDEX "actuarial_reserving_runs_user_id_created_at_idx" ON "actuarial_reserving_runs"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "actuarial_reserving_runs" ADD CONSTRAINT "actuarial_reserving_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
