package com.pif.api.config;

import com.pif.api.admin.AdminDtos;
import com.pif.api.actuarial.ActuarialDtos;
import com.pif.api.auth.AuthDtos;
import com.pif.api.backtest.BacktestDtos;
import com.pif.api.learning.LearningDtos;
import com.pif.api.trading.TradingDtos;
import com.pif.api.web.ApiDocs;
import com.pif.api.web.RouteAnnotations.Public;
import io.swagger.v3.oas.annotations.tags.Tag;
import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.media.ArraySchema;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.IntegerSchema;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.ObjectSchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.media.StringSchema;
import io.swagger.v3.oas.models.parameters.Parameter;
import io.swagger.v3.oas.models.parameters.RequestBody;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.responses.ApiResponses;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springdoc.core.customizers.OperationCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.AnnotatedElementUtils;

/**
 * The OpenAPI document of apps/api/src/main.ts: same info, bearer scheme, tag list, request schemas and the standard
 * error responses of apps/api/src/common/swagger/openapi.ts. Served only when SWAGGER_ENABLED allows it.
 */
@Configuration
public class OpenApiConfig {

  static final String BEARER = "bearer";

  private static final String DESCRIPTION = "An interactive financial simulation platform designed to help users "
      + "understand financial markets, practice virtual trading, manage portfolios, and make informed investment "
      + "decisions.";

  /** apps/api/src/common/swagger/api-tags.ts, in the same order. Tags without a migrated operation are dropped. */
  private static final Map<String, String> TAGS = tags(
      "Authentication", "Registration, email verification, sign-in, token refresh and password recovery",
      "User Management", "Profile, preferences, dashboard context and account lifecycle of the signed-in user",
      "Account Security", "Password and email address changes",
      "Sessions", "Active devices and session revocation",
      "Multi-Factor Authentication", "Authenticator app enrollment, sign-in verification and recovery codes",
      "Administration", "User oversight, account status and role management (administrators only)",
      "Audit Logs", "Security and administration event history (administrators only)",
      "MarketQuest Learning", "Missions, the deterministic market simulation, server-side assessment, rule-based "
          + "mentor and competency profile",
      "Financial Time Machine", "Decision timelines, counterfactual replays on the same market path, and "
          + "side-by-side comparison",
      "FinStories", "Short narrative lessons with watch progress",
      "Markets", "Instrument master, simulated quotes with provenance, price history, indicators and watchlist",
      "Portfolios", "Virtual portfolios: valuation, cash ledger, deposits and withdrawals, analytics and risk",
      "Trading", "Server-authoritative order preview, idempotent submission, cancellation, order and trade history",
      "Backtesting", "Synchronous historical strategy replay on fictional daily closes (no job queue in v1)",
      "Actuarial Lab", "Non-life insurance pricing: claim frequency and severity, aggregate loss, premiums and saved "
          + "scenarios (fictional data, model estimates)",
      "System Health", "Service and database availability");

  private static final Map<String, List<Parameter>> QUERIES = queries();

  private static Map<String, List<Parameter>> queries() {
    Map<String, List<Parameter>> all = new LinkedHashMap<>(AdminDtos.openApiQueries());
    all.putAll(TradingDtos.openApiQueries());
    return all;
  }

  @Bean
  public OpenAPI pifOpenApi() {
    Components components = new Components().addSecuritySchemes(BEARER, new SecurityScheme()
        .type(SecurityScheme.Type.HTTP).scheme("bearer").bearerFormat("JWT")
        .description("Paste the short-lived `accessToken` returned by sign-in, MFA verification or token refresh."));
    AuthDtos.openApiSchemas().forEach(components::addSchemas);
    AdminDtos.openApiSchemas().forEach(components::addSchemas);
    TradingDtos.openApiSchemas().forEach(components::addSchemas);
    BacktestDtos.openApiSchemas().forEach(components::addSchemas);
    LearningDtos.openApiSchemas().forEach(components::addSchemas);
    ActuarialDtos.openApiSchemas().forEach(components::addSchemas);
    OpenAPI api = new OpenAPI()
        .info(new Info().title("Market Trading Room Simulator API").description(DESCRIPTION).version("1.0.0")
            .contact(new Contact()))
        .components(components);
    TAGS.forEach((name, description) ->
        api.addTagsItem(new io.swagger.v3.oas.models.tags.Tag().name(name).description(description)));
    return api;
  }

  /** Mirrors ApiDoc(tag, …) and @ApiBearerAuth(): a method-level @Tag replaces the controller's tag. */
  @Bean
  public OperationCustomizer pifOperationCustomizer() {
    return (operation, handler) -> {
      Tag[] methodTags = handler.getMethod().getAnnotationsByType(Tag.class);
      if (methodTags.length > 0) operation.setTags(Arrays.stream(methodTags).map(Tag::name).toList());
      boolean isPublic = AnnotatedElementUtils.hasAnnotation(handler.getMethod(), Public.class)
          || AnnotatedElementUtils.hasAnnotation(handler.getBeanType(), Public.class);
      if (!isPublic) operation.addSecurityItem(new SecurityRequirement().addList(BEARER));
      ApiDocs.Body body = handler.getMethodAnnotation(ApiDocs.Body.class);
      if (body != null) {
        operation.requestBody(new RequestBody().required(true).content(new Content().addMediaType("application/json",
            new MediaType().schema(new Schema<>().$ref("#/components/schemas/" + body.value())))));
      }
      ApiDocs.Query query = handler.getMethodAnnotation(ApiDocs.Query.class);
      if (query != null) {
        List<Parameter> parameters = QUERIES.get(query.value());
        if (parameters == null) throw new IllegalStateException("Unknown query parameter set " + query.value());
        parameters.forEach(operation::addParametersItem);
      }
      return operation;
    };
  }

  /**
   * withStandardErrorResponses: the error envelope next to the success response; declared responses are kept. The
   * schema is added here because springdoc drops component schemas that nothing referenced before customizers ran.
   */
  @Bean
  public OpenApiCustomizer pifStandardErrorResponses() {
    return api -> {
      if (api.getComponents() == null) api.setComponents(new Components());
      api.getComponents().addSchemas("ErrorResponse", errorResponseSchema());
      if (api.getPaths() != null) {
        for (PathItem item : api.getPaths().values()) {
          for (Operation operation : item.readOperations()) addStandardErrors(operation);
        }
      }
      Set<String> used = new HashSet<>();
      if (api.getPaths() != null) {
        api.getPaths().values().forEach(item -> item.readOperations().forEach(op -> {
          if (op.getTags() != null) used.addAll(op.getTags());
        }));
      }
      if (api.getTags() != null) api.setTags(api.getTags().stream().filter(t -> used.contains(t.getName())).toList());
    };
  }

  private static void addStandardErrors(Operation operation) {
    if (operation.getResponses() == null) operation.setResponses(new ApiResponses());
    ApiResponses responses = operation.getResponses();
    boolean takesInput = operation.getRequestBody() != null
        || (operation.getParameters() != null && !operation.getParameters().isEmpty());
    boolean secured = operation.getSecurity() != null && !operation.getSecurity().isEmpty();
    if (takesInput) addError(responses, "400", "Validation failed (`VALIDATION_ERROR`; messages in `details`)");
    if (secured) {
      addError(responses, "401", "Missing, expired or revoked access token");
      addError(responses, "403", "Not permitted: role, account status, admin MFA policy or failed reauthentication");
    }
    addError(responses, "429", "Too many requests (`RATE_LIMITED`)");
    addError(responses, "503", "Database temporarily unavailable (`DATABASE_UNAVAILABLE`)");
  }

  private static void addError(ApiResponses responses, String code, String description) {
    if (responses.containsKey(code)) return;
    responses.addApiResponse(code, new ApiResponse().description(description).content(new Content().addMediaType(
        "application/json", new MediaType().schema(new Schema<>().$ref("#/components/schemas/ErrorResponse")))));
  }

  private static Schema<?> errorResponseSchema() {
    ObjectSchema s = new ObjectSchema();
    s.setRequired(List.of("statusCode", "message", "errorCode"));
    s.addProperty("statusCode", new IntegerSchema().format(null).example(400));
    s.addProperty("message", new StringSchema().example("Validation failed"));
    s.addProperty("errorCode", new StringSchema().example("VALIDATION_ERROR"));
    s.addProperty("details", new ArraySchema().items(new StringSchema()));
    s.addProperty("correlationId", new StringSchema().example("1f0c2a5e-6a4b-4c1e-9a55-2f1d1b8a7c3d"));
    return s;
  }

  private static Map<String, String> tags(String... nameDescriptionPairs) {
    Map<String, String> out = new LinkedHashMap<>();
    for (int i = 0; i < nameDescriptionPairs.length; i += 2) out.put(nameDescriptionPairs[i], nameDescriptionPairs[i + 1]);
    return out;
  }
}
