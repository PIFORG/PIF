package com.pif.api.echo;

import static com.pif.api.echo.EchoFinancialTools.at;
import static com.pif.api.echo.EchoFinancialTools.map;
import static com.pif.api.echo.EchoFinancialTools.num;

import com.pif.api.echo.EchoAnswer.Kind;
import com.pif.api.security.AuthUser;
import com.pif.api.trading.TradingDtos;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Pre-trade advisor. Every warning comes from a number computed by the existing Risk Studio pre-trade
 * simulation ({@code PortfoliosService.preTradeRisk}) or by the platform's {@code Risk} functions on the
 * instrument history. ÉCHO never submits, modifies or cancels an order.
 */
@Component
public class EchoRiskAdvisor {

  /** Documented thresholds (see docs/echo/CAPABILITIES.md). */
  static final double CONCENTRATION_WARN = 0.25;
  static final double CONCENTRATION_JUMP = 0.05;
  static final double CASH_BUFFER = 0.05;
  static final double FEE_HEAVY = 0.01;
  static final double HIGH_VOL = 0.40;

  private final EchoFinancialTools tools;

  public EchoRiskAdvisor(EchoFinancialTools tools) {
    this.tools = tools;
  }

  static TradingDtos.OrderTerms terms(Map<String, Object> draft) {
    if (draft == null) return null;
    Object symbol = draft.get("symbol");
    Double qty = num(draft.get("quantity"));
    if (!(symbol instanceof String s) || s.isBlank() || qty == null || !(qty > 0)) return null;
    String side = String.valueOf(draft.getOrDefault("side", "BUY")).toUpperCase(Locale.ROOT);
    String type = String.valueOf(draft.getOrDefault("type", "MARKET")).toUpperCase(Locale.ROOT);
    if (!List.of("BUY", "SELL").contains(side)) return null;
    return new TradingDtos.OrderTerms(s.toUpperCase(Locale.ROOT), side, type, qty, num(draft.get("limitPrice")),
        num(draft.get("stopPrice")));
  }

  EchoAnswer analyse(AuthUser user, UUID portfolioId, TradingDtos.OrderTerms t) {
    EchoAnswer a = new EchoAnswer("PRETRADE");
    a.context.put("portfolioId", portfolioId.toString());
    a.context.put("orderDraft", map("symbol", t.symbol(), "side", t.side(), "type", t.type(), "quantity", t.quantity()));
    Map<String, Object> risk = tools.preTradeRisk(user, portfolioId, t);
    a.tool("portfolio.preTradeRisk");
    String ccy = String.valueOf(risk.getOrDefault("currency", "TND"));
    a.asOf(String.valueOf(risk.get("asOf")));
    a.source("Trading › Contrôle pré-trade", "Simulation d'exécution immédiate (Risk Studio), sans passer d'ordre",
        castMap(risk.get("provenance")));

    Map<String, Object> eval = castMap(risk.get("evaluation"));
    Map<String, Object> cur = castMap(risk.get("current"));
    Map<String, Object> prop = castMap(risk.get("proposed"));
    Double notional = num(at(eval, "estimate", "notional"));
    Double fee = num(at(eval, "estimate", "fee"));
    Double ref = num(eval.get("referencePrice"));
    a.evidence(Kind.OBSERVED, "Prix de référence " + t.symbol(), ref, ccy, "Cotation du moteur de marché");
    a.evidence(Kind.CALCULATED, "Montant estimé", notional, ccy, "Moteur d'ordres");
    a.evidence(Kind.CALCULATED, "Frais estimés", fee, ccy, "Barème de frais de la classe d'actif");

    List<String> lines = new ArrayList<>();
    String verb = "BUY".equals(t.side()) ? "Achat" : "Vente";
    lines.add(verb + " de " + EchoFormat.num(t.quantity(), 0) + " " + t.symbol() + " : montant estimé "
        + EchoFormat.money(notional, ccy) + ", frais " + EchoFormat.money(fee, ccy) + ".");

    if (!Boolean.TRUE.equals(eval.get("accepted"))) {
      Map<String, Object> rej = castMap(eval.get("rejection"));
      String msg = String.valueOf(rej.getOrDefault("message", "Ordre refusé par les contrôles."));
      a.flag(String.valueOf(rej.getOrDefault("code", "REJECTED")), "CRITICAL",
          "Les contrôles du moteur refuseraient cet ordre : " + msg, map("availableCash", eval.get("availableCash"),
              "held", eval.get("held")));
      lines.add("Les contrôles du moteur refuseraient cet ordre : " + msg);
      a.speech("Attention, cet ordre serait refusé. " + msg);
      a.ask("Quelle quantité est possible ?", "Quelle quantité de " + t.symbol() + " puis-je acheter ?");
      finish(a, t);
      return a.text(String.join(" ", lines));
    }

    Double wNow = num(cur.get("largestWeight"));
    Double wAfter = num(prop.get("largestWeight"));
    Double effNow = num(cur.get("effectiveHoldings"));
    Double effAfter = num(prop.get("effectiveHoldings"));
    Double cashAfter = num(prop.get("cash"));
    Double eqAfter = num(prop.get("equity"));
    Double cap = num(cur.get("maxPositionWeightPct"));
    a.evidence(Kind.CALCULATED, "Plus grande ligne (avant → après)", map("before", wNow, "after", wAfter), "ratio",
        "RiskStudio.snapshot");
    a.evidence(Kind.CALCULATED, "Positions effectives 1/HHI (avant → après)", map("before", effNow, "after", effAfter),
        null, "RiskStudio.snapshot");
    a.evidence(Kind.CALCULATED, "Liquidités après exécution", cashAfter, ccy, "Simulation pré-trade");
    lines.add("Plus grande ligne : " + EchoFormat.pct(wNow) + " → " + EchoFormat.pct(wAfter)
        + " ; positions effectives : " + EchoFormat.num(effNow, 1) + " → " + EchoFormat.num(effAfter, 1) + ".");

    List<String> spoken = new ArrayList<>();
    if (Boolean.FALSE.equals(prop.get("withinPositionLimit"))) {
      a.flag("POSITION_LIMIT", "CRITICAL", "La ligne dépasserait le plafond de " + EchoFormat.num(cap, 0)
          + " % fixé pour ce portefeuille.", map("largestWeight", wAfter, "capPct", cap));
      spoken.add("cette opération dépasserait le plafond de poids par ligne");
    } else if (wAfter != null && wNow != null && wAfter >= CONCENTRATION_WARN && wAfter - wNow >= CONCENTRATION_JUMP
        && "BUY".equals(t.side())) {
      a.flag("CONCENTRATION_UP", "WARNING", "Cet achat porterait la plus grande ligne à " + EchoFormat.pct(wAfter)
          + " du portefeuille (" + EchoFormat.pp(wAfter - wNow) + ").",
          map("before", wNow, "after", wAfter, "threshold", CONCENTRATION_WARN));
      spoken.add("cet achat augmenterait votre concentration sur un seul instrument");
    }
    if (cashAfter != null && eqAfter != null && eqAfter > 0 && cashAfter / eqAfter < CASH_BUFFER && "BUY".equals(t.side())) {
      a.flag("CASH_LOW", "WARNING", "Il resterait " + EchoFormat.pct(cashAfter / eqAfter)
          + " de liquidités : peu de marge pour un ordre ultérieur ou un rééquilibrage.",
          map("cashAfter", cashAfter, "equityAfter", eqAfter, "threshold", CASH_BUFFER));
      spoken.add("il vous resterait très peu de liquidités");
    }
    if (fee != null && notional != null && notional > 0 && fee / notional > FEE_HEAVY) {
      a.flag("FEE_HEAVY", "INFO", "Les frais représentent " + EchoFormat.pct(fee / notional)
          + " du montant : le minimum de frais pèse sur un petit ordre.", map("fee", fee, "notional", notional));
    }
    if (effNow != null && effAfter != null && effAfter < effNow - 0.5) {
      a.flag("DIVERSIFICATION_DOWN", "INFO", "Le nombre de positions effectives baisserait de "
          + EchoFormat.num(effNow - effAfter, 1) + ".", map("before", effNow, "after", effAfter));
    }
    var stats = EchoFinancialTools.stats(tools.history(t.symbol(), "6M"));
    a.tool("market.history");
    if (stats.isPresent() && stats.get().annualVol() != null) {
      var s = stats.get();
      a.evidence(Kind.CALCULATED, "Volatilité annualisée " + t.symbol() + " (" + s.observations() + " obs.)",
          s.annualVol(), "ratio", "Écart-type des rendements quotidiens × √252, " + EchoFormat.day(s.from()) + " → "
              + EchoFormat.day(s.to()));
      if (s.annualVol() > HIGH_VOL) {
        a.flag("HIGH_VOLATILITY", "INFO", t.symbol() + " a une volatilité annualisée de " + EchoFormat.pct(s.annualVol())
            + " sur la période observée.", map("annualVol", s.annualVol(), "threshold", HIGH_VOL));
      }
    } else {
      a.limitation("Historique insuffisant pour estimer la volatilité de " + t.symbol() + ".");
    }

    // Alternative quantity: re-run the same engine at half size so the user can compare.
    if ("BUY".equals(t.side()) && t.quantity() >= 2 && !a.riskFlags.isEmpty()) {
      double half = Math.floor(t.quantity() / 2);
      Map<String, Object> alt = tools.preTradeRisk(user, portfolioId,
          new TradingDtos.OrderTerms(t.symbol(), t.side(), t.type(), half, t.limitPrice(), t.stopPrice()));
      Map<String, Object> altProp = castMap(alt.get("proposed"));
      a.scenario(map("kind", "PRETRADE_COMPARISON", "hypothetical", true, "label", "Comparaison de quantités",
          "rows", List.of(
              row("Situation actuelle", cur),
              row("Ordre préparé (" + EchoFormat.num(t.quantity(), 0) + ")", prop),
              row("Moitié de la quantité (" + EchoFormat.num(half, 0) + ")", altProp))));
    } else {
      a.scenario(map("kind", "PRETRADE_COMPARISON", "hypothetical", true, "label", "Avant / après l'ordre",
          "rows", List.of(row("Situation actuelle", cur), row("Après l'ordre", prop))));
    }

    if (a.riskFlags.isEmpty()) {
      lines.add("Aucun seuil de risque d'ÉCHO n'est franchi par cet ordre.");
      a.speech(null);
    } else {
      lines.add(a.riskFlags.size() == 1 ? "Un point mérite votre attention." : a.riskFlags.size()
          + " points méritent votre attention.");
      if (!spoken.isEmpty()) {
        a.speech("Attention, " + String.join(", et ", spoken)
            + ". Voulez-vous examiner l'impact sur votre portefeuille avant de confirmer ?");
      }
    }
    finish(a, t);
    return a.text(String.join(" ", lines));
  }

  private static void finish(EchoAnswer a, TradingDtos.OrderTerms t) {
    a.limitation("Simulation d'exécution immédiate : aucun ordre n'a été envoyé. La confirmation reste dans le ticket.");
    a.limitation("La VaR historique n'est pas recalculée ici ; consultez Risques pour la VaR du portefeuille.");
    a.ask("Expliquer la concentration", "Qu'est-ce que la concentration ?");
    a.navigate("Examiner le portefeuille", "/risk");
  }

  private static Map<String, Object> row(String label, Map<String, Object> s) {
    return map("label", label, "cash", s.get("cash"), "equity", s.get("equity"), "largestWeight",
        s.get("largestWeight"), "effectiveHoldings", s.get("effectiveHoldings"), "withinPositionLimit",
        s.get("withinPositionLimit"));
  }

  @SuppressWarnings("unchecked")
  static Map<String, Object> castMap(Object o) {
    return o instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
  }
}
