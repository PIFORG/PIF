package com.pif.api.stress;

import static com.pif.api.web.ApiDocs.describe;
import static com.pif.api.web.ApiDocs.object;
import static com.pif.api.web.ApiDocs.prop;

import com.pif.api.web.ApiDocs;
import com.pif.api.web.JsNumbers;
import com.pif.api.web.Messages;
import com.pif.api.web.Validation;
import com.pif.api.web.Validation.Checker;
import io.swagger.v3.oas.models.media.NumberSchema;
import io.swagger.v3.oas.models.media.ObjectSchema;
import io.swagger.v3.oas.models.media.Schema;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Request validation for {@code POST /api/stress/run}. */
public final class StressDtos {

  public static final double MAX_INTENSITY = 2;

  private StressDtos() {}

  /** {@code presetId} is null when the scenario was built from factors only. */
  public record RunRequest(String presetId, StressFactors factors, double intensity) {}

  static List<String> presetIds() {
    return StressFactors.PRESETS.stream().map(StressFactors.Preset::id).toList();
  }

  public static Map<String, Schema<?>> openApiSchemas() {
    ObjectSchema factors = new ObjectSchema();
    for (StressFactors.Definition d : StressFactors.DEFINITIONS) {
      factors.addProperty(d.key(), describe(range(d.min(), d.max()), d.label() + " (" + d.unit() + "). "
          + d.description() + " Neutral value: " + JsNumbers.toJsString(d.neutral()) + "."));
    }
    Map<String, Schema<?>> s = new LinkedHashMap<>();
    s.put("RunStressTestDto", object(List.of(),
        prop("scenario", describe(ApiDocs.oneOf(presetIds()),
            "Preset scenario. Omitted: every factor starts neutral.")),
        prop("factors", describe(factors, "Factor values replacing those of the preset.")),
        prop("intensity", describe(range(0, MAX_INTENSITY),
            "Scales every shock around its neutral value (0 = no shock, 1 = as defined, 2 = twice). Default 1."))));
    return s;
  }

  private static NumberSchema range(double min, double max) {
    NumberSchema n = new NumberSchema();
    n.setMinimum(BigDecimal.valueOf(min));
    n.setMaximum(BigDecimal.valueOf(max));
    return n;
  }

  public static RunRequest run(Map<String, Object> body) {
    Checker c = new Checker(body, Set.of("scenario", "factors", "intensity"));

    String presetId = null;
    StressFactors base = StressFactors.NEUTRAL;
    if (c.present("scenario")) {
      Object scenario = c.stringValue("scenario");
      if (!Validation.isIn(scenario, presetIds())) {
        c.add(Validation.oneOf("scenario", presetIds()));
      } else {
        presetId = (String) scenario;
        base = StressFactors.preset(presetId).factors();
      }
    }

    double[] values = base.toArray();
    Object raw = c.raw("factors");
    if (raw != null) {
      if (!(raw instanceof Map<?, ?> map)) {
        c.add(Messages.format("validation.must_be_object", "factors"));
      } else {
        Set<String> known = new java.util.HashSet<>();
        for (StressFactors.Definition d : StressFactors.DEFINITIONS) known.add(d.key());
        for (Object key : map.keySet()) {
          if (!known.contains(String.valueOf(key))) {
            c.add(Messages.format("validation.property_forbidden", "factors." + key));
          }
        }
        for (int i = 0; i < StressFactors.DEFINITIONS.size(); i++) {
          StressFactors.Definition d = StressFactors.DEFINITIONS.get(i);
          if (!map.containsKey(d.key())) continue;
          Double v = number(c, "factors." + d.key(), map.get(d.key()), d.min(), d.max());
          if (v != null) values[i] = v;
        }
      }
    }

    double intensity = 1;
    if (c.present("intensity")) {
      Double v = number(c, "intensity", c.raw("intensity"), 0, MAX_INTENSITY);
      if (v != null) intensity = v;
    }
    c.requireValid();
    return new RunRequest(presetId, StressFactors.of(values), intensity);
  }

  private static Double number(Checker c, String field, Object raw, double min, double max) {
    if (!(raw instanceof Number n) || Double.isNaN(n.doubleValue()) || Double.isInfinite(n.doubleValue())) {
      c.add(Validation.mustBeNumber(field));
      return null;
    }
    double v = n.doubleValue();
    boolean ok = true;
    if (v > max) {
      c.add(Validation.notGreaterThan(field, JsNumbers.toJsString(max)));
      ok = false;
    }
    if (v < min) {
      c.add(Validation.notLessThan(field, JsNumbers.toJsString(min)));
      ok = false;
    }
    return ok ? v : null;
  }
}
