package com.pif.api.actuarial;

import com.pif.api.security.AuthUser;
import com.pif.api.web.ApiDocs;
import com.pif.api.web.JsonBodyCache;
import com.pif.api.web.PathParams;
import com.pif.api.web.RouteAnnotations.Throttle;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

@RestController
@RequestMapping("/actuarial")
@Throttle(limit = 120, ttlSeconds = 60)
@Tag(name = "Actuarial Lab")
public class ActuarialController {
  private final ActuarialService service;
  private final ObjectMapper mapper;

  public ActuarialController(ActuarialService service, ObjectMapper mapper) {
    this.service = service;
    this.mapper = mapper;
  }

  private Map<String, Object> body(HttpServletRequest r) {
    return JsonBodyCache.get(r, mapper);
  }

  @GetMapping("/overview")
  @Operation(summary = "Actuarial overview", description = "Reference portfolio results, your saved scenarios and the status of each actuarial workspace. All figures are model estimates from fictional assumptions.")
  public Object overview(HttpServletRequest r) {
    return service.overview(AuthUser.from(r).id());
  }

  @GetMapping("/presets")
  @Operation(summary = "Fictional example portfolios", description = "Ready-made assumption sets (deterministic, gamma and lognormal claim costs) with their headline premium.")
  public Object presets() {
    return service.presets();
  }

  @PostMapping("/frequency/analyze")
  @Throttle(limit = 60, ttlSeconds = 60)
  @ApiDocs.Body("FrequencyAnalysisDto")
  @Operation(summary = "Analyze claim frequency", description = "Binomial or Poisson claim count: mean, variance, quantiles and the probability distribution.")
  public Object frequency(HttpServletRequest r) {
    return service.frequency(body(r));
  }

  @PostMapping("/severity/analyze")
  @Throttle(limit = 60, ttlSeconds = 60)
  @ApiDocs.Body("SeverityAnalysisDto")
  @Operation(summary = "Analyze claim severity", description = "Deterministic, gamma or lognormal claim cost: derived parameters, quantiles, tail and density curve.")
  public Object severity(HttpServletRequest r) {
    return service.severity(body(r));
  }

  @PostMapping("/aggregate/analyze")
  @Throttle(limit = 60, ttlSeconds = 60)
  @ApiDocs.Body("AggregateAnalysisDto")
  @Operation(summary = "Analyze aggregate loss", description = "Compound loss S = X1 + … + XN: exact moments, and the distribution by exact lattice or Panjer recursion with VaR, TVaR and exceedance probabilities.")
  public Object aggregate(HttpServletRequest r) {
    return service.aggregate(body(r));
  }

  @PostMapping("/pricing/calculate")
  @Throttle(limit = 60, ttlSeconds = 60)
  @ApiDocs.Body("PricingDto")
  @Operation(summary = "Calculate premiums", description = "Pure, technical and gross premium with expenses and margin, loss/expense/combined ratios, probability of an underwriting loss and one-at-a-time sensitivities.")
  public Object price(HttpServletRequest r) {
    return service.price(body(r));
  }

  @GetMapping("/scenarios")
  @Operation(summary = "List your saved scenarios")
  public Object scenarios(HttpServletRequest r) {
    return service.scenarios(AuthUser.from(r).id());
  }

  @PostMapping("/scenarios")
  @ResponseStatus(HttpStatus.CREATED)
  @Throttle(limit = 60, ttlSeconds = 60)
  @ApiDocs.Body("SaveScenarioDto")
  @Operation(summary = "Save a pricing scenario", description = "Stores the assumptions with results recomputed by the server and the model version.")
  public Object save(HttpServletRequest r) {
    return service.save(AuthUser.from(r).id(), body(r));
  }

  @GetMapping("/scenarios/{id}")
  @Operation(summary = "Get a saved scenario")
  public Object scenario(HttpServletRequest r, @PathVariable("id") String id) {
    return service.scenario(AuthUser.from(r).id(), PathParams.uuid(id));
  }

  @DeleteMapping("/scenarios/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @Operation(summary = "Delete a saved scenario")
  public void deleteScenario(HttpServletRequest r, @PathVariable("id") String id) {
    service.deleteScenario(AuthUser.from(r).id(), PathParams.uuid(id));
  }

  @GetMapping("/simulations")
  @Operation(summary = "List your simulation runs", description = "The most recent runs, newest first, with headline figures.")
  public Object simulations(HttpServletRequest r) {
    return service.simulations(AuthUser.from(r).id());
  }

  @PostMapping("/simulations")
  @ResponseStatus(HttpStatus.CREATED)
  @Throttle(limit = 12, ttlSeconds = 60)
  @ApiDocs.Body("RunSimulationDto")
  @Operation(summary = "Run a Monte Carlo simulation", description = "Simulates the aggregate claims of many periods with a seeded, reproducible stream, compares the estimates with the exact results, stores the summary and returns it. Runs execute off the request thread and are limited in size.")
  public CompletableFuture<Map<String, Object>> simulate(HttpServletRequest r) {
    return service.simulate(AuthUser.from(r).id(), body(r));
  }

  @GetMapping("/simulations/{id}")
  @Operation(summary = "Get a simulation run")
  public Object simulation(HttpServletRequest r, @PathVariable("id") String id) {
    return service.simulation(AuthUser.from(r).id(), PathParams.uuid(id));
  }

  @DeleteMapping("/simulations/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @Operation(summary = "Delete a simulation run")
  public void deleteSimulation(HttpServletRequest r, @PathVariable("id") String id) {
    service.deleteSimulation(AuthUser.from(r).id(), PathParams.uuid(id));
  }
}
