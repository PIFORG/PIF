package com.pif.api.web;

import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.core.JsonGenerator;
import tools.jackson.databind.SerializationContext;
import tools.jackson.databind.ValueSerializer;
import tools.jackson.databind.module.SimpleModule;

/**
 * Doubles leave the API as JSON.stringify writes them: {@code 100} rather than {@code 100.0}, {@code 1e-7} rather
 * than {@code 1.0E-7}, and null for NaN and ±Infinity.
 */
@Configuration
public class JsonNumbersConfig {

  static final class JsDoubleSerializer extends ValueSerializer<Double> {
    @Override
    public void serialize(Double value, JsonGenerator gen, SerializationContext ctxt) {
      String text = JsNumbers.toJson(value);
      if (text == null) gen.writeNull();
      else gen.writeNumber(text);
    }
  }

  @Bean
  public JsonMapperBuilderCustomizer jsNumberSerialization() {
    SimpleModule module = new SimpleModule("pif-js-numbers");
    module.addSerializer(Double.class, new JsDoubleSerializer());
    module.addSerializer(double.class, new JsDoubleSerializer());
    return builder -> builder.addModule(module);
  }
}
