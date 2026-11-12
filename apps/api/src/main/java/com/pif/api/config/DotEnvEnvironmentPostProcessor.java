package com.pif.api.config;

import java.io.IOException;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

/**
 * Reads the application's environment file. Existing secrets, peppers and keys must
 * be retained when configuring a migrated installation so stored identities remain valid.
 *
 * <p>Real environment variables and system properties take precedence over the file. The file
 * location defaults to {@code .env} relative to the working directory and can be set with
 * {@code PIF_ENV_FILE}. Values are never logged.
 */
public class DotEnvEnvironmentPostProcessor implements EnvironmentPostProcessor {

  static final String DOTENV_SOURCE = "pifDotEnv";
  static final String DATASOURCE_SOURCE = "pifDatasourceFromDatabaseUrl";
  static final String API_DOCS_SOURCE = "pifApiDocs";

  @Override
  public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
    String configured = environment.getProperty("PIF_ENV_FILE");
    Path file = Path.of(configured != null && !configured.isBlank() ? configured : ".env");
    if (Files.isRegularFile(file)) {
      environment.getPropertySources().addLast(new MapPropertySource(DOTENV_SOURCE, parse(file)));
    }
    String databaseUrl = environment.getProperty("DATABASE_URL");
    if (databaseUrl != null && !databaseUrl.isBlank() && environment.getProperty("spring.datasource.url") == null) {
      environment.getPropertySources().addLast(new MapPropertySource(DATASOURCE_SOURCE, toDatasource(databaseUrl)));
    }
    boolean docs = apiDocsEnabled(environment.getProperty("SWAGGER_ENABLED"), environment.getProperty("NODE_ENV"));
    environment.getPropertySources().addLast(new MapPropertySource(API_DOCS_SOURCE,
        Map.of("springdoc.api-docs.enabled", docs, "springdoc.swagger-ui.enabled", docs)));
  }

  /** Same rule as apps/api/src/config/configuration.ts: SWAGGER_ENABLED, else on outside production. */
  static boolean apiDocsEnabled(String swaggerEnabled, String nodeEnv) {
    String value = swaggerEnabled != null ? swaggerEnabled : ("production".equals(nodeEnv) ? "false" : "true");
    return value.strip().equalsIgnoreCase("true");
  }

  static Map<String, Object> parse(Path file) {
    List<String> lines;
    try {
      lines = Files.readAllLines(file, StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw new IllegalStateException("Cannot read environment file " + file.getFileName(), e);
    }
    Map<String, Object> values = new LinkedHashMap<>();
    for (String raw : lines) {
      String line = raw.strip();
      if (line.isEmpty() || line.startsWith("#")) continue;
      if (line.startsWith("export ")) line = line.substring(7).strip();
      int eq = line.indexOf('=');
      if (eq <= 0) continue;
      String key = line.substring(0, eq).strip();
      String value = line.substring(eq + 1).strip();
      if (value.length() >= 2
          && ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))) {
        value = value.substring(1, value.length() - 1);
      } else {
        int comment = value.indexOf(" #");
        if (comment >= 0) value = value.substring(0, comment).strip();
      }
      values.put(key, value);
    }
    return values;
  }

  /** postgresql://user:pass@host:port/db?schema=public → JDBC URL + credentials. */
  static Map<String, Object> toDatasource(String databaseUrl) {
    URI uri = URI.create(databaseUrl.strip());
    if (!"postgresql".equals(uri.getScheme()) && !"postgres".equals(uri.getScheme())) {
      throw new IllegalStateException("DATABASE_URL must be a postgresql:// URL");
    }
    String database = uri.getPath() == null ? "" : uri.getPath().replaceFirst("^/", "");
    int port = uri.getPort() == -1 ? 5432 : uri.getPort();
    String schema = "public";
    Map<String, String> query = new HashMap<>();
    if (uri.getRawQuery() != null) {
      for (String pair : uri.getRawQuery().split("&")) {
        int eq = pair.indexOf('=');
        if (eq > 0) query.put(pair.substring(0, eq), decode(pair.substring(eq + 1)));
      }
    }
    if (query.containsKey("schema")) schema = query.get("schema");

    Map<String, Object> props = new LinkedHashMap<>();
    props.put("spring.datasource.url",
        "jdbc:postgresql://" + uri.getHost() + ":" + port + "/" + database + "?currentSchema=" + schema);
    String userInfo = uri.getRawUserInfo();
    if (userInfo != null) {
      int colon = userInfo.indexOf(':');
      props.put("spring.datasource.username", decode(colon >= 0 ? userInfo.substring(0, colon) : userInfo));
      if (colon >= 0) props.put("spring.datasource.password", decode(userInfo.substring(colon + 1)));
    }
    props.put("pif.database.name", database);
    return props;
  }

  private static String decode(String value) {
    return URLDecoder.decode(value, StandardCharsets.UTF_8);
  }
}
