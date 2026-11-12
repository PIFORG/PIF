-- CreateEnum
CREATE TYPE "LearningSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'FAILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "LearningSessionKind" AS ENUM ('MISSION', 'REPLAY');

-- CreateTable
CREATE TABLE "learning_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "mission_slug" VARCHAR(80) NOT NULL,
    "mission_version" INTEGER NOT NULL,
    "kind" "LearningSessionKind" NOT NULL DEFAULT 'MISSION',
    "status" "LearningSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "parent_session_id" UUID,
    "branch_from_seq" INTEGER,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "equity_millimes" BIGINT,
    "mentor_mode" VARCHAR(16) NOT NULL,
    "assisted" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "learning_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_commands" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotency_key" VARCHAR(80) NOT NULL,
    "outcome" VARCHAR(16) NOT NULL,
    "step" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_events" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "command_seq" INTEGER NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "step" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_assessments" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "mission_slug" VARCHAR(80) NOT NULL,
    "mission_version" INTEGER NOT NULL,
    "engine_version" VARCHAR(32) NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "assisted" BOOLEAN NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competency_observations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "competency" VARCHAR(40) NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "assisted" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competency_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mentor_interactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "mode" VARCHAR(16) NOT NULL,
    "source" VARCHAR(16) NOT NULL,
    "rule_id" VARCHAR(64) NOT NULL,
    "step" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mentor_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_progress" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "story_slug" VARCHAR(80) NOT NULL,
    "story_version" INTEGER NOT NULL,
    "position_ms" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "reflection" VARCHAR(32),
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "learning_sessions_user_id_status_idx" ON "learning_sessions"("user_id", "status");

-- CreateIndex
CREATE INDEX "learning_sessions_user_id_mission_slug_idx" ON "learning_sessions"("user_id", "mission_slug");

-- CreateIndex
CREATE INDEX "learning_sessions_parent_session_id_idx" ON "learning_sessions"("parent_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "learning_commands_session_id_seq_key" ON "learning_commands"("session_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "learning_commands_session_id_idempotency_key_key" ON "learning_commands"("session_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "learning_events_session_id_type_idx" ON "learning_events"("session_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "learning_events_session_id_ordinal_key" ON "learning_events"("session_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "learning_assessments_session_id_key" ON "learning_assessments"("session_id");

-- CreateIndex
CREATE INDEX "learning_assessments_user_id_mission_slug_idx" ON "learning_assessments"("user_id", "mission_slug");

-- CreateIndex
CREATE INDEX "competency_observations_user_id_competency_created_at_idx" ON "competency_observations"("user_id", "competency", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "competency_observations_session_id_competency_key" ON "competency_observations"("session_id", "competency");

-- CreateIndex
CREATE INDEX "mentor_interactions_session_id_created_at_idx" ON "mentor_interactions"("session_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "story_progress_user_id_story_slug_key" ON "story_progress"("user_id", "story_slug");

-- AddForeignKey
ALTER TABLE "learning_sessions" ADD CONSTRAINT "learning_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_sessions" ADD CONSTRAINT "learning_sessions_parent_session_id_fkey" FOREIGN KEY ("parent_session_id") REFERENCES "learning_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_commands" ADD CONSTRAINT "learning_commands_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "learning_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_events" ADD CONSTRAINT "learning_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "learning_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_assessments" ADD CONSTRAINT "learning_assessments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "learning_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_observations" ADD CONSTRAINT "competency_observations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_observations" ADD CONSTRAINT "competency_observations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "learning_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentor_interactions" ADD CONSTRAINT "mentor_interactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentor_interactions" ADD CONSTRAINT "mentor_interactions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "learning_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_progress" ADD CONSTRAINT "story_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
