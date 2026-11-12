package com.pif.api.learning;

import com.pif.api.security.AuthUser;
import com.pif.api.web.ApiDocs;
import com.pif.api.web.JsonBodyCache;
import com.pif.api.web.RouteAnnotations.Throttle;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

@RestController
@RequestMapping("/learning/stories")
@Throttle(limit = 120, ttlSeconds = 60)
@Tag(name = "FinStories")
public class StoriesController {
  private final StoriesService stories;
  private final ObjectMapper mapper;

  public StoriesController(StoriesService stories, ObjectMapper mapper) {
    this.stories = stories;
    this.mapper = mapper;
  }

  @GetMapping
  @Operation(summary = "Story feed", description = "Short narrative reels with your watch progress, ordered by what to watch next.")
  public Map<String, Object> feed(HttpServletRequest req) {
    return stories.feed(AuthUser.from(req));
  }

  @GetMapping("/{slug}")
  @Operation(summary = "Get a story", description = "Scenes, captions and visual data for the motion-graphics player.")
  public Map<String, Object> story(HttpServletRequest req, @PathVariable("slug") String slug) {
    return stories.get(AuthUser.from(req), slug);
  }

  @PutMapping("/{slug}/progress")
  @ApiDocs.Body("StoryProgressDto")
  @Operation(summary = "Save watch progress", description = "Stores the playback position and, optionally, your reflection after the story.")
  public Map<String, Object> progress(HttpServletRequest req, @PathVariable("slug") String slug) {
    return stories.save(AuthUser.from(req), slug, LearningDtos.progress(JsonBodyCache.get(req, mapper)));
  }
}
