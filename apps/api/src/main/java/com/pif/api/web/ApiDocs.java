package com.pif.api.web;

import io.swagger.v3.oas.models.media.NumberSchema;
import io.swagger.v3.oas.models.media.ObjectSchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.media.StringSchema;
import io.swagger.v3.oas.models.parameters.Parameter;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/**
 * OpenAPI documentation helpers. Controllers read the raw JSON body (JsonBodyCache) and validate it with the
 * class-validator rules of the NestJS DTOs, so springdoc cannot infer request schemas; each DTO module publishes its
 * schemas under the NestJS DTO name and the handler names the one it accepts with {@link Body}.
 */
public final class ApiDocs {

  private ApiDocs() {}

  /** The JSON request body is the component schema of this name (the NestJS DTO class name). */
  @Retention(RetentionPolicy.RUNTIME)
  @Target(ElementType.METHOD)
  public @interface Body {
    String value();
  }

  /** The optional query parameters are the named set a DTO module publishes (the NestJS query DTO name). */
  @Retention(RetentionPolicy.RUNTIME)
  @Target(ElementType.METHOD)
  public @interface Query {
    String value();
  }

  public static Parameter optionalQuery(String name, Schema<?> schema) {
    return new Parameter().name(name).in("query").required(false).schema(schema);
  }

  public static NumberSchema number(Integer minimum, Integer maximum) {
    NumberSchema s = new NumberSchema();
    if (minimum != null) s.setMinimum(BigDecimal.valueOf(minimum));
    if (maximum != null) s.setMaximum(BigDecimal.valueOf(maximum));
    return s;
  }

  public static StringSchema text() {
    return new StringSchema();
  }

  public static StringSchema uuid() {
    StringSchema s = new StringSchema();
    s.setFormat("uuid");
    return s;
  }

  public static StringSchema text(Integer minLength, Integer maxLength) {
    StringSchema s = new StringSchema();
    if (minLength != null) s.setMinLength(minLength);
    if (maxLength != null) s.setMaxLength(maxLength);
    return s;
  }

  public static StringSchema email(Integer maxLength) {
    StringSchema s = text(null, maxLength);
    s.setFormat("email");
    return s;
  }

  public static StringSchema pattern(String regex) {
    StringSchema s = new StringSchema();
    s.setPattern(regex);
    return s;
  }

  public static StringSchema oneOf(List<String> values) {
    StringSchema s = new StringSchema();
    s.setEnum(values);
    return s;
  }

  public static <T extends Schema<?>> T describe(T schema, String description) {
    schema.setDescription(description);
    return schema;
  }

  /** An object schema with properties in declaration order. */
  @SafeVarargs
  public static ObjectSchema object(List<String> required, Map.Entry<String, Schema<?>>... properties) {
    ObjectSchema s = new ObjectSchema();
    for (Map.Entry<String, Schema<?>> p : properties) s.addProperty(p.getKey(), p.getValue());
    if (!required.isEmpty()) s.setRequired(required);
    return s;
  }

  public static Map.Entry<String, Schema<?>> prop(String name, Schema<?> schema) {
    return Map.entry(name, schema);
  }
}
