package com.pif.api.learning;

import static org.assertj.core.api.Assertions.assertThat;

import com.pif.api.learning.engine.Assessments;
import com.pif.api.learning.engine.Assessments.Assessment;
import com.pif.api.learning.engine.Command;
import com.pif.api.learning.engine.Definitions.AssetDefinition;
import com.pif.api.learning.engine.Definitions.Briefing;
import com.pif.api.learning.engine.Definitions.CompetencyWeight;
import com.pif.api.learning.engine.Definitions.EventRegime;
import com.pif.api.learning.engine.Definitions.FailureRule;
import com.pif.api.learning.engine.Definitions.InitialPosition;
import com.pif.api.learning.engine.Definitions.MarketEventDefinition;
import com.pif.api.learning.engine.Definitions.MissionDefinition;
import com.pif.api.learning.engine.Definitions.MissionRules;
import com.pif.api.learning.engine.Definitions.ObjectiveDefinition;
import com.pif.api.learning.engine.Definitions.ScenarioDefinition;
import com.pif.api.learning.engine.Definitions.ScoringConfig;
import com.pif.api.learning.engine.Definitions.ScoringWeights;
import com.pif.api.learning.engine.Definitions.Shock;
import com.pif.api.learning.engine.Definitions.StressScenarioDefinition;
import com.pif.api.learning.engine.Mastery;
import com.pif.api.learning.engine.Mastery.MissionProgress;
import com.pif.api.learning.engine.Mastery.Observation;
import com.pif.api.learning.engine.MarketPath;
import com.pif.api.learning.engine.Mentor;
import com.pif.api.learning.engine.Metrics;
import com.pif.api.learning.engine.MissionCatalog;
import com.pif.api.learning.engine.Objectives;
import com.pif.api.learning.engine.SimState;
import com.pif.api.learning.engine.Simulator;
import com.pif.api.learning.engine.Simulator.CommandResult;
import com.pif.api.learning.engine.Simulator.Context;
import com.pif.api.learning.engine.Simulator.RecordedCommand;
import com.pif.api.learning.engine.Simulator.SimulationError;
import com.pif.api.learning.engine.TimeMachine;
import com.pif.api.learning.stories.StoryCatalog;
import com.pif.api.learning.stories.StoryCatalog.StoryDefinition;
import com.pif.api.learning.stories.StoryCatalog.StoryScene;
import com.pif.api.learning.stories.StoryProgress;
import com.pif.api.learning.stories.StoryProgress.ProgressUpdate;
import com.pif.api.learning.stories.StoryProgress.StoredProgress;
import com.pif.api.web.JsNumbers;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import tools.jackson.databind.json.JsonMapper;

/**
 * Golden master for the learning engine: every expectation in {@code fixtures/learning-golden.json} was produced by the
 * TypeScript engine (contract/generate-learning-fixtures.mjs) and must match bit for bit. Covered:
 *
 * <ul>
 *   <li>the mission catalog: validation, briefings, every quote and the price history of each mission;
 *   <li>scripted and seeded-random command sequences on every catalog mission and on the fixture missions: the
 *       command preview, every outcome/refusal, event, state digest, session view digest and in-session mentor message
 *       (all three modes) after every command;
 *   <li>the final state, view, metrics, objectives, assessment, debrief, replay determinism and every Financial Time
 *       Machine branch (manual and hold) of finished sessions;
 *   <li>mastery, level unlocking and recommendations, and FinStories scenes and watch progress.
 * </ul>
 *
 * State, view and branch results are compared through the same SHA-256 digests the generator wrote
 * (digest = sha256 of JSON.stringify of the encoded value); the final state of every session is also compared in full,
 * so a mismatch shows the first differing text.
 */
class LearningGoldenMasterTest {

  private static final JsonMapper JSON = JsonMapper.builder().build();
  private static final List<String> MENTOR_MODES = List.of("GUIDED", "SOCRATIC", "CRITICAL");
  private static Map<String, Object> fixture;

  @BeforeAll
  static void load() throws Exception {
    try (InputStream in = LearningGoldenMasterTest.class.getResourceAsStream("/fixtures/learning-golden.json")) {
      fixture = map(JSON.readValue(in, Map.class));
    }
  }

  // ---------------------------------------------------------------- helpers

  @SuppressWarnings("unchecked")
  private static Map<String, Object> map(Object o) {
    return (Map<String, Object>) o;
  }

  @SuppressWarnings("unchecked")
  private static List<Object> list(Object o) {
    return (List<Object>) o;
  }

  private static double d(Object o) {
    return Double.parseDouble((String) o);
  }

  private static int i(Object o) {
    return (int) d(o);
  }

  private static Double dOrNull(Object o) {
    return o == null ? null : d(o);
  }

  private static List<String> strings(Object o) {
    return list(o).stream().map(x -> (String) x).toList();
  }

  /** The fixture's number text: Number.prototype.toString(), with "-0" kept. */
  private static String num(double x) {
    return x == 0 && 1 / x < 0 ? "-0" : JsNumbers.toJsString(x);
  }

  private static String iso(Instant instant) {
    return com.pif.api.data.Db.iso(instant);
  }

  /** Encodes a Java output tree the way the generator's enc() encodes TypeScript values. */
  private static Object enc(Object v) {
    if (v instanceof Number n) return num(n.doubleValue());
    if (v instanceof Instant t) return iso(t);
    if (v instanceof Map<?, ?> m) {
      Map<String, Object> out = new LinkedHashMap<>();
      m.forEach((k, x) -> out.put((String) k, enc(x)));
      return out;
    }
    if (v instanceof List<?> l) return l.stream().map(LearningGoldenMasterTest::enc).toList();
    return v;
  }

  private static String json(Object o) {
    return JSON.writeValueAsString(o);
  }

  private static String digest(Object value) {
    try {
      byte[] hash = MessageDigest.getInstance("SHA-256").digest(json(enc(value)).getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(hash);
    } catch (java.security.NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  /** The same tree with every object's properties in alphabetical order. */
  private static Object sortedKeys(Object v) {
    if (v instanceof Map<?, ?> m) {
      Map<String, Object> out = new java.util.TreeMap<>();
      m.forEach((k, x) -> out.put((String) k, sortedKeys(x)));
      return out;
    }
    if (v instanceof List<?> l) return l.stream().map(LearningGoldenMasterTest::sortedKeys).toList();
    return v;
  }

  /** Compares two JSON trees as text and, on a mismatch, shows where they first differ. */
  private static void assertSame(String what, Object expected, Object actual) {
    String e = json(expected);
    String a = json(actual);
    if (e.equals(a)) return;
    int at = 0;
    while (at < e.length() && at < a.length() && e.charAt(at) == a.charAt(at)) at++;
    int from = Math.max(0, at - 80);
    throw new AssertionError(what + " differs at character " + at + "\n  expected: …"
        + e.substring(from, Math.min(e.length(), at + 120)) + "\n  actual:   …"
        + a.substring(from, Math.min(a.length(), at + 120)));
  }

  // ---------------------------------------------------------------- fixture missions

  private static MissionDefinition parseMission(Map<String, Object> m) {
    Map<String, Object> s = map(m.get("scenario"));
    List<AssetDefinition> assets = list(s.get("assets")).stream().map(o -> {
      Map<String, Object> a = map(o);
      return new AssetDefinition((String) a.get("symbol"), (String) a.get("name"), (String) a.get("sector"),
          d(a.get("initialPrice")), d(a.get("driftPerStep")), d(a.get("volPerStep")), d(a.get("beta")),
          d(a.get("spreadBps")), d(a.get("depth")));
    }).toList();
    List<MarketEventDefinition> events = list(s.get("events")).stream().map(o -> {
      Map<String, Object> e = map(o);
      EventRegime regime = null;
      if (e.get("regime") != null) {
        Map<String, Object> r = map(e.get("regime"));
        regime = new EventRegime(i(r.get("steps")), dOrNull(r.get("volMultiplier")),
            dOrNull(r.get("driftShiftPerStep")), dOrNull(r.get("spreadMultiplier")), dOrNull(r.get("depthMultiplier")),
            r.get("symbols") == null ? null : strings(r.get("symbols")));
      }
      return new MarketEventDefinition((String) e.get("id"), i(e.get("step")), (String) e.get("kind"),
          (String) e.get("sentiment"), (String) e.get("headline"), (String) e.get("body"),
          Boolean.TRUE.equals(e.get("unconfirmed")), shocks(e.get("shocks")), regime);
    }).toList();
    List<StressScenarioDefinition> stress = list(s.get("stressScenarios")).stream().map(o -> {
      Map<String, Object> x = map(o);
      return new StressScenarioDefinition((String) x.get("id"), (String) x.get("name"), (String) x.get("description"),
          shocks(x.get("shocks")));
    }).toList();
    ScenarioDefinition scenario = new ScenarioDefinition(i(s.get("steps")), (String) s.get("stepLabel"),
        i(s.get("historySteps")), assets, events, stress, (long) d(s.get("seed")), (String) s.get("provenance"));

    List<Object> ruleParts = new ArrayList<>();
    map(m.get("rules")).forEach((k, v) -> {
      ruleParts.add(k);
      boolean numeric = k.equals("feeBps") || k.equals("minFee") || k.equals("maxPositionWeightPct");
      ruleParts.add(numeric ? (Object) d(v) : v);
    });
    MissionRules rules = MissionRules.of(ruleParts.toArray());

    List<ObjectiveDefinition> objectives = list(m.get("objectives")).stream().map(o -> {
      Map<String, Object> x = map(o);
      ObjectiveDefinition obj = ObjectiveDefinition.of((String) x.get("id"), (String) x.get("kind"),
          (String) x.get("label"), (Boolean) x.get("required"));
      if (x.containsKey("side")) obj = obj.side((String) x.get("side"));
      if (x.containsKey("orderType")) obj = obj.orderType((String) x.get("orderType"));
      if (x.containsKey("minCount")) obj = obj.minCount(i(x.get("minCount")));
      if (x.containsKey("limitPct")) obj = obj.limitPct(d(x.get("limitPct")));
      if (x.containsKey("fromStep")) obj = obj.fromStep(i(x.get("fromStep")));
      if (x.containsKey("count")) obj = obj.count(i(x.get("count")));
      if (x.containsKey("pct")) obj = obj.pct(d(x.get("pct")));
      if (x.containsKey("beforeStep")) obj = obj.beforeStep(i(x.get("beforeStep")));
      if (x.containsKey("eventId")) obj = obj.event((String) x.get("eventId"), i(x.get("withinSteps")));
      return obj;
    }).toList();

    Map<String, Object> sc = map(m.get("scoring"));
    Map<String, Object> w = map(sc.get("weights"));
    ScoringConfig scoring = new ScoringConfig(
        new ScoringWeights(d(w.get("risk")), d(w.get("decision")), d(w.get("reasoning")), d(w.get("execution"))),
        d(sc.get("passThreshold")), dOrNull(sc.get("concentrationLimitPct")), d(sc.get("riskLimitPct")),
        d(sc.get("maxReasonableTrades")));

    Map<String, Object> b = map(m.get("briefing"));
    return new MissionDefinition((String) m.get("slug"), i(m.get("version")), i(m.get("order")),
        (String) m.get("title"), (String) m.get("level"), (String) m.get("availability"), (String) m.get("summary"),
        i(m.get("estimatedMinutes")),
        list(m.get("competencies")).stream()
            .map(o -> new CompetencyWeight((String) map(o).get("competency"), d(map(o).get("weight")))).toList(),
        strings(m.get("learningOutcomes")),
        new Briefing((String) b.get("context"), strings(b.get("rules")), strings(b.get("tips"))),
        (String) m.get("currency"), d(m.get("initialCash")),
        list(m.get("initialPositions")).stream()
            .map(o -> new InitialPosition((String) map(o).get("symbol"), d(map(o).get("quantity")))).toList(),
        scenario, rules, objectives,
        list(m.get("failure")).stream()
            .map(o -> new FailureRule((String) map(o).get("kind"), d(map(o).get("limitPct")))).toList(),
        scoring, (String) m.get("mentorMode"), (String) m.get("relatedStorySlug"));
  }

  private static List<Shock> shocks(Object o) {
    return list(o).stream().map(x -> new Shock((String) map(x).get("symbol"), d(map(x).get("move")))).toList();
  }

  private static MissionDefinition missionOf(Object ref) {
    if (ref instanceof String slug) {
      MissionDefinition m = MissionCatalog.find(slug);
      assertThat(m).as("catalog mission " + slug).isNotNull();
      return m;
    }
    return parseMission(map(list(fixture.get("testMissions")).get(((Number) map(ref).get("test")).intValue())));
  }

  // ---------------------------------------------------------------- catalog

  @Test
  void theCatalogIsValidAndInTheFixtureOrder() {
    Map<String, Object> catalog = map(fixture.get("catalog"));
    assertThat(list(catalog.get("validation"))).isEmpty();
    assertThat(MissionCatalog.validateCatalog(MissionCatalog.MISSIONS)).isEmpty();
    assertThat(MissionCatalog.MISSIONS.stream().map(MissionDefinition::slug).toList())
        .isEqualTo(list(catalog.get("missions")).stream().map(x -> map(x).get("slug")).toList());
  }

  @TestFactory
  Stream<DynamicTest> catalogMissionsBriefingsQuotesAndHistory() {
    return list(map(fixture.get("catalog")).get("missions")).stream().map(o -> {
      Map<String, Object> c = map(o);
      String slug = (String) c.get("slug");
      return DynamicTest.dynamicTest("mission " + slug, () -> {
        MissionDefinition m = MissionCatalog.find(slug);
        assertThat(m).isNotNull();
        assertSame("validation", c.get("validation"), MissionCatalog.validateMission(m));
        assertSame("briefing", c.get("briefing"), enc(LearningViews.missionBriefing(m)));
        MarketPath market = Simulator.createContext(m).market();
        List<Object> quotes = new ArrayList<>();
        for (int step = 0; step <= m.scenario().steps(); step++) {
          List<Object> row = new ArrayList<>();
          for (AssetDefinition a : m.scenario().assets()) {
            var q = market.quoteAt(step, a.symbol());
            row.add(List.of(num(q.mid()), num(q.bid()), num(q.ask()), num(q.depth())));
          }
          quotes.add(row);
        }
        assertSame("quotes", c.get("quotes"), quotes);
        List<Object> history = new ArrayList<>();
        for (AssetDefinition a : m.scenario().assets()) {
          List<Object> series = new ArrayList<>();
          for (MarketPath.MidPoint p : market.midSeriesUpTo(m.scenario().steps(), a.symbol())) {
            Map<String, Object> point = new LinkedHashMap<>();
            point.put("step", p.step());
            point.put("mid", p.mid());
            point.put("bid", p.bid());
            point.put("ask", p.ask());
            series.add(enc(point));
          }
          history.add(series);
        }
        assertSame("history", c.get("history"), history);
      });
    });
  }

  // ---------------------------------------------------------------- sessions

  /** Replays one recorded session and compares everything the generator recorded. */
  private static void replaySession(Map<String, Object> scenario) {
    MissionDefinition mission = missionOf(scenario.get("mission"));
    Context ctx = Simulator.createContext(mission);
    SimState state = Simulator.initialState(ctx);
    List<RecordedCommand> log = new ArrayList<>();

    List<Object> steps = list(scenario.get("steps"));
    for (int k = 0; k < steps.size(); k++) {
      Map<String, Object> entry = map(steps.get(k));
      String label = "command " + k + " " + json(entry.get("command"));
      Command command = Command.fromJson(map(entry.get("command")));
      int seq = entry.containsKey("seq") ? i(entry.get("seq")) : state.lastCommandSeq + 1;

      if (command.isPlaceOrder()) {
        assertSame(label + " preview", entry.get("preview"),
            enc(LearningViews.orderPreviewView(Simulator.previewOrder(ctx, state, command))));
      } else {
        assertThat(entry).as(label).doesNotContainKey("preview");
      }
      try {
        CommandResult result = Simulator.applyCommand(ctx, state, command, seq);
        state = result.state();
        log.add(new RecordedCommand(seq, command));
        Map<String, Object> ok = new LinkedHashMap<>();
        ok.put("outcome", result.outcome());
        ok.put("message", result.message());
        ok.put("events", result.events().stream().map(SimState.DomainEvent::toJson).toList());
        assertThat(entry).as(label + " should not have been refused").doesNotContainKey("error");
        assertSame(label + " result", entry.get("ok"), enc(ok));
      } catch (SimulationError error) {
        Map<String, Object> refusal = new LinkedHashMap<>();
        refusal.put("code", error.code());
        refusal.put("message", error.getMessage());
        assertThat(entry).as(label + " should have succeeded").containsKey("error").doesNotContainKey("ok");
        assertSame(label + " refusal", entry.get("error"), refusal);
      }
      assertThat(digest(state.toJson())).as(label + " state digest").isEqualTo(entry.get("state"));
      assertThat(digest(LearningViews.sessionState(ctx, state))).as(label + " view digest")
          .isEqualTo(entry.get("view"));
      if ("ACTIVE".equals(state.status)) {
        List<String> mentor = new ArrayList<>();
        for (String mode : MENTOR_MODES) mentor.add(digest(Mentor.mentorDuringSession(ctx, state, mode).toJson()));
        assertThat(mentor).as(label + " mentor digests").isEqualTo(entry.get("mentor"));
      } else {
        assertThat(entry).as(label).doesNotContainKey("mentor");
      }
    }
    compareFinal(ctx, state, log, map(scenario.get("final")));
  }

  private static void compareFinal(Context ctx, SimState state, List<RecordedCommand> log, Map<String, Object> fin) {
    assertSame("final state", fin.get("state"), enc(state.toJson()));
    assertSame("final view", fin.get("view"), enc(LearningViews.sessionState(ctx, state)));
    assertSame("final metrics", fin.get("metrics"), enc(Metrics.compute(ctx, state).toJson()));
    assertSame("final objectives", fin.get("objectives"),
        enc(Objectives.evaluate(ctx, state).stream().map(Objectives.ObjectiveResult::toJson).toList()));
    assertThat(digest(Simulator.replay(ctx, log).toJson()) .equals(digest(state.toJson()))).as("replayed")
        .isEqualTo(fin.get("replayed"));
    assertSame("describe", fin.get("describe"),
        log.stream().map(c -> LearningViews.describeCommand(c.command())).toList());

    if ("ACTIVE".equals(state.status)) {
      assertThat(fin).as("open session").doesNotContainKey("assessment").doesNotContainKey("branches");
      List<Object> mentor = new ArrayList<>();
      for (String mode : MENTOR_MODES) mentor.add(enc(Mentor.mentorDuringSession(ctx, state, mode).toJson()));
      assertSame("final mentor", fin.get("mentor"), mentor);
      return;
    }
    Assessment assessment = Assessments.assessSession(ctx, state);
    assertSame("assessment", fin.get("assessment"), enc(assessment.toJson()));
    assertSame("debrief", fin.get("debrief"), enc(Mentor.mentorDebrief(ctx, state, assessment).toJson()));

    List<Object> branches = new ArrayList<>();
    for (Object o : list(fin.get("branches"))) {
      Map<String, Object> expected = map(o);
      int fromSeq = i(expected.get("fromSeq"));
      String strategy = (String) expected.get("strategy");
      List<Command> commands = TimeMachine.branchCommands(ctx, log, fromSeq, strategy);
      TimeMachine.Played played = TimeMachine.play(ctx, commands);
      Map<String, Object> branch = new LinkedHashMap<>();
      branch.put("fromSeq", num(fromSeq));
      branch.put("strategy", strategy);
      // The generator builds scripted commands with its own property order (extra fields last); the engine only
      // reads them by name, so the commands are compared by content, not by property order.
      branch.put("commands", sortedKeys(enc(commands.stream().map(Command::toJson).toList())));
      branch.put("applied", num(played.applied().size()));
      branch.put("state", digest(played.state().toJson()));
      branch.put("status", played.state().status);
      if (!"ACTIVE".equals(played.state().status)) {
        branch.put("assessment", digest(Assessments.assessSession(ctx, played.state()).toJson()));
      }
      branches.add(branch);
    }
    List<Object> expectedBranches = new ArrayList<>();
    for (Object o : list(fin.get("branches"))) {
      Map<String, Object> e = new LinkedHashMap<>(map(o));
      e.put("commands", sortedKeys(e.get("commands")));
      expectedBranches.add(e);
    }
    assertSame("branches", expectedBranches, branches);
    // The generator branches from decision 1, the middle and the last decision; make sure none was dropped.
    Set<Integer> points = new LinkedHashSet<>();
    for (int p : new int[] {1, (int) Math.ceil(log.size() / 2.0), log.size()}) if (p >= 1) points.add(p);
    assertThat(list(fin.get("branches"))).hasSize(points.size() * 2);
  }

  private static Stream<DynamicTest> sessions(String key) {
    List<Object> all = list(fixture.get(key));
    List<DynamicTest> tests = new ArrayList<>();
    for (Object o : all) {
      Map<String, Object> scenario = map(o);
      tests.add(DynamicTest.dynamicTest((String) scenario.get("name"), () -> replaySession(scenario)));
    }
    return tests.stream();
  }

  /** Finished sessions: scripted strategies (hold, active, rejections, all-in) and seeded random play. */
  @TestFactory
  Stream<DynamicTest> finishedSessionsReplayExactly() {
    return sessions("scenarios");
  }

  /** Unfinished sessions: the in-session mentor in every mode and the live state of an open mission. */
  @TestFactory
  Stream<DynamicTest> openSessionsReplayExactly() {
    return sessions("openSessions");
  }

  @Test
  void theFixtureCoversEveryCatalogMissionAndEveryRefusalPath() {
    Set<String> covered = new LinkedHashSet<>();
    int refusals = 0;
    int fixtureMissions = 0;
    for (String key : List.of("scenarios", "openSessions")) {
      for (Object o : list(fixture.get(key))) {
        Map<String, Object> s = map(o);
        if (s.get("mission") instanceof String slug) covered.add(slug);
        else fixtureMissions++;
        for (Object step : list(s.get("steps"))) if (map(step).containsKey("error")) refusals++;
      }
    }
    assertThat(covered).containsExactlyElementsOf(MissionCatalog.MISSIONS.stream().map(MissionDefinition::slug).toList());
    assertThat(list(fixture.get("testMissions"))).hasSize(5);
    assertThat(fixtureMissions).isGreaterThan(0);
    assertThat(refusals).isGreaterThan(100);
  }

  // ---------------------------------------------------------------- mastery and recommendations

  private static List<Observation> observations(Object o) {
    return list(o).stream().map(x -> {
      Map<String, Object> ob = map(x);
      return new Observation((String) ob.get("competency"), d(ob.get("score")), d(ob.get("weight")),
          (Boolean) ob.get("assisted"), d(ob.get("at")));
    }).toList();
  }

  @TestFactory
  Stream<DynamicTest> masteryFromObservations() {
    List<Object> cases = list(fixture.get("mastery"));
    List<DynamicTest> tests = new ArrayList<>();
    for (int n = 0; n < cases.size(); n++) {
      Map<String, Object> c = map(cases.get(n));
      tests.add(DynamicTest.dynamicTest("mastery " + n, () -> assertSame("mastery", c.get("result"),
          enc(Mastery.computeMastery(observations(c.get("observations"))).stream()
              .map(Mastery.CompetencyMastery::toJson).toList()))));
    }
    return tests.stream();
  }

  @TestFactory
  Stream<DynamicTest> unlockedLevelsAndRecommendations() {
    List<Object> cases = list(fixture.get("recommendations"));
    List<DynamicTest> tests = new ArrayList<>();
    for (int n = 0; n < cases.size(); n++) {
      Map<String, Object> c = map(cases.get(n));
      tests.add(DynamicTest.dynamicTest("recommendations " + n, () -> {
        Map<String, MissionProgress> progress = new LinkedHashMap<>();
        for (Object o : list(c.get("progress"))) {
          Map<String, Object> p = map(o);
          progress.put((String) p.get("slug"), new MissionProgress((String) p.get("slug"), i(p.get("attempts")),
              (Boolean) p.get("passed"), dOrNull(p.get("bestScore"))));
        }
        String experience = (String) c.get("experience");
        assertThat(Mastery.unlockedLevel(MissionCatalog.MISSIONS, progress, experience)).isEqualTo(c.get("unlocked"));
        var mastery = Mastery.computeMastery(observations(c.get("observations")));
        assertSame("recommendations", c.get("result"), enc(Mastery.recommend(MissionCatalog.MISSIONS, progress,
            mastery, experience, i(c.get("limit"))).stream().map(Mastery.Recommendation::toJson).toList()));
      }));
    }
    return tests.stream();
  }

  // ---------------------------------------------------------------- FinStories

  private static Map<String, Object> storyJson(StoryDefinition s) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("slug", s.slug());
    out.put("version", s.version());
    out.put("title", s.title());
    out.put("character", s.character());
    out.put("summary", s.summary());
    out.put("competency", s.competency());
    out.put("level", s.level());
    out.put("relatedMissionSlug", s.relatedMissionSlug());
    out.put("media", StoryCatalog.media());
    out.put("scenes", s.scenes().stream().map(StoryScene::toJson).toList());
    return out;
  }

  @Test
  void theStoryCatalogMatches() {
    Map<String, Object> stories = map(fixture.get("stories"));
    assertSame("stories", stories.get("stories"), enc(StoryCatalog.STORIES.stream()
        .map(LearningGoldenMasterTest::storyJson).toList()));
  }

  private static StoryDefinition edited(StoryDefinition story, int variant) {
    List<StoryScene> scenes = story.scenes();
    return switch (variant) {
      case 0 -> story;
      case 1 -> {
        List<StoryScene> next = new ArrayList<>(scenes);
        StoryScene first = scenes.get(0);
        next.set(0, new StoryScene(first.id(), first.kind(), first.durationMs() + 2000, first.caption(),
            first.visual()));
        yield story.withVersion(story.version() + 1, next);
      }
      default -> story.withVersion(story.version() + 1, scenes.subList(1, scenes.size()));
    };
  }

  private static StoredProgress storedRow(Object o) {
    if (o == null) return null;
    Map<String, Object> r = map(o);
    return new StoredProgress(i(r.get("storyVersion")), i(r.get("positionMs")), (String) r.get("sceneId"),
        (Boolean) r.get("completed"), r.get("completedAt") == null ? null : Instant.parse((String) r.get("completedAt")),
        r.get("completedVersion") == null ? null : i(r.get("completedVersion")), (String) r.get("reflection"));
  }

  @TestFactory
  Stream<DynamicTest> storyScenesAndWatchProgress() {
    Instant now = Instant.parse((String) map(fixture.get("meta")).get("now"));
    List<Object> cases = list(map(fixture.get("stories")).get("cases"));
    List<DynamicTest> tests = new ArrayList<>();
    for (Object o : cases) {
      Map<String, Object> c = map(o);
      String name = c.get("slug") + " variant " + c.get("variant");
      tests.add(DynamicTest.dynamicTest(name, () -> {
        StoryDefinition base = StoryCatalog.STORIES.stream().filter(s -> s.slug().equals(c.get("slug"))).findFirst()
            .orElseThrow();
        StoryDefinition story = edited(base, i(c.get("variant")));
        assertThat(num(StoryCatalog.storyDuration(story))).isEqualTo(c.get("duration"));
        List<Object> sceneAt = new ArrayList<>();
        for (Object p : list(c.get("sceneAt"))) {
          String position = (String) list(p).get(0);
          sceneAt.add(List.of(position, StoryProgress.sceneIdAt(story, i(position))));
        }
        assertSame("sceneAt", c.get("sceneAt"), sceneAt);
        List<Object> sceneStart = new ArrayList<>();
        for (Object p : list(c.get("sceneStart"))) {
          String id = (String) list(p).get(0);
          Integer start = StoryProgress.sceneStartMs(story, id);
          List<Object> pair = new ArrayList<>();
          pair.add(id);
          pair.add(start == null ? null : num(start));
          sceneStart.add(pair);
        }
        assertSame("sceneStart", c.get("sceneStart"), sceneStart);

        for (Object po : list(c.get("progress"))) {
          Map<String, Object> p = map(po);
          StoredProgress row = storedRow(p.get("row"));
          assertSame("view", p.get("view"), enc(StoryProgress.progressView(story, row).toJson()));
          for (Object no : list(p.get("next"))) {
            Map<String, Object> n = map(no);
            Map<String, Object> u = map(n.get("update"));
            ProgressUpdate update = new ProgressUpdate(i(u.get("positionMs")), (Boolean) u.get("completed"),
                u.containsKey("reflection"), (String) u.get("reflection"));
            StoredProgress next = StoryProgress.nextProgress(story, row, update, now);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("storyVersion", next.storyVersion());
            out.put("positionMs", next.positionMs());
            out.put("sceneId", next.sceneId());
            out.put("completed", next.completed());
            out.put("completedAt", next.completedAt());
            out.put("completedVersion", next.completedVersion());
            out.put("reflection", next.reflection());
            assertSame("next " + json(u), n.get("result"), enc(out));
          }
        }
      }));
    }
    return tests.stream();
  }
}
