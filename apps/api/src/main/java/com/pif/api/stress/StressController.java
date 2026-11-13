package com.pif.api.stress;

import com.pif.api.security.AuthUser;
import com.pif.api.web.ApiDocs;
import com.pif.api.web.JsonBodyCache;
import com.pif.api.web.RouteAnnotations.Throttle;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

/** Bank stress testing on two fictional banks. Authentication required; nothing is written to the database. */
@RestController
@RequestMapping("/stress")
@Throttle(limit = 60, ttlSeconds = 60)
@Tag(name = "Bank Stress Testing")
public class StressController {

  private final StressService service;
  private final StressModelService models;
  private final ObjectMapper mapper;

  public StressController(StressService service, StressModelService models, ObjectMapper mapper) {
    this.service = service;
    this.models = models;
    this.mapper = mapper;
  }

  @GetMapping("/model")
  @Operation(summary = "Machine-learning emulator: model card",
      description = "Training protocol (seeded synthetic scenarios computed by the engine), validation, test and "
          + "extrapolation metrics of the mean, linear and gradient-boosting models, breach detection, permutation "
          + "importance and limitations. The model is trained once, on first use.")
  public Map<String, Object> model(HttpServletRequest req) {
    AuthUser.from(req);
    return models.card();
  }

  @GetMapping("/catalog")
  @Operation(summary = "Banks, risk factors and preset scenarios",
      description = "The two fictional banks (conventional and participative) with their balance sheets and starting "
          + "ratios, the eight risk factors with their ranges, the preset scenarios, thresholds and assumptions.")
  public Map<String, Object> catalog(HttpServletRequest req) {
    AuthUser.from(req);
    return service.catalog();
  }

  @PostMapping("/run")
  @Throttle(limit = 30, ttlSeconds = 60)
  @ApiDocs.Body("RunStressTestDto")
  @Operation(summary = "Run a stress test on both banks",
      description = "Applies the scenario to both banks over one year: credit losses (PD × LGD × EAD), market "
          + "revaluation, margin, participative-bank mechanisms, capital, leverage and liquidity, an exact Shapley "
          + "attribution of the change in each ratio, a comparison of the two banks and a sensitivity curve. "
          + "Deterministic; not stored.")
  public Map<String, Object> run(HttpServletRequest req) {
    AuthUser.from(req);
    return service.run(StressDtos.run(JsonBodyCache.get(req, mapper)));
  }
}
