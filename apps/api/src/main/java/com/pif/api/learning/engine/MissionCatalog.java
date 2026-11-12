package com.pif.api.learning.engine;

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
import com.pif.api.market.FictionalUniverse;
import com.pif.api.market.FictionalUniverse.FictionalInstrument;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/** The MarketQuest mission catalog (apps/api/src/learning/missions/catalog.ts, universe.ts and validate.ts). */
public final class MissionCatalog {

  private MissionCatalog() {}

  public static final String SIMULATION_PROVENANCE = "Synthetic, seeded simulation of fictional instruments: a "
      + "one-factor random-walk model with scripted events. It is reproducible and educational; it is not historical "
      + "data and not a forecast.";

  private static final ScoringWeights DEFAULT_WEIGHTS = new ScoringWeights(40, 25, 20, 15);

  private static final List<String> MARKET_LIMIT = List.of("MARKET", "LIMIT");
  private static final List<String> ALL_TYPES = List.of("MARKET", "LIMIT", "STOP");

  private static final List<StressScenarioDefinition> EQUITY_STRESS = List.of(
      new StressScenarioDefinition("equity-crash", "Equity crash", "Every equity falls 20 %; the bond fund gains 2 %.",
          List.of(shock("*", -0.2), shock("GOV", 0.02))),
      new StressScenarioDefinition("tech-selloff", "Technology sell-off",
          "TunisTech falls 30 %; other equities fall 5 %.",
          List.of(shock("TEK", -0.3), shock("*", -0.05), shock("GOV", 0))),
      new StressScenarioDefinition("rate-hike", "Rate hike",
          "Bonds −4 %, utilities −6 %, banks +2 %, other equities −3 %.",
          List.of(shock("GOV", -0.04), shock("ATL", -0.06), shock("CTB", 0.02), shock("*", -0.03))));

  public static final List<MissionDefinition> MISSIONS = List.of(
      new MissionDefinition("my-first-trade", 1, 1, "My First Trade", "ROOKIE", "IMPLEMENTED",
          "Read a quote, choose an order type and buy your first shares with a reason you can explain.", 6,
          List.of(competency("TRADING_EXECUTION", 1), competency("MARKET_UNDERSTANDING", 0.6)),
          List.of("Explain the difference between the bid, the ask and the spread.",
              "Choose between a market order and a limit order.",
              "Account for commissions in the cost of a trade."),
          new Briefing("You have 10,000 DT and access to two stocks. Your goal is not to get rich in five days — it is "
              + "to place a well-reasoned first order and understand exactly what it cost you.",
              List.of("Buy at least one stock.", "Stay at least 30 % invested on average from day 1.",
                  "Commission: 0.25 % per fill, minimum 0.500 DT."),
              List.of("A market buy pays the ask; a limit buy waits for your price.",
                  "Check the fee preview before you submit.")),
          "TND", 10_000, List.of(),
          scenario(5, 40, assets("OLV", "CTB"), List.of(
              event("olv-results", 3, "EARNINGS", "POSITIVE", "Olivia Foods reports steady sales growth",
                  "Quarterly sales rose 6 % on stronger export volumes. Analysts call the result solid but expected.",
                  false, List.of(shock("OLV", 0.03)), null)),
              List.of(), 1001),
          MissionRules.of("allowedOrderTypes", MARKET_LIMIT, "feeBps", 25, "minFee", 0.5, "allowStressTest", false),
          List.of(
              ObjectiveDefinition.of("first-buy", "EXECUTE_ORDER", "Buy your first shares", true).side("BUY"),
              ObjectiveDefinition.of("invested", "MIN_INVESTED", "Stay at least 30 % invested on average", true).pct(30),
              ObjectiveDefinition.of("few-trades", "MAX_TRADES", "Use no more than 4 executed orders", false).count(4)),
          List.of(maxLoss(20)), scoring(55, null, 5, 4), "GUIDED", "adam-first-order"),
      new MissionDefinition("protect-your-capital", 1, 2, "Protect Your Capital", "ROOKIE", "IMPLEMENTED",
          "You already own a volatile tech stock. Put protection in place before bad news arrives.", 8,
          List.of(competency("RISK_MANAGEMENT", 1), competency("TRADING_EXECUTION", 0.5)),
          List.of("Place a protective stop order.",
              "Understand gap risk: a stop sells at the next available bid, not at the stop price.",
              "Size a position to an acceptable loss."),
          new Briefing("Your 20,000 DT portfolio holds 500 TunisTech shares bought at today’s price, plus cash. The "
              + "stock moves a lot. Decide how much you are willing to lose and protect it.",
              List.of("Protect the position with a stop order.", "Keep the maximum drawdown at or below 8 %.",
                  "The mission fails if you lose 15 %."),
              List.of("A stop sell triggers when the bid falls to your stop price.",
                  "Prices can gap past your stop overnight.")),
          "TND", 6_300, List.of(position("TEK", 500)),
          scenario(8, 40, assets("TEK", "ATL"), List.of(
              event("tek-warning", 4, "EARNINGS", "NEGATIVE", "TunisTech issues a profit warning",
                  "Management cuts full-year guidance after a large client delays a contract. Volatility is expected "
                      + "to stay high for several sessions.",
                  false, List.of(shock("TEK", -0.09)), new EventRegime(3, 1.8, null, null, null, List.of("TEK")))),
              List.of(), 1002),
          MissionRules.of("allowedOrderTypes", ALL_TYPES, "feeBps", 25, "minFee", 0.5, "allowStressTest", false),
          List.of(
              ObjectiveDefinition.of("stop", "PROTECTIVE_STOP", "Protect your TunisTech position with a stop", true),
              ObjectiveDefinition.of("drawdown", "MAX_DRAWDOWN", "Keep the maximum drawdown at or below 8 %", true)
                  .limitPct(8),
              ObjectiveDefinition.of("react", "REACT_TO_EVENT", "Make a decision after the profit warning", false)
                  .event("tek-warning", 1)),
          List.of(maxLoss(15)), scoring(60, null, 8, 5), "GUIDED", null),
      new MissionDefinition("diversification-challenge", 1, 3, "The Diversification Challenge", "ROOKIE",
          "IMPLEMENTED", "Build a portfolio of at least four assets where no single position dominates.", 10,
          List.of(competency("DIVERSIFICATION", 1), competency("RISK_MANAGEMENT", 0.5)),
          List.of("Measure concentration with position weights and the effective number of assets.",
              "See how diversification softens a sector-specific shock."),
          new Briefing("You start with 50,000 DT in cash and six assets across different sectors. Build a portfolio "
              + "that can absorb a surprise in any single company.",
              List.of("Hold at least four assets at the end.",
                  "From day 2, no position may exceed 30 % of equity at the end of a day.",
                  "Stay at least 60 % invested on average.",
                  "Buys that would put more than 40 % of equity in one asset are rejected."),
              List.of("Watch the “effective assets” figure in the risk panel.",
                  "Lower-correlation sectors diversify better than several similar stocks.")),
          "TND", 50_000, List.of(),
          scenario(10, 40, assets("CTB", "MDX", "OLV", "SFX", "TEK", "ATL"), List.of(
              event("tek-outage", 6, "NEWS", "NEGATIVE", "Major outage hits TunisTech data centres",
                  "A two-day outage disrupts TunisTech services nationwide. Other sectors are unaffected.", false,
                  List.of(shock("TEK", -0.07)), null)),
              List.of(), 1003),
          MissionRules.of("allowedOrderTypes", MARKET_LIMIT, "feeBps", 25, "minFee", 0.5, "maxPositionWeightPct", 40,
              "allowStressTest", false),
          List.of(
              ObjectiveDefinition.of("four-assets", "MIN_ASSETS_HELD", "Hold at least four assets", true).count(4),
              ObjectiveDefinition.of("weight-cap", "MAX_POSITION_WEIGHT",
                  "Keep every position at or below 30 % from day 2", true).limitPct(30).fromStep(2),
              ObjectiveDefinition.of("invested", "MIN_INVESTED", "Stay at least 60 % invested on average", true)
                  .pct(60)),
          List.of(maxLoss(20)), scoring(60, 30.0, 8, 10), "SOCRATIC", "youssef-all-in"),
      new MissionDefinition("breaking-news", 1, 4, "Breaking News", "STRATEGIST", "CONFIGURED",
          "Two headlines, two very different stories. Decide which news matters for your portfolio.", 10,
          List.of(competency("MARKET_UNDERSTANDING", 1), competency("STRATEGIC_REASONING", 0.6)),
          List.of("Separate news that changes fundamentals from noise.",
              "React proportionately rather than impulsively."),
          new Briefing("You manage 30,000 DT split between a bank, a telecom operator and cash. Headlines will arrive "
              + "during the week.",
              List.of("Make a decision within one day of the regulatory headline.",
                  "Keep the maximum drawdown at or below 6 %.", "No more than 8 executed orders."),
              List.of("Ask what the news changes about future cash flows.",
                  "Not every headline deserves a trade — but you should decide deliberately.")),
          "TND", 12_000, List.of(position("CTB", 200), position("MDX", 522)),
          scenario(10, 40, assets("CTB", "MDX", "OLV", "GOV"), List.of(
              event("ctb-earnings", 3, "EARNINGS", "POSITIVE", "Carthage Bank beats earnings expectations",
                  "Net income up 14 % on lower loan losses. The bank raises its dividend.", false,
                  List.of(shock("CTB", 0.06)), null),
              event("mdx-fine", 6, "NEWS", "NEGATIVE", "Regulator fines Medina Telecom and caps roaming prices",
                  "The fine is one-off, but the price cap reduces revenue for at least two years.", false,
                  List.of(shock("MDX", -0.08)), new EventRegime(3, null, -0.004, null, null, List.of("MDX")))),
              List.of(), 1004),
          MissionRules.of("allowedOrderTypes", ALL_TYPES, "feeBps", 25, "minFee", 0.5, "allowStressTest", false),
          List.of(
              ObjectiveDefinition.of("react-fine", "REACT_TO_EVENT",
                  "Decide how to respond to the regulatory headline", true).event("mdx-fine", 1),
              ObjectiveDefinition.of("drawdown", "MAX_DRAWDOWN", "Keep the maximum drawdown at or below 6 %", true)
                  .limitPct(6),
              ObjectiveDefinition.of("trades", "MAX_TRADES", "No more than 8 executed orders", false).count(8)),
          List.of(maxLoss(15)), scoring(60, null, 6, 8), "SOCRATIC", null),
      new MissionDefinition("market-shock", 1, 5, "The Market Shock", "STRATEGIST", "IMPLEMENTED",
          "A sudden market-wide drop tests whether you planned for it — or panic.", 12,
          List.of(competency("RISK_MANAGEMENT", 1), competency("STRATEGIC_REASONING", 0.7),
              competency("MARKET_UNDERSTANDING", 0.5)),
          List.of("Use a stress test to estimate losses before they happen.",
              "Respond to a shock with a plan instead of a reflex.", "Recognise that correlations rise in a sell-off."),
          new Briefing("You manage a 50,000 DT diversified portfolio. Markets have been calm — perhaps too calm.",
              List.of("Run a stress test before day 5.", "Make a decision within two days of the shock.",
                  "Keep the maximum drawdown at or below 9 %.", "The mission fails at a 15 % loss."),
              List.of("A stress test shows what a shock would cost today, before it happens.",
                  "Selling everything at the bottom locks in the loss and pays the widest spreads.")),
          "TND", 10_140,
          List.of(position("CTB", 240), position("TEK", 350), position("OLV", 1000), position("ATL", 700)),
          scenario(12, 60, assets("CTB", "TEK", "OLV", "ATL", "GOV"), List.of(
              event("shock", 5, "SHOCK", "NEGATIVE", "Global sell-off: markets drop sharply at the open",
                  "A surprise default abroad triggers a flight to safety. Equities fall across the board; bonds rally.",
                  false, List.of(shock("*", -0.07), shock("TEK", -0.1), shock("GOV", 0.01)),
                  new EventRegime(4, 2.0, null, 2.0, null, null))),
              EQUITY_STRESS, 1005),
          MissionRules.of("allowedOrderTypes", ALL_TYPES, "feeBps", 25, "minFee", 0.5, "allowStressTest", true),
          List.of(
              ObjectiveDefinition.of("stress", "RUN_STRESS_TEST", "Run a stress test before day 5", true).beforeStep(5),
              ObjectiveDefinition.of("react", "REACT_TO_EVENT", "Make a decision within two days of the shock", true)
                  .event("shock", 2),
              ObjectiveDefinition.of("drawdown", "MAX_DRAWDOWN", "Keep the maximum drawdown at or below 9 %", true)
                  .limitPct(9),
              ObjectiveDefinition.of("trades", "MAX_TRADES", "No more than 10 executed orders", false).count(10)),
          List.of(maxLoss(15)), scoring(60, 35.0, 9, 10), "SOCRATIC", null),
      new MissionDefinition("sector-collapse", 1, 6, "The Sector Collapse", "STRATEGIST", "CONFIGURED",
          "Your portfolio leans heavily on banks just as the banking sector cracks.", 12,
          List.of(competency("DIVERSIFICATION", 1), competency("RISK_MANAGEMENT", 0.7)),
          List.of("Identify sector concentration hidden inside a “diversified” portfolio.", "Rebalance under pressure."),
          new Briefing("You inherit a 40,000 DT portfolio with most of its value in Carthage Bank. Rumours about bad "
              + "loans are circulating.",
              List.of("From day 3, no position may exceed 25 % of equity at the end of a day.",
                  "Keep the maximum drawdown at or below 10 %."),
              List.of("Rebalancing early costs less than rebalancing in a panic.")),
          "TND", 5_000, List.of(position("CTB", 600), position("MDX", 522)),
          scenario(12, 40, assets("CTB", "MDX", "OLV", "ATL", "GOV"), List.of(
              event("bank-rumours", 2, "NEWS", "NEGATIVE", "Reports of rising bad loans at regional banks",
                  "Unconfirmed reports suggest several banks under-reserved for problem loans.", true,
                  List.of(shock("CTB", -0.03)), null),
              event("bank-collapse", 6, "SHOCK", "NEGATIVE", "Carthage Bank announces a large loan write-down",
                  "The write-down wipes out a year of profit. The dividend is suspended.", false,
                  List.of(shock("CTB", -0.2)), new EventRegime(4, 2.5, -0.01, null, null, List.of("CTB")))),
              List.of(), 1006),
          MissionRules.of("allowedOrderTypes", ALL_TYPES, "feeBps", 25, "minFee", 0.5, "allowStressTest", false),
          List.of(
              ObjectiveDefinition.of("weight-cap", "MAX_POSITION_WEIGHT",
                  "Keep every position at or below 25 % from day 3", true).limitPct(25).fromStep(3),
              ObjectiveDefinition.of("drawdown", "MAX_DRAWDOWN", "Keep the maximum drawdown at or below 10 %", true)
                  .limitPct(10),
              ObjectiveDefinition.of("react", "REACT_TO_EVENT", "Respond to the first rumours", false)
                  .event("bank-rumours", 1)),
          List.of(maxLoss(20)), scoring(60, 25.0, 10, 8), "CRITICAL", null),
      new MissionDefinition("interest-rate-shock", 1, 7, "The Interest Rate Shock", "STRATEGIST", "CONFIGURED",
          "The central bank surprises with a large rate hike. Bonds and utilities reprice.", 12,
          List.of(competency("MARKET_UNDERSTANDING", 1), competency("RISK_MANAGEMENT", 0.6)),
          List.of("Explain why bond prices fall when rates rise.", "Identify rate-sensitive sectors."),
          new Briefing("A 40,000 DT income portfolio of bonds and utilities faces an unexpected policy decision.",
              List.of("Run a stress test before the decision.", "Keep the maximum drawdown at or below 7 %."),
              List.of("Duration measures how sensitive a bond is to rates: with a duration of about 5, a 1 percentage "
                  + "point rise in yields costs roughly 5 %.",
                  "Utilities borrow heavily and pay steady dividends, so they often reprice with bonds.")),
          "TND", 10_000, List.of(position("GOV", 200), position("ATL", 684)),
          scenario(10, 40, assets("GOV", "ATL", "CTB", "OLV"), List.of(
              event("rate-hike", 4, "RATE", "MIXED", "Central bank raises its policy rate by 100 basis points",
                  "The decision surprises markets. Banks may earn more on loans; bonds and utilities reprice lower.",
                  false, List.of(shock("GOV", -0.05), shock("ATL", -0.06), shock("CTB", 0.03), shock("OLV", -0.01)),
                  null)),
              EQUITY_STRESS, 1007),
          MissionRules.of("allowedOrderTypes", ALL_TYPES, "feeBps", 25, "minFee", 0.5, "allowStressTest", true),
          List.of(
              ObjectiveDefinition.of("stress", "RUN_STRESS_TEST", "Run a stress test before day 4", true).beforeStep(4),
              ObjectiveDefinition.of("drawdown", "MAX_DRAWDOWN", "Keep the maximum drawdown at or below 7 %", true)
                  .limitPct(7)),
          List.of(maxLoss(15)), scoring(60, null, 7, 8), "SOCRATIC", null),
      new MissionDefinition("liquidity-crisis", 1, 8, "The Liquidity Crisis", "COMMANDER", "CONFIGURED",
          "You need to reduce a large position just as buyers disappear and spreads explode.", 15,
          List.of(competency("TRADING_EXECUTION", 1), competency("RISK_MANAGEMENT", 0.8)),
          List.of("See how thin liquidity causes partial fills and wide spreads.",
              "Split a large order across time and use limit orders to control execution cost."),
          new Briefing("Half of your 60,000 DT portfolio sits in Sfax Phosphates. Your risk committee wants it below "
              + "20 % by the end of day 10. Liquidity is about to dry up.",
              List.of("From day 10, Sfax Phosphates (and every other position) must be at or below 20 % of equity.",
                  "Keep the maximum drawdown at or below 12 %."),
              List.of("Market orders only fill against what is on the book; the rest is cancelled.",
                  "Execution cost = commissions + half the spread on every unit.")),
          "TND", 30_000, List.of(position("SFX", 476)),
          scenario(12, 40, assets("SFX", "GOV", "OLV"), List.of(
              event("liquidity", 3, "LIQUIDITY", "NEGATIVE", "Export ban rumours freeze trading in phosphates",
                  "Buyers step back. Market makers widen quotes sharply and show very little size.", true,
                  List.of(shock("SFX", -0.1)), new EventRegime(6, 1.8, null, 6.0, 0.1, List.of("SFX")))),
              List.of(), 1008),
          MissionRules.of("allowedOrderTypes", ALL_TYPES, "feeBps", 25, "minFee", 0.5, "allowStressTest", false),
          List.of(
              ObjectiveDefinition.of("reduce", "MAX_POSITION_WEIGHT", "Every position at or below 20 % from day 10",
                  true).limitPct(20).fromStep(10),
              ObjectiveDefinition.of("drawdown", "MAX_DRAWDOWN", "Keep the maximum drawdown at or below 12 %", true)
                  .limitPct(12)),
          List.of(maxLoss(20)), scoring(60, 20.0, 12, 12), "CRITICAL", null),
      new MissionDefinition("overconfident-trader", 1, 9, "The Overconfident Trader", "COMMANDER", "IMPLEMENTED",
          "Every trade asks how sure you are. At the end, your confidence is compared with your results.", 15,
          List.of(competency("STRATEGIC_REASONING", 1), competency("RISK_MANAGEMENT", 0.5)),
          List.of("Measure confidence calibration.", "Recognise overtrading driven by overconfidence."),
          new Briefing("A strong winning streak has made you feel invincible. This mission tracks how confident you "
              + "are on each decision.",
              List.of("Rate your confidence from 0 to 100 on every order. It is not scored; at the end it is compared "
                  + "with how each order turned out.",
                  "No more than 6 executed orders.", "Stay at least 50 % invested on average.",
                  "Keep the maximum drawdown at or below 10 %."),
              List.of("High confidence should be rare and earned.",
                  "A rumour is not a fact: ask what you would do if it were denied tomorrow.")),
          "TND", 40_000, List.of(),
          scenario(15, 40, assets("TEK", "CTB", "OLV", "SFX"), List.of(
              event("false-rally", 5, "NEWS", "POSITIVE", "Rumour: TunisTech in takeover talks",
                  "An unnamed source claims a foreign group is interested. The company declines to comment.", true,
                  List.of(shock("TEK", 0.08)), null),
              event("denial", 8, "NEWS", "NEGATIVE", "TunisTech denies takeover talks",
                  "The company says it has received no offer.", false, List.of(shock("TEK", -0.11)), null)),
              List.of(), 1009),
          MissionRules.of("allowedOrderTypes", ALL_TYPES, "feeBps", 25, "minFee", 0.5, "allowStressTest", false,
              "requireConfidence", true),
          List.of(
              ObjectiveDefinition.of("trades", "MAX_TRADES", "No more than 6 executed orders", true).count(6),
              ObjectiveDefinition.of("invested", "MIN_INVESTED", "Stay at least 50 % invested on average", true)
                  .pct(50),
              ObjectiveDefinition.of("drawdown", "MAX_DRAWDOWN", "Keep the maximum drawdown at or below 10 %", true)
                  .limitPct(10)),
          List.of(maxLoss(20)), scoring(60, null, 10, 6), "CRITICAL", null),
      new MissionDefinition("survive-the-market-crash", 1, 10, "Survive the Market Crash", "COMMANDER", "IMPLEMENTED",
          "A concentrated 100,000 DT portfolio, warning signs, then a crash. Lose no more than 10 %.", 20,
          List.of(competency("RISK_MANAGEMENT", 1), competency("DIVERSIFICATION", 0.8),
              competency("STRATEGIC_REASONING", 0.8), competency("TRADING_EXECUTION", 0.5),
              competency("MARKET_UNDERSTANDING", 0.5)),
          List.of("Reduce concentration before a crisis rather than during it.",
              "Use a stress test to size risk against a loss limit.",
              "Combine diversification, cash and stops into a coherent defence.",
              "Compare your path with alternatives in the Time Machine without hindsight bias."),
          new Briefing("You take over a 100,000 DT portfolio with 41 % in TunisTech. The investment committee’s rule "
              + "is simple: never lose more than 10 %. Over the next 20 trading days, warning signs will appear before "
              + "markets crash.",
              List.of("Mission fails immediately if equity falls 10 % below 100,000 DT.",
                  "From day 1, keep every position at or below 35 % of equity at the end of each day.",
                  "Hold at least three assets and stay at least 50 % invested on average.",
                  "Run a stress test before day 8."),
              List.of("Start with the concentration problem.",
                  "A stress test tells you whether you could survive a 20 % fall today.",
                  "Spreads widen and liquidity thins during the crash.")),
          "TND", 25_050, List.of(position("TEK", 1500), position("CTB", 500), position("SFX", 200)),
          scenario(20, 60, assets("TEK", "CTB", "SFX", "OLV", "ATL", "GOV"), List.of(
              event("warning", 5, "NEWS", "NEGATIVE", "Central bank minutes warn of stretched valuations",
                  "Policymakers flag rapid credit growth and rich equity valuations, especially in technology.", false,
                  List.of(shock("TEK", -0.02), shock("*", -0.005), shock("GOV", 0)), null),
              event("crash", 8, "SHOCK", "NEGATIVE", "Market crash: equities plunge as a major fund collapses",
                  "Forced selling spreads across all sectors. Technology and banks are hit hardest; investors flee to "
                      + "bonds.",
                  false, List.of(shock("*", -0.08), shock("TEK", -0.16), shock("CTB", -0.12), shock("GOV", 0.015)),
                  new EventRegime(5, 2.2, -0.003, 3.0, 0.4, null)),
              event("aftershock", 10, "SHOCK", "NEGATIVE", "Aftershock: margin calls force another wave of selling",
                  "Leveraged investors sell what they can, not what they want.", false,
                  List.of(shock("*", -0.03), shock("GOV", 0.005)), null),
              event("stabilisation", 14, "NEWS", "POSITIVE", "Central bank announces liquidity support",
                  "Emergency lending calms funding markets. Volatility starts to ease.", false,
                  List.of(shock("*", 0.03), shock("GOV", -0.003)), new EventRegime(6, null, 0.002, null, null, null))),
              EQUITY_STRESS, 1010),
          MissionRules.of("allowedOrderTypes", ALL_TYPES, "feeBps", 25, "minFee", 0.5, "allowStressTest", true),
          List.of(
              ObjectiveDefinition.of("max-loss", "MAX_LOSS", "Never lose 10 % or more", true).limitPct(10),
              ObjectiveDefinition.of("weight-cap", "MAX_POSITION_WEIGHT",
                  "Keep every position at or below 35 % from day 1", true).limitPct(35).fromStep(1),
              ObjectiveDefinition.of("three-assets", "MIN_ASSETS_HELD", "Hold at least three assets", true).count(3),
              ObjectiveDefinition.of("invested", "MIN_INVESTED", "Stay at least 50 % invested on average", true)
                  .pct(50),
              ObjectiveDefinition.of("stress", "RUN_STRESS_TEST", "Run a stress test before day 8", true).beforeStep(8),
              ObjectiveDefinition.of("stop", "PROTECTIVE_STOP", "Protect at least one position with a stop", false),
              ObjectiveDefinition.of("react", "REACT_TO_EVENT", "Make a decision within two days of the crash", false)
                  .event("crash", 2)),
          List.of(maxLoss(10)), scoring(65, 35.0, 10, 14), "SOCRATIC", "sarah-and-the-market-crash"));

  /** Declared before the static block below: that block validates the catalog, which uses this pattern. */
  private static final Pattern SLUG = Pattern.compile("^[a-z0-9]+(?:-[a-z0-9]+)*\\z");

  static {
    List<String> errors = validateCatalog(MISSIONS);
    if (!errors.isEmpty()) throw new IllegalStateException("Invalid mission catalog:\n" + String.join("\n", errors));
  }

  public static MissionDefinition find(String slug) {
    for (MissionDefinition m : MISSIONS) {
      if (m.slug().equals(slug)) return m;
    }
    return null;
  }

  public static boolean isPlayable(MissionDefinition mission) {
    return !"PLANNED".equals(mission.availability());
  }

  public static List<AssetDefinition> assets(String... symbols) {
    List<AssetDefinition> out = new ArrayList<>();
    for (String symbol : symbols) {
      FictionalInstrument a = FictionalUniverse.INSTRUMENTS.get(symbol);
      if (a == null) throw new IllegalArgumentException("Unknown universe symbol " + symbol);
      out.add(new AssetDefinition(a.symbol(), a.name(), a.sector(), a.initialPrice(), a.driftPerStep(), a.volPerStep(),
          a.beta(), a.spreadBps(), a.depth()));
    }
    return List.copyOf(out);
  }

  private static ScenarioDefinition scenario(int steps, int historySteps, List<AssetDefinition> assets,
      List<MarketEventDefinition> events, List<StressScenarioDefinition> stress, long seed) {
    return new ScenarioDefinition(steps, "day", historySteps, assets, events, stress, seed, SIMULATION_PROVENANCE);
  }

  private static MarketEventDefinition event(String id, int step, String kind, String sentiment, String headline,
      String body, boolean unconfirmed, List<Shock> shocks, EventRegime regime) {
    return new MarketEventDefinition(id, step, kind, sentiment, headline, body, unconfirmed, shocks, regime);
  }

  private static Shock shock(String symbol, double move) {
    return new Shock(symbol, move);
  }

  private static CompetencyWeight competency(String competency, double weight) {
    return new CompetencyWeight(competency, weight);
  }

  private static InitialPosition position(String symbol, double quantity) {
    return new InitialPosition(symbol, quantity);
  }

  private static FailureRule maxLoss(double limitPct) {
    return new FailureRule("MAX_LOSS", limitPct);
  }

  private static ScoringConfig scoring(double passThreshold, Double concentrationLimitPct, double riskLimitPct,
      double maxReasonableTrades) {
    return new ScoringConfig(DEFAULT_WEIGHTS, passThreshold, concentrationLimitPct, riskLimitPct, maxReasonableTrades);
  }

  /* ------------------------------------------------------------ validation */

  private static boolean hasAtMostThreeDecimals(double value) {
    return Math.abs(Math.round(value * 1000) - value * 1000) < 1e-6;
  }

  private static boolean isInteger(double x) {
    return Double.isFinite(x) && x == Math.rint(x);
  }

  public static List<String> validateMission(MissionDefinition m) {
    List<String> errors = new ArrayList<>();
    java.util.function.Consumer<String> fail = message -> errors.add(m.slug() + ": " + message);
    ScenarioDefinition scenario = m.scenario();
    Set<String> symbols = new HashSet<>();
    for (AssetDefinition a : scenario.assets()) symbols.add(a.symbol());

    if (!SLUG.matcher(m.slug()).find()) fail.accept("slug must be kebab-case");
    if (m.version() < 1) fail.accept("version must be a positive integer");
    if (!Definitions.LEVELS.contains(m.level())) fail.accept("unknown level " + m.level());
    if (com.pif.api.web.Validation.jsTrim(m.title()).isEmpty() || com.pif.api.web.Validation.jsTrim(m.summary()).isEmpty()) {
      fail.accept("title and summary are required");
    }
    if (m.learningOutcomes().isEmpty()) fail.accept("at least one learning outcome is required");

    if (scenario.assets().isEmpty()) fail.accept("scenario needs at least one asset");
    if (symbols.size() != scenario.assets().size()) fail.accept("asset symbols must be unique");
    for (AssetDefinition a : scenario.assets()) {
      if (!(a.initialPrice() > 0) || !hasAtMostThreeDecimals(a.initialPrice())) {
        fail.accept(a.symbol() + ": price must be positive with at most 3 decimals");
      }
      if (!(a.volPerStep() >= 0 && a.volPerStep() < 0.2)) fail.accept(a.symbol() + ": volPerStep out of range");
      if (!(a.beta() >= 0 && a.beta() <= 1)) fail.accept(a.symbol() + ": beta must be in [0, 1]");
      if (!(a.spreadBps() >= 0 && a.spreadBps() <= 1000)) fail.accept(a.symbol() + ": spreadBps out of range");
      if (!isInteger(a.depth()) || a.depth() < 1) fail.accept(a.symbol() + ": depth must be a positive integer");
    }
    if (scenario.steps() < 1 || scenario.steps() > 250) fail.accept("steps must be 1–250");
    if (scenario.historySteps() < 0) fail.accept("historySteps must be a non-negative integer");

    Set<String> eventIds = new HashSet<>();
    for (MarketEventDefinition e : scenario.events()) {
      if (eventIds.contains(e.id())) fail.accept("duplicate event id " + e.id());
      eventIds.add(e.id());
      if (e.step() < 1 || e.step() > scenario.steps()) fail.accept("event " + e.id() + ": step must be within the mission");
      for (Shock s : e.shocks()) {
        if (!"*".equals(s.symbol()) && !symbols.contains(s.symbol())) {
          fail.accept("event " + e.id() + ": unknown symbol " + s.symbol());
        }
        if (!(s.move() > -0.95 && s.move() < 5)) fail.accept("event " + e.id() + ": shock out of range");
      }
      if (e.regime() != null && e.regime().symbols() != null) {
        for (String s : e.regime().symbols()) {
          if (!symbols.contains(s)) fail.accept("event " + e.id() + ": regime references unknown symbol " + s);
        }
      }
      if (e.regime() != null && e.regime().steps() < 1) fail.accept("event " + e.id() + ": regime steps must be positive");
    }
    for (StressScenarioDefinition s : scenario.stressScenarios()) {
      boolean applies = s.shocks().stream().anyMatch(shock -> "*".equals(shock.symbol()) || symbols.contains(shock.symbol()));
      if (!applies) fail.accept("stress " + s.id() + ": no shock applies to this scenario");
      for (Shock shock : s.shocks()) {
        if (!(shock.move() > -1 && shock.move() < 5)) fail.accept("stress " + s.id() + ": shock out of range");
      }
    }

    if (m.initialCash() < 0) fail.accept("initial cash cannot be negative");
    for (InitialPosition p : m.initialPositions()) {
      if (!symbols.contains(p.symbol())) fail.accept("initial position in unknown symbol " + p.symbol());
      if (!isInteger(p.quantity()) || p.quantity() < 1) {
        fail.accept("initial position " + p.symbol() + ": quantity must be a positive integer");
      }
    }
    if (m.initialCash() == 0 && m.initialPositions().isEmpty()) fail.accept("mission needs starting capital");

    MissionRules rules = m.rules();
    if (rules.allowedOrderTypes().isEmpty()) fail.accept("at least one order type must be allowed");
    if (!(rules.feeBps() >= 0 && rules.feeBps() <= 500)) fail.accept("feeBps out of range");
    if (!(rules.minFee() >= 0)) fail.accept("minFee cannot be negative");

    Set<String> objectiveIds = new HashSet<>();
    for (ObjectiveDefinition o : m.objectives()) {
      if (objectiveIds.contains(o.id())) fail.accept("duplicate objective id " + o.id());
      objectiveIds.add(o.id());
      if ("REACT_TO_EVENT".equals(o.kind()) && !eventIds.contains(o.eventId())) {
        fail.accept("objective " + o.id() + ": unknown event " + o.eventId());
      }
      if ("MAX_POSITION_WEIGHT".equals(o.kind()) && (o.fromStep() < 0 || o.fromStep() > scenario.steps())) {
        fail.accept("objective " + o.id() + ": fromStep outside the mission");
      }
      if ("RUN_STRESS_TEST".equals(o.kind()) && (!rules.allowStressTest() || scenario.stressScenarios().isEmpty())) {
        fail.accept("objective " + o.id() + ": stress tests are not enabled");
      }
      if ("PROTECTIVE_STOP".equals(o.kind()) && !rules.allowedOrderTypes().contains("STOP")) {
        fail.accept("objective " + o.id() + ": STOP orders are not allowed");
      }
      if ("EXECUTE_ORDER".equals(o.kind()) && o.orderType() != null && !rules.allowedOrderTypes().contains(o.orderType())) {
        fail.accept("objective " + o.id() + ": order type not allowed");
      }
    }
    if (m.objectives().stream().noneMatch(ObjectiveDefinition::required)) {
      fail.accept("at least one objective must be required");
    }
    if (rules.allowStressTest() && scenario.stressScenarios().isEmpty()) {
      fail.accept("stress tests are enabled but no scenario is defined");
    }

    ScoringWeights w = m.scoring().weights();
    if (w.risk() < 0 || w.decision() < 0 || w.reasoning() < 0 || w.execution() < 0
        || w.risk() + w.decision() + w.reasoning() + w.execution() != 100) {
      fail.accept("scoring weights must be non-negative and sum to 100");
    }
    if (!(m.scoring().passThreshold() >= 0 && m.scoring().passThreshold() <= 100)) {
      fail.accept("passThreshold must be 0–100");
    }
    if (!(m.scoring().riskLimitPct() > 0)) fail.accept("riskLimitPct must be positive");
    if (m.competencies().isEmpty()) fail.accept("at least one competency is required");
    for (CompetencyWeight c : m.competencies()) {
      if (!Definitions.COMPETENCIES.contains(c.competency())) fail.accept("unknown competency " + c.competency());
      if (!(c.weight() > 0 && c.weight() <= 1)) fail.accept("competency " + c.competency() + ": weight must be in (0, 1]");
    }
    return errors;
  }

  public static List<String> validateCatalog(List<MissionDefinition> missions) {
    List<String> errors = new ArrayList<>();
    for (MissionDefinition m : missions) errors.addAll(validateMission(m));
    Set<String> slugs = new HashSet<>();
    Set<Integer> orders = new HashSet<>();
    for (MissionDefinition m : missions) {
      if (slugs.contains(m.slug())) errors.add("duplicate slug " + m.slug());
      if (orders.contains(m.order())) errors.add("duplicate order " + m.order());
      slugs.add(m.slug());
      orders.add(m.order());
    }
    for (String level : Definitions.LEVELS) {
      boolean implemented = missions.stream()
          .anyMatch(m -> m.level().equals(level) && "IMPLEMENTED".equals(m.availability()));
      if (!implemented) errors.add("level " + level + " has no implemented mission");
    }
    return errors;
  }
}
