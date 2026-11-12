package com.pif.api.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.pif.api.admin.AdminController;
import com.pif.api.admin.AdminDtos;
import com.pif.api.auth.AuthController;
import com.pif.api.health.HealthController;
import com.pif.api.users.UsersController;
import com.pif.api.web.ApiDocs;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.Paths;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.parameters.RequestBody;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.responses.ApiResponses;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import java.lang.reflect.Method;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.web.method.HandlerMethod;

class OpenApiConfigTest {

  private static final List<Class<?>> CONTROLLERS =
      List.of(AuthController.class, AdminController.class, UsersController.class, HealthController.class);

  private final OpenApiConfig config = new OpenApiConfig();
  private final OpenAPI api = config.pifOpenApi();

  private Operation customize(Class<?> controller, String methodName) {
    Method method = handler(controller, methodName);
    Operation op = new Operation().addTagsItem("class-tag");
    return config.pifOperationCustomizer().customize(op, new HandlerMethod(new Object(), method) {
      @Override
      public Class<?> getBeanType() {
        return controller;
      }
    });
  }

  private static Method handler(Class<?> controller, String name) {
    for (Method m : controller.getDeclaredMethods()) if (m.getName().equals(name)) return m;
    throw new AssertionError("No handler " + name);
  }

  @Test
  void everyNamedRequestBodyAndQuerySetExists() {
    Map<String, ?> schemas = api.getComponents().getSchemas();
    int bodies = 0;
    for (Class<?> controller : CONTROLLERS) {
      for (Method m : controller.getDeclaredMethods()) {
        ApiDocs.Body body = m.getAnnotation(ApiDocs.Body.class);
        if (body != null) {
          bodies++;
          assertThat(schemas).as(m.getName()).containsKey(body.value());
        }
        ApiDocs.Query query = m.getAnnotation(ApiDocs.Query.class);
        if (query != null) assertThat(AdminDtos.openApiQueries()).as(m.getName()).containsKey(query.value());
      }
    }
    assertThat(bodies).isEqualTo(22);
  }

  @Test
  void signedInRoutesRequireTheBearerSchemeAndPublicRoutesDoNot() {
    assertThat(customize(AuthController.class, "me").getSecurity())
        .containsExactly(new SecurityRequirement().addList("bearer"));
    assertThat(customize(AdminController.class, "overview").getSecurity()).isNotEmpty();
    assertThat(customize(AuthController.class, "login").getSecurity()).isNull();
    assertThat(customize(HealthController.class, "check").getSecurity()).isNull();
  }

  @Test
  void aMethodTagReplacesTheControllerTagAndTheBodyIsReferenced() {
    Operation op = customize(AuthController.class, "mfaEnable");
    assertThat(op.getTags()).containsExactly("Multi-Factor Authentication");
    assertThat(op.getRequestBody().getContent().get("application/json").getSchema().get$ref())
        .isEqualTo("#/components/schemas/MfaEnableDto");
    assertThat(customize(AuthController.class, "login").getTags()).containsExactly("class-tag");
    assertThat(customize(AdminController.class, "listUsers").getParameters()).extracting("name")
        .containsExactly("page", "pageSize", "q", "status", "role", "emailVerified");
  }

  @Test
  void standardErrorsFollowTheNestRulesAndKeepDeclaredResponses() {
    Operation secured = new Operation().responses(new ApiResponses().addApiResponse("200", new ApiResponse()))
        .addSecurityItem(new SecurityRequirement().addList("bearer")).requestBody(new RequestBody());
    Operation open = new Operation().responses(new ApiResponses().addApiResponse("200", new ApiResponse())
        .addApiResponse("401", new ApiResponse().description("declared")));
    OpenAPI doc = new OpenAPI().paths(new Paths()
        .addPathItem("/a", new PathItem().post(secured)).addPathItem("/b", new PathItem().get(open)));
    config.pifStandardErrorResponses().customise(doc);
    assertThat(secured.getResponses()).containsOnlyKeys("200", "400", "401", "403", "429", "503");
    assertThat(open.getResponses()).containsOnlyKeys("200", "401", "429", "503");
    assertThat(open.getResponses().get("401").getDescription()).isEqualTo("declared");
    assertThat(doc.getComponents().getSchemas()).containsKey("ErrorResponse");
  }
}
