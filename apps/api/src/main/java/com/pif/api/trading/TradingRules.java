package com.pif.api.trading;

import com.pif.api.finance.Money;
import com.pif.api.finance.PreTrade.FeeSchedule;
import java.util.List;
import java.util.Map;

/** Simulated broker terms and limits (apps/api/src/trading/rules.ts). Not a real tariff. */
public final class TradingRules {

  private TradingRules() {}

  /** Commission per asset class: max(minimum, notional × bps). */
  public static final Map<String, FeeSchedule> FEE_SCHEDULES = Map.of(
      "EQUITY", new FeeSchedule(25, Money.toAmount(0.5)),
      "FUND", new FeeSchedule(10, Money.toAmount(0.5)),
      "BOND", new FeeSchedule(8, Money.toAmount(0.5)),
      "COMMODITY", new FeeSchedule(30, Money.toAmount(1.0)),
      "FX", new FeeSchedule(5, Money.toAmount(0.25)));

  public static final int MAX_PORTFOLIOS_PER_USER = 5;
  public static final double MIN_INITIAL_CAPITAL = Money.toAmount(1_000);
  public static final double MAX_INITIAL_CAPITAL = Money.toAmount(1_000_000);
  public static final double MAX_CASH_FLOW = Money.toAmount(1_000_000);
  public static final double MAX_NET_CONTRIBUTIONS = Money.toAmount(10_000_000);
  public static final int MAX_OPEN_ORDERS = 50;
  public static final int MAX_ORDER_QUANTITY = 1_000_000;
  /** Limit prices must lie within ±50 % of the mid when the order is placed. */
  public static final double LIMIT_BAND_PCT = 50;
  /** Resting orders are good-till-cancelled up to this many days, then expire. */
  public static final int ORDER_EXPIRY_DAYS = 30;
  public static final int DEFAULT_MAX_POSITION_WEIGHT_PCT = 50;

  /** What a stress scenario reads of a holding. */
  public record ShockTarget(String assetClass, String sector) {}

  @FunctionalInterface
  public interface Shock {
    double of(ShockTarget instrument);
  }

  /** A hypothetical instantaneous shock for stress testing; a teaching scenario, not a forecast. */
  public record StressScenario(String id, String name, String description, Shock shockOf) {}

  private static boolean equity(ShockTarget i) {
    return "EQUITY".equals(i.assetClass());
  }

  public static final List<StressScenario> STRESS_SCENARIOS = List.of(
      new StressScenario("equity-crash", "Krach actions large", "Toutes les actions baissent de 20 % ; le fonds obligataire de 3 %.",
          i -> equity(i) ? -0.2 : -0.03),
      new StressScenario("banking-shock", "Choc du secteur bancaire",
          "Les banques −25 %, les autres actions −5 % ; le fonds obligataire +1 % (fuite vers la qualité).",
          i -> "Banking".equals(i.sector()) ? -0.25 : equity(i) ? -0.05 : 0.01),
      new StressScenario("rate-rise", "Hausse des taux",
          "Fonds obligataire −6 %, utilities −8 %, autres actions −3 %.",
          i -> "Fixed income".equals(i.sector()) ? -0.06 : "Utilities".equals(i.sector()) ? -0.08 : -0.03),
      new StressScenario("tech-selloff", "Vente massive technologique",
          "Technologie −30 %, télécom −10 %, autres actions −2 % ; le fonds obligataire inchangé.",
          i -> "Technology".equals(i.sector()) ? -0.3 : "Telecom".equals(i.sector()) ? -0.1 : equity(i) ? -0.02 : 0));
}
