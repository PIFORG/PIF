package com.pif.api.learning.stories;

import com.pif.api.finance.JsSemantics;
import com.pif.api.web.JsNumbers;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * FinStories (apps/api/src/learning/stories/catalog.ts). Scenes are rendered by the web player as motion graphics;
 * every number shown is computed below from the stated assumptions, so the story and its arithmetic stay consistent.
 */
public final class StoryCatalog {

  private StoryCatalog() {}

  /** {@code visual} keeps the TypeScript property order of the scene's visual object. */
  public record StoryScene(String id, String kind, int durationMs, String caption, Map<String, Object> visual) {
    public Map<String, Object> toJson() {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("id", id);
      out.put("kind", kind);
      out.put("durationMs", durationMs);
      out.put("caption", caption);
      out.put("visual", visual);
      return out;
    }
  }

  public record StoryDefinition(String slug, int version, String title, String character, String summary,
      String competency, String level, String relatedMissionSlug, List<StoryScene> scenes) {

    public StoryDefinition withVersion(int newVersion, List<StoryScene> newScenes) {
      return new StoryDefinition(slug, newVersion, title, character, summary, competency, level, relatedMissionSlug,
          newScenes);
    }
  }

  /** Media metadata only. No generated video exists, so the player renders the scenes itself. */
  public static Map<String, Object> media() {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("videoUrl", null);
    out.put("posterUrl", null);
    out.put("format", "MOTION_GRAPHICS");
    return out;
  }

  private static double round(double v) {
    return JsSemantics.round(v * 100) / 100;
  }

  private static String fmt(double v) {
    return JsNumbers.toLocaleEnUs(v, 0, 2);
  }

  private static String locale(double v) {
    return JsNumbers.toLocaleEnUs(v);
  }

  private static final String ASK = "What would YOU do? A or B? Choose in your head.";

  private static final double SARAH_START = 10_000;
  private static final double SARAH_DECISION = round(SARAH_START * 0.85);
  private static final double SARAH_SOLD = round(SARAH_DECISION * (1 - 0.005));
  private static final double SARAH_TROUGH = round(SARAH_DECISION * 0.88);
  private static final double SARAH_RECOVERED = round(SARAH_TROUGH * 1.25);
  private static final double SARAH_GAP_AT_TROUGH = round(SARAH_SOLD - SARAH_TROUGH);
  private static final double SARAH_DRAWDOWN_PCT = JsSemantics.round((1 - SARAH_TROUGH / SARAH_START) * 1000) / 10;

  private static final double ADAM_MARKET = round(100 * 9.88 * 1.0025);
  private static final double ADAM_LIMIT = round(100 * 9.85 * 1.0025);

  /** Portfolio value after applying per-sleeve moves (value, move pairs). */
  private static double after(double... sleeves) {
    double sum = 0;
    for (int i = 0; i < sleeves.length; i += 2) sum = sum + sleeves[i] * (1 + sleeves[i + 1]);
    return round(sum);
  }

  private static final double YOUSSEF_A = after(20_000, -0.07);
  private static final double YOUSSEF_B = after(4_000, -0.07, 16_000, 0);

  private static final double GAP_STOP = round(500 * 24.9);
  private static final double GAP_HOLD = round(500 * 23.5);

  private static Map<String, Object> visual(Object... keyValues) {
    Map<String, Object> out = new LinkedHashMap<>();
    for (int i = 0; i < keyValues.length; i += 2) out.put((String) keyValues[i], keyValues[i + 1]);
    return out;
  }

  private static Map<String, Object> slice(String label, double pct) {
    return visual("label", label, "pct", pct);
  }

  private static StoryScene scene(String id, String kind, int durationMs, String caption, Map<String, Object> visual) {
    return new StoryScene(id, kind, durationMs, caption, visual);
  }

  public static final List<StoryDefinition> STORIES = List.of(
      new StoryDefinition("sarah-and-the-market-crash", 2, "Sarah and the Market Crash", "SARAH",
          "Sarah invested 10,000 DT. The market drops 15 % in a week. Sell to stop the bleeding, or hold and wait?",
          "RISK_MANAGEMENT", "COMMANDER", "survive-the-market-crash", List.of(
              scene("s1", "SETUP", 6000, "Meet Sarah. She invested " + fmt(SARAH_START) + " dinars in a diversified "
                  + "stock fund, saving for a flat she plans to buy in five years.",
                  visual("type", "intro", "character", "SARAH", "amount", SARAH_START)),
              scene("s2", "SETUP", 6000, "Then the market drops 15 % in a single week. Her " + fmt(SARAH_START)
                  + " dinars are now worth " + fmt(SARAH_DECISION) + ".",
                  visual("type", "chart", "series", List.of(10_000, 9_880, 9_610, 9_240, 8_870, SARAH_DECISION), "tone",
                      "down", "label", "Value of her fund (DT)")),
              scene("s3", "DECISION", 7000, "A: sell now and stop the bleeding. B: hold and wait for a recovery. " + ASK,
                  visual("type", "headline", "text", "Markets slide for a fifth straight day", "sentiment", "NEGATIVE")),
              scene("s4", "PATH_A", 7000, "If you chose A: Sarah sells. After 0.5 % in costs she keeps "
                  + fmt(SARAH_SOLD) + " dinars in cash. The next month the fund falls another 12 %, and none of that "
                  + "touches her.",
                  visual("type", "outcome", "from", SARAH_DECISION, "to", SARAH_SOLD, "label", "Sold: cash after costs")),
              scene("s5", "PATH_A", 7000, "But six months later the fund has rebounded to " + fmt(SARAH_RECOVERED)
                  + " for the same investment, while her cash is still " + fmt(SARAH_SOLD) + ". She limited the damage "
                  + "and missed the recovery.",
                  visual("type", "chart", "series", List.of(SARAH_DECISION, 8_100, SARAH_TROUGH, 7_950, 8_700,
                      SARAH_RECOVERED), "tone", "up", "label", "The fund she sold (DT)")),
              scene("s6", "REWIND", 3000, "Let's rewind — back to the day of the decision.", visual("type", "rewind")),
              scene("s7", "PATH_B", 7000, "If you chose B: Sarah holds. First the fund falls another 12 %: her savings "
                  + "touch " + fmt(SARAH_TROUGH) + " dinars, " + JsNumbers.toJsString(SARAH_DRAWDOWN_PCT)
                  + " % below where she started. Holding hurts.",
                  visual("type", "chart", "series", List.of(SARAH_DECISION, 8_100, SARAH_TROUGH), "tone", "down",
                      "label", "Value of her fund (DT)")),
              scene("s8", "PATH_B", 8000, "Six months later it recovers to " + fmt(SARAH_RECOVERED) + ". Holding paid off "
                  + "here — because she could wait. Had she needed the money at the bottom, selling would have left her "
                  + fmt(SARAH_GAP_AT_TROUGH) + " dinars better off.",
                  visual("type", "outcome", "from", SARAH_TROUGH, "to", SARAH_RECOVERED, "label",
                      "Held through the trough")),
              scene("s9", "LESSON", 8000, "A decision cannot be judged only by its profit. Risk tolerance, time horizon, "
                  + "the information you had and your objective all matter.",
                  visual("type", "lesson", "points", List.of("Selling capped the worst case; holding kept the recovery.",
                      "Holding only works if you can afford the drawdown and the wait.",
                      "Decide your plan before the crash, not during it."))))),
      new StoryDefinition("adam-first-order", 2, "Adam's First Order", "ADAM",
          "Adam wants 100 shares of Olivia Foods. Market order or limit order?", "TRADING_EXECUTION", "ROOKIE",
          "my-first-trade", List.of(
              scene("a1", "SETUP", 5000, "Adam opens his first account with 1,000 dinars. He wants 100 shares of Olivia "
                  + "Foods.", visual("type", "intro", "character", "ADAM", "amount", 1_000)),
              scene("a2", "DECISION", 6000, "The quote shows a bid of 9.820 and an ask of 9.880. A: buy now at the "
                  + "market. B: set a limit at 9.850. " + ASK,
                  visual("type", "chart", "series", List.of(9.79, 9.82, 9.8, 9.84, 9.86, 9.85), "tone", "flat", "label",
                      "Olivia Foods price (DT)")),
              scene("a3", "PATH_A", 6000, "If Adam sends a market order, he buys instantly at the ask. With a 0.25 % "
                  + "commission he pays " + locale(ADAM_MARKET) + " dinars.",
                  visual("type", "outcome", "from", 988, "to", ADAM_MARKET, "label",
                      "Shares at the ask, then with commission")),
              scene("a4", "REWIND", 3000, "Let's rewind.", visual("type", "rewind")),
              scene("a5", "PATH_B", 7000, "If he sets a limit at 9.850, he waits. The price dips the next day and his "
                  + "order fills: " + locale(ADAM_LIMIT) + " dinars. Cheaper — but on another day it might never have "
                  + "filled.",
                  visual("type", "outcome", "from", 985, "to", ADAM_LIMIT, "label",
                      "Shares at the limit, then with commission")),
              scene("a6", "LESSON", 6000, "A market order buys certainty of execution. A limit order buys certainty of "
                  + "price. Know which one you need.",
                  visual("type", "lesson", "points", List.of("Market buys pay the ask.", "Limits can miss the move.",
                      "Always count the commission."))))),
      new StoryDefinition("youssef-all-in", 2, "Youssef Goes All In", "YOUSSEF",
          "A hot tip, 20,000 DT and one stock. What happens when a single company stumbles?", "DIVERSIFICATION",
          "ROOKIE", "diversification-challenge", List.of(
              scene("y1", "SETUP", 5000, "Youssef hears from a friend that TunisTech is about to take off. He has "
                  + "20,000 dinars.", visual("type", "intro", "character", "YOUSSEF", "amount", 20_000)),
              scene("y2", "DECISION", 5000, "A: put everything in TunisTech. B: spread it across five sectors. " + ASK,
                  visual("type", "allocation", "slices", List.of(slice("TunisTech", 100)))),
              scene("y3", "PATH_A", 7000, "If he goes all in: a data-centre outage hits TunisTech, which drops 7 % in a "
                  + "day. His 20,000 dinars become " + locale(YOUSSEF_A) + ".",
                  visual("type", "outcome", "from", 20_000, "to", YOUSSEF_A, "label", "All in one stock")),
              scene("y4", "REWIND", 3000, "Let's rewind.", visual("type", "rewind")),
              scene("y5", "PATH_B", 7000, "If he splits it 20 % per sector, the outage only touches one slice. Other "
                  + "sectors don't move that day, and he ends with " + locale(YOUSSEF_B) + " dinars.",
                  visual("type", "outcome", "from", 20_000, "to", YOUSSEF_B, "label", "Spread across five sectors")),
              scene("y6", "LESSON", 6000, "Had the tip been right and TunisTech jumped 10 %, going all in would have "
                  + "earned " + fmt(20_000 * 0.1) + " dinars instead of " + fmt(4_000 * 0.1) + ". Concentration "
                  + "magnifies both outcomes; diversification trades some upside for resilience.",
                  visual("type", "lesson", "points", List.of("Company-specific risk can be diversified away.",
                      "Concentration magnifies gains and losses alike.", "A tip is not a plan."))))),
      new StoryDefinition("youssef-and-the-gap", 2, "Youssef and the Gap", "YOUSSEF",
          "Youssef holds 500 TunisTech shares before results day. Place a stop at 26 DT, or trust the stock?",
          "RISK_MANAGEMENT", "ROOKIE", "protect-your-capital", List.of(
              scene("g1", "SETUP", 5000, "Youssef owns 500 TunisTech shares at 27.40 — 13,700 dinars. The company "
                  + "reports results tomorrow morning.", visual("type", "intro", "character", "YOUSSEF", "amount", 13_700)),
              scene("g2", "DECISION", 7000, "A: no stop — he trusts the stock and can watch it closely. B: a protective "
                  + "stop at 26.00. " + ASK,
                  visual("type", "headline", "text", "TunisTech reports results tomorrow", "sentiment", "NEUTRAL")),
              scene("g3", "PATH_A", 7000, "If you chose A: TunisTech issues a profit warning and opens at 24.90. "
                  + "Youssef hopes for a rebound; instead it slides to 23.50 over three days. His position is worth "
                  + locale(GAP_HOLD) + " dinars. Had the results been good, he would have kept every share.",
                  visual("type", "outcome", "from", 13_700, "to", GAP_HOLD, "label", "No stop, waiting for a rebound")),
              scene("g4", "REWIND", 3000, "Let's rewind.", visual("type", "rewind")),
              scene("g5", "PATH_B", 7000, "If you chose B: the same warning hits. The stop sells at the open — at 24.90, "
                  + "not 26.00, because the price gapped past his level. He keeps " + locale(GAP_STOP) + " dinars, but "
                  + "if the stock had bounced back he would be out of it.",
                  visual("type", "outcome", "from", 13_700, "to", GAP_STOP, "label",
                      "Stop executed at the gapped price")),
              scene("g6", "LESSON", 6000, "A stop limits how long you stay wrong, not the exact price you exit at. Gaps "
                  + "happen — size positions for them.",
                  visual("type", "lesson", "points", List.of("Stops trigger at the stop and fill at the next bid.",
                      "Overnight gaps skip levels.", "Position size is your real protection."))))));

  /**
   * The computed amounts each caption quotes, in the order of its {@code {n}} placeholders in the French overlay
   * (learning_fr.properties). The English captions above embed the same constants, so both languages always show
   * the same arithmetic. Scenes without a computed amount have no entry.
   */
  private static final Map<String, List<Double>> CAPTION_VALUES = Map.ofEntries(
      Map.entry("sarah-and-the-market-crash.s1", List.of(SARAH_START)),
      Map.entry("sarah-and-the-market-crash.s2", List.of(SARAH_START, SARAH_DECISION)),
      Map.entry("sarah-and-the-market-crash.s4", List.of(SARAH_SOLD)),
      Map.entry("sarah-and-the-market-crash.s5", List.of(SARAH_RECOVERED, SARAH_SOLD)),
      Map.entry("sarah-and-the-market-crash.s7", List.of(SARAH_TROUGH, SARAH_DRAWDOWN_PCT)),
      Map.entry("sarah-and-the-market-crash.s8", List.of(SARAH_RECOVERED, SARAH_GAP_AT_TROUGH)),
      Map.entry("adam-first-order.a3", List.of(ADAM_MARKET)),
      Map.entry("adam-first-order.a5", List.of(ADAM_LIMIT)),
      Map.entry("youssef-all-in.y3", List.of(YOUSSEF_A)),
      Map.entry("youssef-all-in.y5", List.of(YOUSSEF_B)),
      Map.entry("youssef-all-in.y6", List.of(20_000 * 0.1, 4_000 * 0.1)),
      Map.entry("youssef-and-the-gap.g3", List.of(GAP_HOLD)),
      Map.entry("youssef-and-the-gap.g5", List.of(GAP_STOP)));

  /** Computed amounts quoted by a scene's caption, in placeholder order; empty when the caption quotes none. */
  public static List<Double> captionValues(String storySlug, String sceneId) {
    return CAPTION_VALUES.getOrDefault(storySlug + "." + sceneId, List.of());
  }

  public static StoryDefinition find(String slug) {
    for (StoryDefinition s : STORIES) {
      if (s.slug().equals(slug)) return s;
    }
    return null;
  }

  public static int storyDuration(StoryDefinition story) {
    int sum = 0;
    for (StoryScene scene : story.scenes()) sum += scene.durationMs();
    return sum;
  }
}
