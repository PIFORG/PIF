package com.pif.api.echo;

import static com.pif.api.echo.EchoFinancialTools.map;
import static com.pif.api.echo.EchoFinancialTools.num;
import static com.pif.api.echo.EchoRiskAdvisor.castMap;

import com.pif.api.echo.EchoAnswer.Kind;
import com.pif.api.finance.Risk;
import com.pif.api.security.AuthUser;
import com.pif.api.trading.TradingDtos;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * "Et si… ?" — counterfactuals built only from data the platform holds. Three kinds, always labelled:
 * SIMULATION (hypothetical shock), REPLAY_AT_CURRENT_MARK (undo a recorded trade, valued at today's mark) and
 * TIME_MACHINE (MarketQuest replay through the deterministic mission engine). None is a prediction.
 */
@Component
public class EchoScenarioService {

  private final EchoFinancialTools tools;

  public EchoScenarioService(EchoFinancialTools tools) {
    this.tools = tools;
  }

  @SuppressWarnings("unchecked")
  static List<Map<String, Object>> positions(Map<String, Object> portfolio) {
    Object p = portfolio.get("positions");
    return p instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
  }

  /** Uniform market shock on every position; cash is unaffected. Uses {@link Risk#stressImpact}. */
  EchoAnswer shock(AuthUser user, UUID portfolioId, double pct, boolean up) {
    EchoAnswer a = new EchoAnswer("STRESS_SCENARIO");
    Map<String, Object> pf = tools.portfolio(user, portfolioId);
    a.tool("portfolio.get");
    String ccy = String.valueOf(pf.get("baseCurrency"));
    a.asOf(String.valueOf(pf.get("asOf")));
    List<Map<String, Object>> pos = positions(pf);
    if (pos.isEmpty()) {
      a.status("NO_DATA").text("Le portefeuille « " + pf.get("name") + " » ne détient aucune position : un choc de marché "
          + "n'affecterait que la valeur des titres, et il n'y en a pas.");
      return a.navigate("Ouvrir le Trading", "/trading");
    }
    double shock = (up ? 1 : -1) * Math.min(pct, 95) / 100.0;
    // Risk.stressImpact works in millimes (it rounds each line to an integer amount): convert both ways.
    Map<String, Double> values = new LinkedHashMap<>();
    for (Map<String, Object> p : pos) values.put(String.valueOf(p.get("symbol")), num(p.get("marketValue")) * 1000);
    Risk.StressResult raw = Risk.stressImpact(values, s -> shock);
    List<Risk.StressLine> lines = raw.breakdown().stream()
        .map(l -> new Risk.StressLine(l.symbol(), l.value() / 1000, l.shockPct(), l.impact() / 1000)).toList();
    Risk.StressResult r = new Risk.StressResult(raw.impact() / 1000, lines);
    Double equity = num(pf.get("equity"));
    double after = equity + r.impact();
    a.evidence(Kind.ASSUMPTION, "Choc appliqué à toutes les positions", shock, "ratio", "Hypothèse de la question");
    a.evidence(Kind.ASSUMPTION, "Liquidités", "inchangées", null, "Hypothèse");
    a.evidence(Kind.OBSERVED, "Valeur du portefeuille", equity, ccy, "Portefeuilles (valorisation au milieu)");
    a.evidence(Kind.SIMULATION, "Impact simulé", r.impact(), ccy, "Risk.stressImpact");
    a.evidence(Kind.SIMULATION, "Valeur après choc", after, ccy, "Risk.stressImpact");
    List<Map<String, Object>> rows = new ArrayList<>();
    for (Risk.StressLine l : r.breakdown()) {
      rows.add(map("label", l.symbol(), "value", l.value(), "impact", l.impact()));
    }
    a.scenario(map("kind", "SIMULATION", "hypothetical", true, "label",
        "Choc uniforme de " + EchoFormat.signedPct(shock), "rows", rows,
        "assumptions", List.of("Toutes les positions varient du même pourcentage.", "Les liquidités ne bougent pas.",
            "Pas d'effet de liquidité, de frais ni de corrélation.")));
    double rel = equity > 0 ? r.impact() / equity : 0;
    a.text("Avec une " + (up ? "hausse" : "baisse") + " simulée de " + EchoFormat.num(Math.min(pct, 95), 1)
        + " % sur toutes les positions, la valeur du portefeuille passerait de " + EchoFormat.money(equity, ccy)
        + " à " + EchoFormat.money(after, ccy) + " (" + EchoFormat.signedPct(rel) + "). "
        + "L'impact est plus faible que le choc parce que les liquidités (" + EchoFormat.money(num(pf.get("cash")), ccy)
        + ") ne sont pas exposées.");
    a.limitation("Scénario hypothétique uniforme : les actifs réels ne baissent pas tous du même pourcentage.");
    a.ask("Scénario de crise historique", "Que s'est-il passé pendant la crise de 2020 ?");
    a.navigate("Scénarios prédéfinis dans Risques", "/risk");
    return a;
  }

  /** Sell a fraction of one held position, evaluated by the existing pre-trade engine (no order placed). */
  EchoAnswer sellFraction(AuthUser user, UUID portfolioId, String symbol, double fraction, Map<String, Object> state) {
    EchoAnswer a = new EchoAnswer("WHATIF_SELL");
    Map<String, Object> pf = tools.portfolio(user, portfolioId);
    a.tool("portfolio.get");
    Map<String, Object> position = positions(pf).stream()
        .filter(p -> symbol.equals(p.get("symbol"))).findFirst().orElse(null);
    if (position == null) {
      return a.status("NO_DATA").text("Le portefeuille « " + pf.get("name") + " » ne détient pas " + symbol
          + " : il n'y a rien à vendre sur cette ligne.");
    }
    double held = num(position.get("quantity"));
    double qty = Math.floor(held * fraction);
    if (qty < 1) {
      return a.status("NO_DATA").text("La fraction demandée représente moins d'une unité de " + symbol + " (détenu : "
          + EchoFormat.num(held, 0) + ").");
    }
    Map<String, Object> risk = tools.preTradeRisk(user, portfolioId,
        new TradingDtos.OrderTerms(symbol, "SELL", "MARKET", qty, null, null));
    a.tool("portfolio.preTradeRisk");
    String ccy = String.valueOf(risk.getOrDefault("currency", "TND"));
    a.asOf(String.valueOf(risk.get("asOf")));
    Map<String, Object> cur = castMap(risk.get("current"));
    Map<String, Object> prop = castMap(risk.get("proposed"));
    Map<String, Object> eval = castMap(risk.get("evaluation"));
    if (prop.isEmpty()) {
      return a.status("PARTIAL").text("Le moteur refuserait cette vente : "
          + castMap(eval.get("rejection")).getOrDefault("message", "motif non précisé") + ".");
    }
    Double proceeds = num(EchoFinancialTools.at(eval, "estimate", "notional"));
    Double fee = num(EchoFinancialTools.at(eval, "estimate", "fee"));
    a.evidence(Kind.OBSERVED, "Quantité détenue " + symbol, held, null, "Portefeuilles");
    a.evidence(Kind.ASSUMPTION, "Quantité vendue", qty, null, "Question (" + EchoFormat.pct(fraction) + ")");
    a.evidence(Kind.CALCULATED, "Produit brut estimé", proceeds, ccy, "Moteur d'ordres (prix acheteur)");
    a.evidence(Kind.CALCULATED, "Frais estimés", fee, ccy, "Barème");
    a.evidence(Kind.CALCULATED, "Plus grande ligne (avant → après)",
        map("before", cur.get("largestWeight"), "after", prop.get("largestWeight")), "ratio", "RiskStudio.snapshot");
    Map<String, Object> scenario = map("kind", "SIMULATION", "hypothetical", true,
        "label", "Vente de " + EchoFormat.num(qty, 0) + " " + symbol,
        "rows", List.of(map("label", "Avant", "cash", cur.get("cash"), "equity", cur.get("equity"), "largestWeight",
                cur.get("largestWeight"), "effectiveHoldings", cur.get("effectiveHoldings")),
            map("label", "Après la vente", "cash", prop.get("cash"), "equity", prop.get("equity"), "largestWeight",
                prop.get("largestWeight"), "effectiveHoldings", prop.get("effectiveHoldings"))));
    a.scenario(scenario);
    state.put("lastScenario", map("kind", "SELL_FRACTION", "portfolioId", portfolioId.toString(), "symbol", symbol,
        "quantity", qty, "before", cur, "after", prop));
    a.text("Vendre " + EchoFormat.num(qty, 0) + " " + symbol + " sur " + EchoFormat.num(held, 0)
        + " rapporterait environ " + EchoFormat.money(proceeds, ccy) + " avant frais (" + EchoFormat.money(fee, ccy)
        + "). La plus grande ligne passerait de " + EchoFormat.pct(num(cur.get("largestWeight"))) + " à "
        + EchoFormat.pct(num(prop.get("largestWeight"))) + ", et les liquidités de "
        + EchoFormat.money(num(cur.get("cash")), ccy) + " à " + EchoFormat.money(num(prop.get("cash")), ccy) + ".");
    a.limitation("Simulation d'exécution immédiate au prix acheteur actuel : aucun ordre n'a été envoyé.");
    a.ask("Comparer le risque avant et après", "Compare le risque avant et après.");
    return a;
  }

  /** Replays the stored before/after of the last scenario of this conversation. */
  EchoAnswer beforeAfter(Map<String, Object> state) {
    EchoAnswer a = new EchoAnswer("COMPARE_BEFORE_AFTER");
    Map<String, Object> last = castMap(state.get("lastScenario"));
    if (last.isEmpty()) {
      return a.status("CLARIFICATION").text("Je n'ai pas encore de scénario dans cette conversation. "
          + "Demandez par exemple « Et si je vendais la moitié de cette position ? ».");
    }
    Map<String, Object> b = castMap(last.get("before"));
    Map<String, Object> f = castMap(last.get("after"));
    for (String k : List.of("largestWeight", "effectiveHoldings", "hhi", "cash", "exposure")) {
      a.evidence(Kind.CALCULATED, label(k), map("before", b.get(k), "after", f.get(k)), k.equals("cash") ? "TND" : null,
          "Même scénario : " + last.get("kind"));
    }
    a.scenario(map("kind", "SIMULATION", "hypothetical", true, "label", "Avant / après — " + last.get("symbol"),
        "rows", List.of(map("label", "Avant", "largestWeight", b.get("largestWeight"), "effectiveHoldings",
                b.get("effectiveHoldings"), "cash", b.get("cash"), "equity", b.get("equity")),
            map("label", "Après", "largestWeight", f.get("largestWeight"), "effectiveHoldings",
                f.get("effectiveHoldings"), "cash", f.get("cash"), "equity", f.get("equity")))));
    Double w0 = num(b.get("largestWeight"));
    Double w1 = num(f.get("largestWeight"));
    Double e0 = num(b.get("effectiveHoldings"));
    Double e1 = num(f.get("effectiveHoldings"));
    a.text("Sur le même scénario (" + last.get("symbol") + ", " + EchoFormat.num(num(last.get("quantity")), 0)
        + " unités) : la concentration de la plus grande ligne passe de " + EchoFormat.pct(w0) + " à "
        + EchoFormat.pct(w1) + " et le nombre de positions effectives de " + EchoFormat.num(e0, 1) + " à "
        + EchoFormat.num(e1, 1) + ". "
        + (w1 != null && w0 != null && w1 < w0 ? "Le risque de concentration diminue." : "Le risque de concentration ne diminue pas."));
    a.limitation("Comparaison de concentration ; la VaR historique n'est pas recalculée pour une position hypothétique.");
    return a;
  }

  private static String label(String k) {
    return switch (k) {
      case "largestWeight" -> "Plus grande ligne";
      case "effectiveHoldings" -> "Positions effectives";
      case "hhi" -> "HHI";
      case "cash" -> "Liquidités";
      default -> "Exposition";
    };
  }

  /** "Et si je n'avais pas passé mon dernier ordre ?" — replay at the current mark of the recorded execution. */
  EchoAnswer undoLastExecution(AuthUser user, UUID portfolioId) {
    EchoAnswer a = new EchoAnswer("ALTERNATIVE");
    List<Map<String, Object>> exec = tools.executions(user, portfolioId, 1);
    a.tool("portfolio.executions");
    if (exec.isEmpty()) {
      return a.status("NO_DATA").text("Aucune exécution n'est enregistrée sur ce portefeuille : il n'y a pas de "
          + "décision passée à rejouer.");
    }
    Map<String, Object> e = exec.getFirst();
    String symbol = String.valueOf(e.get("symbol"));
    var inst = tools.instrument(symbol);
    a.tool("market.instrument");
    Double mid = inst.map(i -> num(EchoFinancialTools.at(i, "quote", "mid"))).orElse(null);
    if (mid == null) {
      return a.status("NO_DATA").text("Je n'ai pas de cotation actuelle pour " + symbol + " : impossible de valoriser "
          + "l'alternative sans inventer un prix.");
    }
    double qty = num(e.get("quantity"));
    double price = num(e.get("price"));
    double fee = num(e.get("fee"));
    boolean buy = "BUY".equals(e.get("side"));
    // Value of the decision taken versus not taking it, both marked at today's mid.
    double diff = buy ? qty * (mid - price) - fee : -(qty * (mid - price)) - fee;
    a.evidence(Kind.OBSERVED, "Exécution", map("side", e.get("side"), "quantity", qty, "price", price, "fee", fee,
        "executedAt", e.get("executedAt")), null, "Journal des exécutions");
    a.evidence(Kind.OBSERVED, "Prix actuel " + symbol, mid, null, "Cotation du moteur de marché");
    a.evidence(Kind.CALCULATED, "Écart décision réelle − alternative", diff, null,
        buy ? "q × (prix actuel − prix payé) − frais" : "−q × (prix actuel − prix de vente) − frais");
    a.scenario(map("kind", "REPLAY_AT_CURRENT_MARK", "hypothetical", true,
        "label", "Sans " + (buy ? "l'achat" : "la vente") + " de " + EchoFormat.num(qty, 0) + " " + symbol,
        "rows", List.of(map("label", "Décision réelle", "value", buy ? qty * mid - qty * price - fee : qty * price - fee),
            map("label", "Alternative (ne rien faire)", "value", buy ? 0.0 : qty * mid))));
    String verdict = diff >= 0 ? "a rapporté " : "a coûté ";
    a.text("Au prix actuel de " + symbol + " (" + EchoFormat.num(mid, 3) + "), " + (buy ? "cet achat" : "cette vente")
        + " de " + EchoFormat.num(qty, 0) + " unités " + verdict + EchoFormat.num(Math.abs(diff), 2)
        + " par rapport à l'alternative de ne rien faire, frais compris. Un écart de performance à une date ne suffit "
        + "pas à juger la qualité de la décision : il dépend du moment de l'observation.");
    a.limitation("Replay valorisé au prix actuel : n'intègre ni les ordres ultérieurs sur ce titre ni le spread de sortie.");
    a.ask("Mes décisions enregistrées", "Montre mon journal de décisions.");
    return a;
  }

  /** MarketQuest Time Machine: what if I had held from my first decision? (read-only engine replay). */
  @SuppressWarnings("unchecked")
  EchoAnswer missionHold(AuthUser user, UUID sessionId) {
    EchoAnswer a = new EchoAnswer("ALTERNATIVE");
    Map<String, Object> r = tools.whatIfHold(user, sessionId, 1);
    a.tool("learning.whatIfHold");
    List<Map<String, Object>> decisions = (List<Map<String, Object>>) r.get("decisions");
    int from = 1;
    if (decisions != null && !decisions.isEmpty()) {
      from = ((Number) decisions.getFirst().get("seq")).intValue();
      if (from != 1) r = tools.whatIfHold(user, sessionId, from);
    }
    Map<String, Object> act = castMap(r.get("actual"));
    Map<String, Object> alt = castMap(r.get("alternative"));
    Double eqA = num(EchoFinancialTools.at(act, "metrics", "equity"));
    Double eqB = num(EchoFinancialTools.at(alt, "metrics", "equity"));
    Double scA = num(EchoFinancialTools.at(act, "assessment", "total"));
    Double scB = num(EchoFinancialTools.at(alt, "assessment", "total"));
    a.evidence(Kind.OBSERVED, "Capitaux finaux — vos décisions", eqA, "TND", "Moteur MarketQuest (rejeu)");
    a.evidence(Kind.SIMULATION, "Capitaux finaux — conserver sans trader", eqB, "TND", "Time Machine (HOLD)");
    a.evidence(Kind.CALCULATED, "Score — vos décisions", scA, "/100", "Évaluation déterministe");
    a.evidence(Kind.SIMULATION, "Score — alternative", scB, "/100", "Évaluation déterministe");
    a.scenario(map("kind", "TIME_MACHINE", "hypothetical", true, "label", "Alternative : conserver à partir de la décision "
        + from, "rows", List.of(map("label", "Vos décisions", "equity", eqA, "score", scA),
            map("label", "Conserver sans trader", "equity", eqB, "score", scB)), "persisted", false));
    List<Map<String, Object>> curveA = (List<Map<String, Object>>) act.get("equityCurve");
    if (curveA != null) {
      a.chart("line", "Capitaux par étape — vos décisions", curveA.stream()
          .map(p -> map("x", p.get("step"), "y", p.get("equity"))).toList(), "TND");
    }
    a.text("Mission « " + r.get("missionTitle") + " » : avec vos décisions, les capitaux finaux sont de "
        + EchoFormat.num(eqA, 2) + " TND" + (scA == null ? "" : " pour un score de " + EchoFormat.num(scA, 0)) + ". "
        + "Si vous aviez conservé le portefeuille sans trader à partir de la décision " + from + ", le moteur de la "
        + "mission donne " + EchoFormat.num(eqB, 2) + " TND" + (scB == null ? "" : " et un score de " + EchoFormat.num(scB, 0))
        + ". Ce rejeu utilise le même marché simulé de la mission ; il ne dit pas ce qui se serait passé sur un "
        + "marché réel.");
    a.context.put("sessionId", sessionId.toString());
    a.limitation("Alternative calculée en mémoire : aucune session n'a été créée et votre score n'est pas modifié.");
    a.navigate("Ouvrir la Machine à remonter le temps", "/learn/sessions/" + sessionId + "/review");
    return a;
  }
}
