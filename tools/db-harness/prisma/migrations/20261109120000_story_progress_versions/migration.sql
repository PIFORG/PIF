-- Additive: keep FinStories progress meaningful when a story is edited (new version).
ALTER TABLE "story_progress" ADD COLUMN "scene_id" VARCHAR(40);
ALTER TABLE "story_progress" ADD COLUMN "completed_version" INTEGER;

-- Backfill: rows already watched to the end record the version they completed.
UPDATE "story_progress" SET "completed_version" = "story_version" WHERE "completed" = true;
