package com.pif.api.learning.stories;

import com.pif.api.learning.stories.StoryCatalog.StoryDefinition;
import com.pif.api.learning.stories.StoryCatalog.StoryScene;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Watch progress of FinStories (apps/api/src/learning/stories/progress.ts). */
public final class StoryProgress {

  private StoryProgress() {}

  /** A story counts as watched once playback reaches this share of its length. */
  public static final double COMPLETION_SHARE = 0.95;

  /** The persisted row, as far as progress is concerned. */
  public record StoredProgress(int storyVersion, int positionMs, String sceneId, boolean completed,
      Instant completedAt, Integer completedVersion, String reflection) {}

  /**
   * {@code updatedSinceLastWatch}: the story was edited after this progress was saved. {@code watchedEarlierVersion}:
   * an earlier version was watched to the end, but the current version has not been.
   */
  public record ProgressView(int positionMs, boolean completed, String reflection, boolean updatedSinceLastWatch,
      boolean watchedEarlierVersion) {
    public Map<String, Object> toJson() {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("positionMs", positionMs);
      out.put("completed", completed);
      out.put("reflection", reflection);
      out.put("updatedSinceLastWatch", updatedSinceLastWatch);
      out.put("watchedEarlierVersion", watchedEarlierVersion);
      return out;
    }
  }

  /**
   * A progress update. {@code hasReflection} distinguishes an absent reflection (keep the stored one) from an explicit
   * null (clear it).
   */
  public record ProgressUpdate(int positionMs, Boolean completed, boolean hasReflection, String reflection) {}

  public static String sceneIdAt(StoryDefinition story, int positionMs) {
    int start = 0;
    List<StoryScene> scenes = story.scenes();
    for (StoryScene scene : scenes) {
      if (positionMs < start + scene.durationMs()) return scene.id();
      start += scene.durationMs();
    }
    return scenes.get(scenes.size() - 1).id();
  }

  public static Integer sceneStartMs(StoryDefinition story, String sceneId) {
    int start = 0;
    for (StoryScene scene : story.scenes()) {
      if (scene.id().equals(sceneId)) return start;
      start += scene.durationMs();
    }
    return null;
  }

  /** Highest version watched to the end. Rows written before {@code completedVersion} existed fall back to their own version. */
  private static Integer lastCompletedVersion(StoredProgress row) {
    if (row.completedVersion() != null) return row.completedVersion();
    return row.completed() ? row.storyVersion() : null;
  }

  public static ProgressView progressView(StoryDefinition story, StoredProgress row) {
    if (row == null) return new ProgressView(0, false, null, false, false);
    Integer earlier = lastCompletedVersion(row);
    if (row.storyVersion() == story.version()) {
      return new ProgressView(row.positionMs(), row.completed(), row.reflection(), false,
          !row.completed() && earlier != null && earlier < story.version());
    }
    // Positions in milliseconds do not survive edits to scene lengths, but scene ids do.
    Integer sceneStart = row.sceneId() != null && !row.sceneId().isEmpty() ? sceneStartMs(story, row.sceneId()) : null;
    return new ProgressView(sceneStart == null ? 0 : sceneStart, false, null, true, earlier != null);
  }

  /** The row to store after a progress update. Never discards the record of an earlier completed version. */
  public static StoredProgress nextProgress(StoryDefinition story, StoredProgress existing, ProgressUpdate update,
      Instant now) {
    int duration = StoryCatalog.storyDuration(story);
    int positionMs = Math.min(update.positionMs(), duration);
    boolean sameVersion = existing != null && existing.storyVersion() == story.version();
    boolean completed = positionMs >= duration * COMPLETION_SHARE || Boolean.TRUE.equals(update.completed())
        || (sameVersion && existing.completed());
    Integer earlier = existing != null ? lastCompletedVersion(existing) : null;
    return new StoredProgress(
        story.version(),
        positionMs,
        sceneIdAt(story, positionMs),
        completed,
        completed ? (sameVersion && existing.completedAt() != null ? existing.completedAt() : now) : null,
        completed ? Integer.valueOf(story.version()) : earlier,
        update.hasReflection() ? update.reflection() : (existing == null ? null : existing.reflection()));
  }
}
