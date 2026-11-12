package com.pif.api.learning;

import com.pif.api.security.AuthUser;
import com.pif.api.web.ApiDocs;
import com.pif.api.web.JsonBodyCache;
import com.pif.api.web.PathParams;
import com.pif.api.web.RouteAnnotations.Throttle;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

@RestController
@RequestMapping("/learning")
@Throttle(limit = 240, ttlSeconds = 60)
@Tag(name = "MarketQuest Learning")
public class LearningController {
  private final LearningService learning;
  private final ObjectMapper mapper;

  public LearningController(LearningService learning, ObjectMapper mapper) {
    this.learning = learning;
    this.mapper = mapper;
  }

  @GetMapping("/missions")
  @Operation(summary = "List missions", description = "Mission catalog with level, availability and your progress on each mission.")
  public Map<String, Object> missions(HttpServletRequest req) {
    return learning.listMissions(AuthUser.from(req));
  }

  @GetMapping("/missions/{slug}")
  @Operation(summary = "Get a mission briefing", description = "Briefing, rules and objectives. Never includes future prices or events.")
  public Map<String, Object> mission(@PathVariable("slug") String slug) {
    return learning.getMission(slug);
  }

  @PostMapping("/missions/{slug}/sessions")
  @ResponseStatus(HttpStatus.CREATED)
  @ApiDocs.Body("StartSessionDto")
  @Operation(summary = "Start or resume a mission", description = "Returns your active attempt if one exists; otherwise starts a new one.")
  public Map<String, Object> start(HttpServletRequest req, @PathVariable("slug") String slug) {
    return learning.start(AuthUser.from(req), slug, LearningDtos.mode(JsonBodyCache.get(req, mapper), false));
  }

  @GetMapping("/profile")
  @Operation(summary = "Learning profile", description = "Competency mastery with evidence, progress, recommendations and confidence calibration.")
  public Map<String, Object> profile(HttpServletRequest req) {
    return learning.profile(AuthUser.from(req));
  }

  @GetMapping("/sessions")
  @Operation(summary = "List your sessions")
  public List<Map<String, Object>> sessions(HttpServletRequest req) {
    return learning.sessions(AuthUser.from(req));
  }

  @GetMapping("/sessions/{id}")
  @Operation(summary = "Get a session", description = "Market, portfolio, orders, news and objectives up to the current step.")
  public Map<String, Object> session(HttpServletRequest req, @PathVariable("id") String id) {
    return learning.getSession(AuthUser.from(req), PathParams.uuid(id));
  }

  @PostMapping("/sessions/{id}/commands")
  @ApiDocs.Body("SubmitCommandDto")
  @Operation(summary = "Submit a command", description = "Place or cancel an order, advance, run a stress test or finish. Requires the last seen sequence number; retries with the same idempotency key return the original result.")
  public Map<String, Object> command(HttpServletRequest req, @PathVariable("id") String id) {
    var dto = LearningDtos.submit(JsonBodyCache.get(req, mapper));
    return learning.command(AuthUser.from(req), PathParams.uuid(id), dto);
  }

  @PostMapping("/sessions/{id}/orders/preview")
  @ApiDocs.Body("PreviewOrderDto")
  @Operation(summary = "Preview an order", description = "Runs the same pre-trade checks as placing the order (cash, position, limits, mission rules) and returns the estimated cost and warnings. Nothing is recorded.")
  public Map<String, Object> preview(HttpServletRequest req, @PathVariable("id") String id) {
    var dto = LearningDtos.preview(JsonBodyCache.get(req, mapper));
    return learning.preview(AuthUser.from(req), PathParams.uuid(id), dto);
  }

  @PostMapping("/sessions/{id}/abandon")
  @Operation(summary = "Abandon a session")
  public Map<String, Object> abandon(HttpServletRequest req, @PathVariable("id") String id) {
    return learning.abandon(AuthUser.from(req), PathParams.uuid(id));
  }

  @GetMapping("/sessions/{id}/assessment")
  @Operation(summary = "Get the assessment", description = "Server-side assessment with component scores and evidence. Available once the session ends.")
  public Map<String, Object> assessment(HttpServletRequest req, @PathVariable("id") String id) {
    return learning.assessment(AuthUser.from(req), PathParams.uuid(id));
  }

  @PostMapping("/sessions/{id}/mentor")
  @ApiDocs.Body("MentorRequestDto")
  @Operation(summary = "Ask the mentor", description = "Rule-based feedback (no AI provider is configured). During a mission this counts as assistance; after it, returns a debrief.")
  public Map<String, Object> mentor(HttpServletRequest req, @PathVariable("id") String id) {
    var mode = LearningDtos.mode(JsonBodyCache.get(req, mapper), true);
    return learning.mentor(AuthUser.from(req), PathParams.uuid(id), mode);
  }

  @GetMapping("/sessions/{id}/timeline")
  @Tag(name = "Financial Time Machine")
  @Operation(summary = "Decision timeline", description = "Your decisions, the equity curve and existing replays of this session.")
  public Map<String, Object> timeline(HttpServletRequest req, @PathVariable("id") String id) {
    return learning.timeline(AuthUser.from(req), PathParams.uuid(id));
  }

  @PostMapping("/sessions/{id}/branches")
  @ResponseStatus(HttpStatus.CREATED)
  @Tag(name = "Financial Time Machine")
  @ApiDocs.Body("BranchDto")
  @Operation(summary = "Rewind to a decision", description = "Creates a replay on the same market path, keeping every decision before `fromSeq`. Replays never change your competency profile.")
  public Map<String, Object> branch(HttpServletRequest req, @PathVariable("id") String id) {
    var dto = LearningDtos.branch(JsonBodyCache.get(req, mapper));
    return learning.branch(AuthUser.from(req), PathParams.uuid(id), dto.from(), dto.strategy());
  }

  @GetMapping("/sessions/{id}/compare/{otherId}")
  @Tag(name = "Financial Time Machine")
  @Operation(summary = "Compare two sessions", description = "Side-by-side metrics, assessment and equity curves for two attempts of the same mission.")
  public Map<String, Object> compare(HttpServletRequest req, @PathVariable("id") String id, @PathVariable("otherId") String other) {
    return learning.compare(AuthUser.from(req), PathParams.uuid(id), PathParams.uuid(other));
  }
}
