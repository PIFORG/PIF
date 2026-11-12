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
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

/** apps/api/src/actuarial/reserving.controller.ts. Authenticated like every route that is not @Public. */
@RestController
@RequestMapping("/actuarial/reserving")
@Throttle(limit = 120, ttlSeconds = 60)
@Tag(name = "Actuarial Lab")
public class ReservingController {
  private final ReservingService service;
  private final ObjectMapper mapper;

  public ReservingController(ReservingService service, ObjectMapper mapper) {
    this.service = service;
    this.mapper = mapper;
  }

  private Map<String, Object> body(HttpServletRequest r) {
    return JsonBodyCache.get(r, mapper);
  }

  @GetMapping("/examples")
  @Operation(summary = "Fictional reserving examples", description = "Example paid and incurred triangles with earned premiums and default assumptions, the input limits and the available methods.")
  public Object examples() {
    return service.examples();
  }

  @PostMapping("/analyze")
  @ResponseStatus(HttpStatus.OK)
  @Throttle(limit = 60, ttlSeconds = 60)
  @ApiDocs.Body("AnalyzeReservingDto")
  @Operation(summary = "Analyze a claims triangle", description = "Validates the triangles, then estimates development factors, ultimates, case reserves, IBNR and unpaid amounts by chain ladder (paid and incurred), expected loss ratio and Bornhuetter–Ferguson, with sensitivities and the expected future payments. Nothing is stored.")
  public Object analyze(HttpServletRequest r) {
    return service.analyze(body(r));
  }

  @PostMapping("/runs")
  @ResponseStatus(HttpStatus.CREATED)
  @Throttle(limit = 60, ttlSeconds = 60)
  @ApiDocs.Body("SaveReservingRunDto")
  @Operation(summary = "Save a reserving run", description = "Stores the triangles and assumptions with the results recomputed by the server and the model version.")
  public Object save(HttpServletRequest r) {
    return service.save(AuthUser.from(r).id(), body(r));
  }

  @GetMapping("/runs")
  @Operation(summary = "List your reserving runs", description = "The most recent runs, newest first, with headline figures.")
  public Object runs(HttpServletRequest r) {
    return service.runs(AuthUser.from(r).id());
  }

  @GetMapping("/runs/{id}")
  @Operation(summary = "Get a reserving run")
  public Object run(HttpServletRequest r, @PathVariable("id") String id) {
    return service.run(AuthUser.from(r).id(), PathParams.uuid(id));
  }

  @DeleteMapping("/runs/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @Operation(summary = "Delete a reserving run")
  public void remove(HttpServletRequest r, @PathVariable("id") String id) {
    service.deleteRun(AuthUser.from(r).id(), PathParams.uuid(id));
  }
}
