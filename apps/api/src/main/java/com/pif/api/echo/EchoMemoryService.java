package com.pif.api.echo;

import static com.pif.api.echo.EchoFinancialTools.map;
import static com.pif.api.echo.EchoFinancialTools.num;

import com.pif.api.echo.EchoRepository.Preferences;
import com.pif.api.security.AuthUser;
import com.pif.api.trading.RiskStudio;
import com.pif.api.web.ApiException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/**
 * Preferences and the decision journal. Nothing is memorised unless {@code memoryEnabled} is true; intentions
 * are typed by the user (never inferred), and every entry can be read, corrected and deleted.
 */
@Service
public class EchoMemoryService {

  static final List<String> INTENTS = List.of("MOYEN_TERME", "REDUCTION_RISQUE", "DIVERSIFICATION",
      "HYPOTHESE_HAUSSE", "PEDAGOGIQUE", "AUTRE");
  static final Map<String, String> INTENT_LABELS = Map.of(
      "MOYEN_TERME", "Investissement à moyen terme",
      "REDUCTION_RISQUE", "Réduction du risque",
      "DIVERSIFICATION", "Diversification",
      "HYPOTHESE_HAUSSE", "Hypothèse de hausse",
      "PEDAGOGIQUE", "Exercice pédagogique",
      "AUTRE", "Autre intention");

  private final EchoRepository repo;
  private final EchoFinancialTools tools;

  public EchoMemoryService(EchoRepository repo, EchoFinancialTools tools) {
    this.repo = repo;
    this.tools = tools;
  }

  void requireTables() {
    if (!repo.tablesPresent()) {
      throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "ECHO_NOT_MIGRATED",
          "ÉCHO n'est pas encore installé sur cette base (migration echo_assistant absente).");
    }
  }

  public Map<String, Object> preferences(AuthUser user) {
    requireTables();
    return repo.preferences(user.id()).toJson();
  }

  public Map<String, Object> savePreferences(AuthUser user, Map<String, Object> body) {
    requireTables();
    Preferences cur = repo.preferences(user.id());
    String level = body.get("helpLevel") instanceof String s ? s.toUpperCase(Locale.ROOT) : cur.helpLevel();
    if (!List.of("DEBUTANT", "INTERMEDIAIRE", "AVANCE").contains(level)) {
      throw ApiException.validation(List.of("helpLevel doit valoir DEBUTANT, INTERMEDIAIRE ou AVANCE."));
    }
    boolean voice = bool(body, "voiceEnabled", cur.voiceEnabled());
    Preferences next = new Preferences(bool(body, "memoryEnabled", cur.memoryEnabled()), voice,
        voice && bool(body, "proactiveVoice", cur.proactiveVoice()), bool(body, "alertsEnabled", cur.alertsEnabled()),
        level);
    repo.savePreferences(user.id(), next);
    return next.toJson();
  }

  private static boolean bool(Map<String, Object> body, String key, boolean fallback) {
    Object v = body.get(key);
    if (v == null) return fallback;
    if (v instanceof Boolean b) return b;
    throw ApiException.validation(List.of(key + " doit être un booléen."));
  }

  // ------------------------------------------------------------------ decisions

  public Map<String, Object> decisions(AuthUser user) {
    requireTables();
    Preferences p = repo.preferences(user.id());
    return map("memoryEnabled", p.memoryEnabled(), "intents", INTENTS.stream()
        .map(i -> map("id", i, "label", INTENT_LABELS.get(i))).toList(), "decisions", repo.decisions(user.id(), 100));
  }

  public Map<String, Object> decision(AuthUser user, UUID id) {
    requireTables();
    return repo.decision(user.id(), id).orElseThrow(EchoMemoryService::notFound);
  }

  static ApiException notFound() {
    return new ApiException(HttpStatus.NOT_FOUND, "ECHO_DECISION_NOT_FOUND", "Décision introuvable.");
  }

  private static String text(Map<String, Object> body, String key, int max) {
    Object v = body.get(key);
    if (v == null) return null;
    if (!(v instanceof String s)) throw ApiException.validation(List.of(key + " doit être un texte."));
    String t = s.strip();
    if (t.length() > max) throw ApiException.validation(List.of(key + " : " + max + " caractères maximum."));
    return t.isEmpty() ? null : t;
  }

  public Map<String, Object> create(AuthUser user, Map<String, Object> body) {
    requireTables();
    if (!repo.preferences(user.id()).memoryEnabled()) {
      throw new ApiException(HttpStatus.FORBIDDEN, "ECHO_MEMORY_DISABLED",
          "La mémoire d'ÉCHO est désactivée. Activez-la dans les paramètres d'ÉCHO pour enregistrer une décision.");
    }
    String intent = text(body, "intent", 24);
    if (intent == null || !INTENTS.contains(intent)) {
      throw ApiException.validation(List.of("intent doit être l'une des valeurs : " + String.join(", ", INTENTS)));
    }
    String intentNote = text(body, "intentNote", 500);
    if ("AUTRE".equals(intent) && intentNote == null) {
      throw ApiException.validation(List.of("Décrivez votre intention (intentNote) lorsque vous choisissez « Autre »."));
    }
    String symbol = text(body, "symbol", 32);
    String side = text(body, "side", 4);
    if (side != null && !List.of("BUY", "SELL").contains(side)) throw ApiException.validation(List.of("side invalide."));
    Double quantity = num(body.get("quantity"));
    UUID portfolioId = null;
    Map<String, Object> snapshot = new LinkedHashMap<>();
    if (body.get("portfolioId") instanceof String pid && !pid.isBlank()) {
      portfolioId = parseUuid(pid);
      // Ownership: the trading service answers 404 for a foreign portfolio.
      snapshot = snapshot(user, portfolioId, symbol);
    }
    UUID id = repo.insertDecision(user.id(), new EchoRepository.NewDecision(portfolioId,
        symbol == null ? null : symbol.toUpperCase(Locale.ROOT), side, quantity, intent, intentNote,
        text(body, "hypothesis", 500), snapshot));
    return decision(user, id);
  }

  static UUID parseUuid(String raw) {
    try {
      return UUID.fromString(raw);
    } catch (IllegalArgumentException e) {
      throw ApiException.validation(List.of("Identifiant invalide."));
    }
  }

  /** Measurable state at decision time, reused later for the intention-vs-outcome review. */
  Map<String, Object> snapshot(AuthUser user, UUID portfolioId, String symbol) {
    Map<String, Object> pf = tools.portfolio(user, portfolioId);
    Map<String, Object> s = new LinkedHashMap<>();
    s.put("asOf", pf.get("asOf"));
    s.put("portfolioName", pf.get("name"));
    s.put("equity", num(pf.get("equity")));
    s.put("cash", num(pf.get("cash")));
    s.putAll(concentration(pf));
    if (symbol != null) {
      for (Map<String, Object> p : EchoScenarioService.positions(pf)) {
        if (symbol.equalsIgnoreCase(String.valueOf(p.get("symbol")))) {
          s.put("symbolWeight", num(p.get("weight")));
          s.put("symbolQuantity", num(p.get("quantity")));
        }
      }
      tools.instrument(symbol).ifPresent(i -> {
        s.put("symbolPrice", num(EchoFinancialTools.at(i, "quote", "mid")));
        s.put("symbolSector", i.get("sector"));
      });
    }
    return s;
  }

  /** Concentration via the platform's {@link RiskStudio#snapshot} (same numbers as Risk Studio). */
  static Map<String, Object> concentration(Map<String, Object> pf) {
    Map<String, Double> values = new LinkedHashMap<>();
    Map<String, Double> bySector = new LinkedHashMap<>();
    for (Map<String, Object> p : EchoScenarioService.positions(pf)) {
      double v = num(p.get("marketValue"));
      values.put(String.valueOf(p.get("symbol")), v);
      bySector.merge(String.valueOf(p.get("sector")), v, Double::sum);
    }
    Double cap = num(pf.get("maxPositionWeightPct"));
    Map<String, Object> rs = RiskStudio.snapshot(num(pf.get("cash")), values, cap);
    Double equity = num(pf.get("equity"));
    double topSector = 0;
    for (double v : bySector.values()) topSector = Math.max(topSector, equity != null && equity > 0 ? v / equity : 0);
    return map("largestWeight", num(rs.get("largestWeight")), "hhi", num(rs.get("hhi")),
        "effectiveHoldings", num(rs.get("effectiveHoldings")), "positions", values.size(),
        "largestSectorWeight", topSector);
  }

  public Map<String, Object> update(AuthUser user, UUID id, Map<String, Object> body) {
    requireTables();
    String intent = text(body, "intent", 24);
    if (intent != null && !INTENTS.contains(intent)) throw ApiException.validation(List.of("intent invalide."));
    if (!repo.updateDecision(user.id(), id, intent, text(body, "intentNote", 500), text(body, "hypothesis", 500),
        text(body, "observation", 1000))) {
      throw notFound();
    }
    return decision(user, id);
  }

  public void delete(AuthUser user, UUID id) {
    requireTables();
    if (!repo.deleteDecision(user.id(), id)) throw notFound();
  }

  public Map<String, Object> deleteAll(AuthUser user) {
    requireTables();
    return map("deleted", repo.deleteAllDecisions(user.id()));
  }

  /**
   * Confronts the stated intention with what can be measured now. Conclusions are phrased as observations on
   * documented metrics; no emotion or psychological trait is attributed to the user.
   */
  public Map<String, Object> review(AuthUser user, UUID id) {
    Map<String, Object> d = decision(user, id);
    EchoAnswer a = reviewAnswer(user, d);
    Map<String, Object> out = a.toJson();
    repo.saveReview(user.id(), id, map("at", com.pif.api.data.Db.iso(com.pif.api.data.Db.now()), "answer", out));
    return map("decision", decision(user, id), "review", out);
  }

  @SuppressWarnings("unchecked")
  EchoAnswer reviewAnswer(AuthUser user, Map<String, Object> d) {
    EchoAnswer a = new EchoAnswer("DECISION_REVIEW");
    String intent = String.valueOf(d.get("intent"));
    Map<String, Object> before = (Map<String, Object>) d.getOrDefault("snapshot", Map.of());
    a.evidence(EchoAnswer.Kind.OBSERVED, "Intention déclarée", INTENT_LABELS.get(intent)
        + (d.get("intentNote") == null ? "" : " — " + d.get("intentNote")), null, "Journal ÉCHO (saisie utilisateur)");
    if (d.get("portfolioId") == null || before.isEmpty()) {
      a.status("PARTIAL").text("Cette décision n'est rattachée à aucun portefeuille mesurable : je peux rappeler votre "
          + "intention, mais pas la confronter à des chiffres.");
      return a;
    }
    Map<String, Object> pf;
    try {
      pf = tools.portfolio(user, UUID.fromString(String.valueOf(d.get("portfolioId"))));
    } catch (ApiException e) {
      return a.status("NO_DATA").text("Le portefeuille de cette décision n'existe plus : la comparaison est impossible.");
    }
    a.tool("portfolio.get");
    a.asOf(String.valueOf(pf.get("asOf")));
    Map<String, Object> now = concentration(pf);
    String symbol = (String) d.get("symbol");
    Double priceThen = num(before.get("symbolPrice"));
    Double priceNow = symbol == null ? null
        : tools.instrument(symbol).map(i -> num(EchoFinancialTools.at(i, "quote", "mid"))).orElse(null);
    Double effThen = num(before.get("effectiveHoldings"));
    Double effNow = num(now.get("effectiveHoldings"));
    Double wThen = num(before.get("largestWeight"));
    Double wNow = num(now.get("largestWeight"));
    Double secThen = num(before.get("largestSectorWeight"));
    Double secNow = num(now.get("largestSectorWeight"));
    a.evidence(EchoAnswer.Kind.CALCULATED, "Positions effectives (décision → aujourd'hui)",
        map("before", effThen, "after", effNow), null, "RiskStudio.snapshot");
    a.evidence(EchoAnswer.Kind.CALCULATED, "Plus grande ligne (décision → aujourd'hui)",
        map("before", wThen, "after", wNow), "ratio", "RiskStudio.snapshot");
    a.evidence(EchoAnswer.Kind.CALCULATED, "Plus grand secteur (décision → aujourd'hui)",
        map("before", secThen, "after", secNow), "ratio", "Somme des valeurs par secteur / capitaux");
    if (priceThen != null && priceNow != null) {
      a.evidence(EchoAnswer.Kind.OBSERVED, "Prix " + symbol + " (décision → aujourd'hui)",
          map("before", priceThen, "after", priceNow), null, "Cotation du moteur de marché");
    }
    List<String> lines = new ArrayList<>();
    lines.add("Le " + EchoFormat.day(String.valueOf(d.get("createdAt"))) + ", vous avez indiqué : « "
        + INTENT_LABELS.get(intent).toLowerCase(Locale.FRENCH) + " »" + (symbol == null ? "" : " sur " + symbol) + ".");
    switch (intent) {
      case "DIVERSIFICATION" -> {
        if (effThen != null && effNow != null && effNow > effThen + 0.2) {
          lines.add("Les mesures confirment une diversification : positions effectives " + EchoFormat.num(effThen, 1)
              + " → " + EchoFormat.num(effNow, 1) + ".");
        } else {
          lines.add("Les mesures ne montrent pas la diversification visée : positions effectives "
              + EchoFormat.num(effThen, 1) + " → " + EchoFormat.num(effNow, 1) + ".");
          if (secThen != null && secNow != null && secNow > secThen + 0.02) {
            lines.add("Le poids du secteur le plus représenté a même augmenté (" + EchoFormat.pct(secThen) + " → "
                + EchoFormat.pct(secNow) + ").");
          }
        }
      }
      case "REDUCTION_RISQUE" -> lines.add(wThen != null && wNow != null && wNow < wThen
          ? "La concentration a baissé (" + EchoFormat.pct(wThen) + " → " + EchoFormat.pct(wNow) + "), ce qui va dans le sens visé."
          : "La plus grande ligne n'a pas diminué (" + EchoFormat.pct(wThen) + " → " + EchoFormat.pct(wNow)
              + ") : la réduction de risque visée n'apparaît pas sur cette mesure.");
      case "HYPOTHESE_HAUSSE", "MOYEN_TERME" -> {
        if (priceThen != null && priceNow != null && priceThen > 0) {
          double ch = priceNow / priceThen - 1;
          lines.add(symbol + " a évolué de " + EchoFormat.signedPct(ch) + " depuis la décision. "
              + ("MOYEN_TERME".equals(intent) ? "Sur un objectif à moyen terme, une observation ponctuelle reste peu "
                  + "informative." : "Une seule observation ne valide ni n'invalide une hypothèse."));
        } else {
          a.status("PARTIAL");
          lines.add("Je n'ai pas de prix comparable pour mesurer l'évolution de " + symbol + ".");
        }
      }
      default -> lines.add("Voici les mesures de concentration à la date de la décision et aujourd'hui.");
    }
    a.limitation("Le portefeuille a pu évoluer pour d'autres raisons que cette décision (autres ordres, prix).");
    a.limitation("Une évolution de prix ne prouve pas qu'une décision était bonne ou mauvaise.");
    return a.text(String.join(" ", lines));
  }
}
