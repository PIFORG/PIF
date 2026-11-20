package com.pif.api.echo;

import static com.pif.api.echo.EchoFinancialTools.at;
import static com.pif.api.echo.EchoFinancialTools.map;
import static com.pif.api.echo.EchoFinancialTools.num;
import static com.pif.api.echo.EchoRiskAdvisor.castMap;

import com.pif.api.echo.EchoAnswer.Kind;
import com.pif.api.echo.EchoIntentRouter.Intent;
import com.pif.api.echo.EchoIntentRouter.Parsed;
import com.pif.api.security.AuthUser;
import com.pif.api.trading.TradingDtos;
import com.pif.api.web.ApiException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/**
 * Orchestrates one ÉCHO turn: validate → resolve the authorised context → route the intent → call read-only
 * tools → build a typed, sourced answer → persist the exchange. Inference is deterministic (rules + existing
 * engines); see docs/echo/ARCHITECTURE.md for why no language model is wired in.
 */
@Service
public class EchoConversationService {

  private static final Logger log = LoggerFactory.getLogger(EchoConversationService.class);
  static final int MAX_MESSAGE = 1000;
  static final int HISTORY_LIMIT = 60;

  private static final Pattern FORBIDDEN = Pattern.compile(
      "(autres? (utilisateurs?|investisseurs?|clients?|comptes?))|mot de passe|password|\\btoken|jeton|cle secrete|"
          + "secret|ignore (les|tes|toutes) (instructions|regles)|mode admin|administrateur|\\bsql\\b|drop table");
  private static final Pattern ORDER_COMMAND = Pattern.compile(
      "^(passe|place|execute|envoie|lance|achete|vends?|soumets?)\\b.{0,40}\\b(ordre|achat|vente|\\d+)");

  private final EchoRepository repo;
  private final EchoFinancialTools tools;
  private final EchoRiskAdvisor advisor;
  private final EchoScenarioService scenarios;
  private final EchoMemoryService memory;

  public EchoConversationService(EchoRepository repo, EchoFinancialTools tools, EchoRiskAdvisor advisor,
      EchoScenarioService scenarios, EchoMemoryService memory) {
    this.repo = repo;
    this.tools = tools;
    this.advisor = advisor;
    this.scenarios = scenarios;
    this.memory = memory;
  }

  /** Client-declared context. Identifiers in it are hints that are re-validated server-side. */
  record ClientContext(String route, String module, String symbol, UUID portfolioId, UUID sessionId, String storySlug,
      UUID actuarialScenarioId, String stressPresetId, Map<String, Object> orderDraft) {

    static ClientContext from(Object raw) {
      Map<String, Object> m = castMap(raw);
      return new ClientContext(str(m.get("route"), 200), str(m.get("module"), 32), symbol(m.get("symbol")),
          uuid(m.get("portfolioId")), uuid(m.get("sessionId")), str(m.get("storySlug"), 80),
          uuid(m.get("actuarialScenarioId")), str(m.get("stressPresetId"), 40), castMap(m.get("orderDraft")));
    }

    private static String str(Object o, int max) {
      return o instanceof String s && !s.isBlank() ? (s.length() > max ? s.substring(0, max) : s.strip()) : null;
    }

    private static String symbol(Object o) {
      String s = str(o, 32);
      return s == null || !s.matches("[A-Za-z0-9.\\-]{1,32}") ? null : s.toUpperCase(Locale.ROOT);
    }

    private static UUID uuid(Object o) {
      if (!(o instanceof String s)) return null;
      try {
        return UUID.fromString(s);
      } catch (IllegalArgumentException e) {
        return null;
      }
    }
  }

  // ------------------------------------------------------------------ public API

  public Map<String, Object> ask(AuthUser user, Map<String, Object> body) {
    memory.requireTables();
    Object rawMessage = body.get("message");
    if (!(rawMessage instanceof String message) || message.isBlank()) {
      throw ApiException.validation(List.of("message est requis."));
    }
    if (message.length() > MAX_MESSAGE) {
      throw ApiException.validation(List.of("message : " + MAX_MESSAGE + " caractères maximum."));
    }
    ClientContext ctx = ClientContext.from(body.get("context"));
    EchoRepository.Conversation conv;
    if (body.get("conversationId") instanceof String cid && !cid.isBlank()) {
      conv = repo.conversation(user.id(), EchoMemoryService.parseUuid(cid)).orElseThrow(() ->
          new ApiException(HttpStatus.NOT_FOUND, "ECHO_CONVERSATION_NOT_FOUND", "Conversation introuvable."));
    } else {
      String title = message.strip().replaceAll("\\s+", " ");
      conv = repo.createConversation(user.id(), title.length() > 80 ? title.substring(0, 77) + "…" : title);
    }
    Map<String, Object> state = new LinkedHashMap<>(conv.state());
    long started = System.nanoTime();
    EchoAnswer answer;
    try {
      answer = respond(user, message, ctx, state);
    } catch (ApiException e) {
      answer = failure(e);
    } catch (RuntimeException e) {
      log.warn("ÉCHO: tool failure for intent routing", e);
      answer = new EchoAnswer("ERROR").status("ERROR")
          .text("Un service de la plateforme n'a pas répondu. Je préfère ne rien affirmer plutôt que de deviner : "
              + "réessayez dans un instant.");
    }
    answer.context.putIfAbsent("module", ctx.module());
    answer.context.put("latencyMs", Math.round((System.nanoTime() - started) / 1_000_000.0));
    state.put("lastIntent", answer.intent);
    repo.updateState(user.id(), conv.id(), state);
    Map<String, Object> json = answer.toJson();
    repo.addMessage(user.id(), conv.id(), "USER", message.strip(), null, map("context", contextJson(ctx)));
    repo.addMessage(user.id(), conv.id(), "ECHO", answer.answer == null ? "" : answer.answer, answer.intent, json);
    return map("conversationId", conv.id().toString(), "title", conv.title(), "message", json);
  }

  /** Dedicated pre-trade endpoint (order ticket). Read-only; never submits. */
  public Map<String, Object> preTrade(AuthUser user, Map<String, Object> body) {
    Object pid = body.get("portfolioId");
    if (!(pid instanceof String s)) throw ApiException.validation(List.of("portfolioId est requis."));
    TradingDtos.OrderTerms terms = EchoRiskAdvisor.terms(castMap(body.get("orderDraft")));
    if (terms == null) throw ApiException.validation(List.of("orderDraft doit contenir symbol, side et quantity > 0."));
    try {
      return advisor.analyse(user, EchoMemoryService.parseUuid(s), terms).toJson();
    } catch (ApiException e) {
      if (e.status() == HttpStatus.NOT_FOUND) throw e;
      return failure(e).toJson();
    }
  }

  public Map<String, Object> conversations(AuthUser user) {
    memory.requireTables();
    return map("conversations", repo.conversations(user.id()));
  }

  public Map<String, Object> conversation(AuthUser user, UUID id) {
    memory.requireTables();
    var c = repo.conversation(user.id(), id).orElseThrow(() ->
        new ApiException(HttpStatus.NOT_FOUND, "ECHO_CONVERSATION_NOT_FOUND", "Conversation introuvable."));
    return map("id", c.id().toString(), "title", c.title(), "createdAt", com.pif.api.data.Db.iso(c.createdAt()),
        "messages", repo.messages(user.id(), id, HISTORY_LIMIT));
  }

  public void deleteConversation(AuthUser user, UUID id) {
    memory.requireTables();
    if (!repo.deleteConversation(user.id(), id)) {
      throw new ApiException(HttpStatus.NOT_FOUND, "ECHO_CONVERSATION_NOT_FOUND", "Conversation introuvable.");
    }
  }

  public Map<String, Object> deleteAll(AuthUser user) {
    memory.requireTables();
    return map("deleted", repo.deleteAllConversations(user.id()));
  }

  private static Map<String, Object> contextJson(ClientContext c) {
    return map("route", c.route(), "module", c.module(), "symbol", c.symbol(),
        "portfolioId", c.portfolioId() == null ? null : c.portfolioId().toString(),
        "sessionId", c.sessionId() == null ? null : c.sessionId().toString(), "storySlug", c.storySlug());
  }

  private static EchoAnswer failure(ApiException e) {
    if (e.status() == HttpStatus.NOT_FOUND) {
      return new EchoAnswer("NOT_FOUND").status("NO_DATA").text("Je n'ai pas trouvé cet élément parmi les données "
          + "auxquelles vous avez accès. " + e.getMessage());
    }
    return new EchoAnswer("ENGINE_REFUSAL").status("PARTIAL")
        .text("Le moteur de la plateforme a refusé le calcul : " + e.getMessage());
  }

  // ------------------------------------------------------------------ routing

  EchoAnswer respond(AuthUser user, String message, ClientContext ctx, Map<String, Object> state) {
    Parsed p = EchoIntentRouter.parse(message);
    if (FORBIDDEN.matcher(p.normalized()).find()) return refusal();
    if (ORDER_COMMAND.matcher(p.normalized()).find()) return noAutonomousOrder(ctx);
    Intent intent = contextual(p.intent(), ctx);
    return switch (intent) {
      case GREETING, HELP -> help(ctx);
      case CONCEPT -> concept(p, user);
      case PORTFOLIO_PERFORMANCE, PORTFOLIO_EXPOSURE, PORTFOLIO_RISK, ORDER_REJECTION, STRESS_SCENARIO, WHATIF_SELL ->
          withPortfolio(user, ctx, state, intent, pid -> portfolioIntent(user, pid, intent, p, ctx, state));
      case PRETRADE -> preTradeIntent(user, ctx, state);
      case COMPARE_BEFORE_AFTER -> scenarios.beforeAfter(state);
      case ALTERNATIVE -> alternative(user, ctx, state);
      case INSTRUMENT_ANALYSIS -> withSymbol(p, ctx, state, s -> instrument(user, s, state));
      case COMPARE_INSTRUMENTS -> compare(p, state);
      case CRISIS -> crisis(p, ctx, state);
      case FORECAST -> forecast();
      case MISSION_REVIEW -> mission(user, ctx, state);
      case STORY -> story(user, ctx);
      case ACTUARIAL -> actuarial(user, ctx);
      case BANK_STRESS -> bank(ctx, p);
      case JOURNAL -> journal(user);
      case NEWS -> news();
      case DATA_COVERAGE -> coverage();
      case UNKNOWN -> unknown(ctx);
    };
  }

  /** When the wording is ambiguous, the page the user is on decides — never a random portfolio or mission. */
  static Intent contextual(Intent intent, ClientContext ctx) {
    if (intent != Intent.UNKNOWN) return intent;
    String module = ctx.module() == null ? "" : ctx.module();
    return switch (module) {
      case "MISSION", "MARKETQUEST" -> Intent.MISSION_REVIEW;
      case "STORIES" -> Intent.STORY;
      case "ACTUARIAL" -> Intent.ACTUARIAL;
      case "STRESS" -> Intent.BANK_STRESS;
      case "TRADING", "MARKETS" -> ctx.orderDraft().isEmpty()
          ? (ctx.symbol() != null ? Intent.INSTRUMENT_ANALYSIS : Intent.UNKNOWN) : Intent.PRETRADE;
      case "PORTFOLIOS", "RISK" -> Intent.PORTFOLIO_RISK;
      default -> Intent.UNKNOWN;
    };
  }

  private EchoAnswer refusal() {
    return new EchoAnswer("REFUSED").status("REFUSED")
        .text("Je ne peux pas faire cela. ÉCHO n'accède qu'à vos propres données, en lecture seule, et ne révèle ni "
            + "secrets, ni informations sur d'autres investisseurs, ni détails techniques internes.")
        .limitation("Les permissions sont vérifiées par le serveur à chaque appel d'outil.");
  }

  private EchoAnswer noAutonomousOrder(ClientContext ctx) {
    EchoAnswer a = new EchoAnswer("ORDER_REQUEST").status("REFUSED")
        .text("Je ne passe jamais d'ordre à votre place. Je peux en revanche examiner le risque d'un ordre que vous "
            + "préparez dans le ticket, puis vous le confirmez vous-même.");
    a.navigate("Ouvrir le ticket d'ordre", "/trading");
    if (!ctx.orderDraft().isEmpty()) a.ask("Examiner le risque de cet ordre", "Examiner le risque de cet ordre");
    return a;
  }

  // ------------------------------------------------------------------ context resolution

  interface PortfolioHandler {
    EchoAnswer handle(UUID portfolioId);
  }

  EchoAnswer withPortfolio(AuthUser user, ClientContext ctx, Map<String, Object> state, Intent intent,
      PortfolioHandler handler) {
    UUID chosen = ctx.portfolioId();
    if (chosen == null && state.get("portfolioId") instanceof String s) chosen = UUID.fromString(s);
    if (chosen != null) {
      try {
        tools.portfolio(user, chosen); // ownership check (404 for someone else's id)
      } catch (ApiException e) {
        chosen = null;
        state.remove("portfolioId");
      }
    }
    if (chosen == null) {
      List<Map<String, Object>> list = tools.portfolioList(user);
      if (list.isEmpty()) {
        EchoAnswer a = new EchoAnswer(intent.name()).status("NO_DATA")
            .text("Vous n'avez pas encore de portefeuille virtuel : il n'y a rien à analyser pour l'instant.");
        a.tool("portfolio.list");
        return a.navigate("Créer un portefeuille", "/portfolios");
      }
      if (list.size() > 1) {
        EchoAnswer a = new EchoAnswer(intent.name());
        a.tool("portfolio.list");
        return a.clarify("Quel portefeuille voulez-vous que j'analyse ?", list.stream()
            .map(pf -> map("label", pf.get("name"), "context", map("portfolioId", pf.get("id")))).toList())
            .text("Vous avez " + list.size() + " portefeuilles. Lequel dois-je analyser ?");
      }
      chosen = UUID.fromString(String.valueOf(list.getFirst().get("id")));
    }
    state.put("portfolioId", chosen.toString());
    EchoAnswer a = handler.handle(chosen);
    a.context.put("portfolioId", chosen.toString());
    return a;
  }

  interface SymbolHandler {
    EchoAnswer handle(String symbol);
  }

  /** Symbol from the message, else the selected instrument, else the last one discussed (only if referenced). */
  EchoAnswer withSymbol(Parsed p, ClientContext ctx, Map<String, Object> state, SymbolHandler handler) {
    for (String s : p.symbolCandidates()) {
      if (tools.instrument(s).isPresent()) return handler.handle(s);
    }
    if (ctx.symbol() != null && tools.instrument(ctx.symbol()).isPresent()) return handler.handle(ctx.symbol());
    if (p.refersToPrevious() && state.get("symbol") instanceof String s) return handler.handle(s);
    EchoAnswer a = new EchoAnswer("INSTRUMENT_ANALYSIS");
    if (!p.symbolCandidates().isEmpty()) {
      return a.status("NO_DATA").text("Je ne trouve pas « " + p.symbolCandidates().getFirst()
          + " » dans le catalogue d'instruments de Market Trading Room.").navigate("Parcourir les marchés", "/markets");
    }
    return a.clarify("Quel instrument voulez-vous analyser ?", List.of())
        .text("Indiquez le symbole de l'instrument (par exemple depuis la page Marchés), ou sélectionnez-le avant "
            + "d'ouvrir ÉCHO.").navigate("Parcourir les marchés", "/markets");
  }

  // ------------------------------------------------------------------ portfolio intents

  EchoAnswer portfolioIntent(AuthUser user, UUID pid, Intent intent, Parsed p, ClientContext ctx,
      Map<String, Object> state) {
    return switch (intent) {
      case STRESS_SCENARIO -> scenarios.shock(user, pid, p.percent() == null ? 10 : p.percent(),
          p.normalized().contains("hausse"));
      case WHATIF_SELL -> {
        String symbol = p.symbolCandidates().stream().findFirst()
            .orElse(state.get("symbol") instanceof String s ? s : ctx.symbol());
        if (symbol == null) {
          Map<String, Object> pf = tools.portfolio(user, pid);
          yield new EchoAnswer("WHATIF_SELL").clarify("Quelle position voulez-vous alléger ?",
              EchoScenarioService.positions(pf).stream().map(pos -> map("label", pos.get("symbol"),
                  "message", "Et si je vendais la moitié de " + pos.get("symbol") + " ?")).toList())
              .text("De quelle position parlez-vous ?");
        }
        state.put("symbol", symbol);
        double fraction = p.fraction() != null ? p.fraction() : p.percent() != null ? p.percent() / 100 : 0.5;
        yield scenarios.sellFraction(user, pid, symbol, Math.min(1, fraction), state);
      }
      case ORDER_REJECTION -> rejection(user, pid);
      case PORTFOLIO_EXPOSURE -> exposure(user, pid, state);
      case PORTFOLIO_RISK -> risk(user, pid, state);
      default -> performance(user, pid);
    };
  }

  EchoAnswer performance(AuthUser user, UUID pid) {
    EchoAnswer a = new EchoAnswer("PORTFOLIO_PERFORMANCE");
    Map<String, Object> pf = tools.portfolio(user, pid);
    Map<String, Object> an = tools.analytics(user, pid);
    a.tool("portfolio.get").tool("portfolio.analytics");
    String ccy = String.valueOf(pf.get("baseCurrency"));
    a.asOf(String.valueOf(pf.get("asOf")));
    a.source("Portefeuilles", "Valorisation au milieu de fourchette ; performance reconstruite depuis le journal",
        castMap(an.get("provenance")));
    Double equity = num(pf.get("equity"));
    Double contrib = num(pf.get("netContributions"));
    Double profit = num(pf.get("profit"));
    Double twr = num(at(an, "performance", "timeWeightedReturn"));
    Double mwr = num(at(an, "performance", "moneyWeightedReturn"));
    a.evidence(Kind.OBSERVED, "Capitaux propres", equity, ccy, "Portefeuilles");
    a.evidence(Kind.OBSERVED, "Apports nets", contrib, ccy, "Journal de trésorerie");
    a.evidence(Kind.CALCULATED, "Résultat (capitaux − apports)", profit, ccy, "Portefeuilles");
    a.evidence(Kind.CALCULATED, "Plus-values réalisées", num(pf.get("realizedPnl")), ccy, "Grand livre");
    a.evidence(Kind.CALCULATED, "Plus-values latentes", num(pf.get("unrealizedPnl")), ccy, "Valorisation au milieu");
    a.evidence(Kind.CALCULATED, "Frais payés", num(pf.get("feesPaid")), ccy, "Grand livre");
    a.evidence(Kind.CALCULATED, "Rendement pondéré par le temps", twr, "ratio", "Analytics (TWR)");
    a.evidence(Kind.CALCULATED, "Rendement pondéré par les flux", mwr, "ratio", "Analytics (MWR)");
    String twrReason = (String) at(an, "performance", "timeWeightedReturn", "unavailableReason");
    if (twr == null && twrReason != null) {
      a.status("PARTIAL").limitation("Rendement pondéré par le temps indisponible : " + twrReason);
    }
    String text = "« " + pf.get("name") + " » vaut " + EchoFormat.money(equity, ccy) + " pour "
        + EchoFormat.money(contrib, ccy) + " d'apports nets, soit un résultat de " + EchoFormat.money(profit, ccy)
        + (contrib != null && contrib > 0 && profit != null ? " (" + EchoFormat.signedPct(profit / contrib) + ")" : "")
        + ". Dont " + EchoFormat.money(num(pf.get("realizedPnl")), ccy) + " réalisés, "
        + EchoFormat.money(num(pf.get("unrealizedPnl")), ccy) + " latents et "
        + EchoFormat.money(num(pf.get("feesPaid")), ccy) + " de frais."
        + (twr == null ? "" : " Rendement pondéré par le temps : " + EchoFormat.signedPct(twr) + ".");
    a.text(text);
    a.ask("Analyser mon exposition", "Quels actifs représentent ma plus grande exposition ?");
    a.ask("Expliquer mon risque", "Pourquoi mon risque est-il à ce niveau ?");
    return a.navigate("Ouvrir Portefeuilles", "/portfolios");
  }

  EchoAnswer exposure(AuthUser user, UUID pid, Map<String, Object> state) {
    EchoAnswer a = new EchoAnswer("PORTFOLIO_EXPOSURE");
    Map<String, Object> pf = tools.portfolio(user, pid);
    a.tool("portfolio.get");
    String ccy = String.valueOf(pf.get("baseCurrency"));
    a.asOf(String.valueOf(pf.get("asOf")));
    List<Map<String, Object>> pos = EchoScenarioService.positions(pf);
    if (pos.isEmpty()) {
      return a.status("NO_DATA").text("« " + pf.get("name") + " » est entièrement en liquidités : aucune exposition "
          + "de marché.").navigate("Ouvrir le Trading", "/trading");
    }
    Map<String, Object> conc = EchoMemoryService.concentration(pf);
    Map<String, Double> sectors = new LinkedHashMap<>();
    Double equity = num(pf.get("equity"));
    for (Map<String, Object> p : pos) sectors.merge(String.valueOf(p.get("sector")), num(p.get("marketValue")), Double::sum);
    List<Map<String, Object>> rows = new ArrayList<>();
    for (Map<String, Object> p : pos.subList(0, Math.min(5, pos.size()))) {
      rows.add(map("label", p.get("symbol") + " — " + p.get("name"), "value", p.get("marketValue"), "weight", p.get("weight")));
      a.evidence(Kind.CALCULATED, "Poids " + p.get("symbol"), num(p.get("weight")), "ratio",
          "Valeur de marché / capitaux propres");
    }
    String top = String.valueOf(pos.getFirst().get("symbol"));
    state.put("symbol", top);
    var topSector = sectors.entrySet().stream().max(Map.Entry.comparingByValue()).orElseThrow();
    a.evidence(Kind.CALCULATED, "Positions effectives (1/HHI)", num(conc.get("effectiveHoldings")), null, "RiskStudio.snapshot");
    a.evidence(Kind.CALCULATED, "Secteur principal : " + topSector.getKey(),
        equity != null && equity > 0 ? topSector.getValue() / equity : null, "ratio", "Somme par secteur");
    a.evidence(Kind.OBSERVED, "Plafond par ligne", num(pf.get("maxPositionWeightPct")), "%", "Règle du portefeuille");
    a.chart("bar", "Poids des principales lignes", pos.subList(0, Math.min(8, pos.size())).stream()
        .map(p -> map("x", p.get("symbol"), "y", p.get("weight"))).toList(), "ratio");
    Double w = num(pos.getFirst().get("weight"));
    a.text("Votre plus grande exposition est " + top + " (" + EchoFormat.pct(w) + " des capitaux). Le secteur « "
        + topSector.getKey() + " » pèse " + EchoFormat.pct(equity > 0 ? topSector.getValue() / equity : null)
        + ". Avec " + pos.size() + " lignes, le portefeuille équivaut à " + EchoFormat.num(num(conc.get("effectiveHoldings")), 1)
        + " positions de même poids (1/HHI)." + (w != null && w >= EchoAlertService.CONCENTRATION_HIGH
            ? " Une seule ligne au-delà de 40 % rend le portefeuille très dépendant de ce titre." : ""));
    a.ask("Et si je vendais la moitié ?", "Et si je vendais la moitié de cette position ?");
    a.ask("Qu'est-ce que le HHI ?", "Qu'est-ce que le HHI ?");
    return a.navigate("Voir la diversification", "/risk");
  }

  @SuppressWarnings("unchecked")
  EchoAnswer risk(AuthUser user, UUID pid, Map<String, Object> state) {
    EchoAnswer a = new EchoAnswer("PORTFOLIO_RISK");
    Map<String, Object> an = tools.analytics(user, pid);
    a.tool("portfolio.analytics");
    String ccy = String.valueOf(an.getOrDefault("currency", "TND"));
    a.asOf(String.valueOf(an.get("asOf")));
    a.source("Risques", "VaR / ES historiques sur rendements quotidiens observés", castMap(an.get("provenance")));
    Map<String, Object> risk = castMap(an.get("risk"));
    Double var = num(risk.get("valueAtRisk95"));
    Double es = num(risk.get("expectedShortfall95"));
    Double vol = num(risk.get("realizedVolatilityAnnualized"));
    Double dd = num(risk.get("maxDrawdown"));
    Object obs = risk.get("observations");
    a.evidence(Kind.CALCULATED, "VaR historique 95 %", var, ccy, "Analytics, " + obs + " observations");
    a.evidence(Kind.CALCULATED, "Expected Shortfall 95 %", es, ccy, "Analytics");
    a.evidence(Kind.CALCULATED, "Volatilité réalisée annualisée", vol, "ratio", "Analytics");
    a.evidence(Kind.CALCULATED, "Drawdown maximal", dd, "ratio", "Courbe de capitaux");
    if (var == null) {
      String reason = (String) castMap(risk.get("valueAtRisk95")).get("unavailableReason");
      a.status("PARTIAL").limitation("VaR indisponible : " + (reason == null ? "historique insuffisant." : reason));
    }
    Map<String, Object> contrib = castMap(an.get("riskContributions"));
    List<Map<String, Object>> by = (List<Map<String, Object>>) contrib.getOrDefault("byInstrument", List.of());
    List<Map<String, Object>> sorted = new ArrayList<>(by);
    sorted.sort(Comparator.comparingDouble(r -> -Math.abs(Optional.ofNullable(num(r.get("shareOfTailLoss"))).orElse(0.0))));
    List<String> lines = new ArrayList<>();
    lines.add(var == null ? "Je ne peux pas chiffrer la VaR de ce portefeuille : l'historique des positions est insuffisant."
        : "Votre VaR historique à 95 % est de " + EchoFormat.money(Math.abs(var), ccy)
            + " : sur l'échantillon observé, une journée sur vingt a fait pire. La perte moyenne de ces pires journées "
            + "(Expected Shortfall) est de " + EchoFormat.money(es == null ? null : Math.abs(es), ccy) + ".");
    if (!sorted.isEmpty() && num(sorted.getFirst().get("shareOfTailLoss")) != null) {
      Map<String, Object> top = sorted.getFirst();
      state.put("symbol", top.get("symbol"));
      a.evidence(Kind.CALCULATED, "Part des pertes extrêmes due à " + top.get("symbol"), num(top.get("shareOfTailLoss")),
          "ratio", "RiskStudio.riskContributions (contribution à la queue)");
      lines.add(top.get("symbol") + " explique " + EchoFormat.pct(num(top.get("shareOfTailLoss")))
          + " des pertes des pires journées : c'est le premier contributeur au risque.");
      a.chart("bar", "Contribution aux pertes extrêmes", sorted.stream().limit(8)
          .map(r -> map("x", r.get("symbol"), "y", r.get("shareOfTailLoss"))).toList(), "ratio");
    }
    List<Map<String, Object>> recent = tools.executions(user, pid, 5);
    a.tool("portfolio.executions");
    if (!recent.isEmpty()) {
      Map<String, Object> e = recent.getFirst();
      a.evidence(Kind.OBSERVED, "Dernière exécution", map("side", e.get("side"), "symbol", e.get("symbol"),
          "quantity", e.get("quantity"), "executedAt", e.get("executedAt")), null, "Journal des exécutions");
      lines.add("Votre dernière opération est " + ("BUY".equals(e.get("side")) ? "un achat" : "une vente") + " de "
          + EchoFormat.num(num(e.get("quantity")), 0) + " " + e.get("symbol") + " le "
          + EchoFormat.day(String.valueOf(e.get("executedAt"))) + ".");
    }
    a.limitation("ÉCHO ne conserve pas d'historique de VaR : pour expliquer une hausse, il s'appuie sur la composition "
        + "actuelle du risque et vos dernières opérations.");
    a.text(String.join(" ", lines));
    a.ask("Simuler une baisse de 10 %", "Quel serait l'impact d'une baisse simulée de 10 % ?");
    a.ask("Qu'est-ce que la VaR ?", "Explique-moi ce que signifie la VaR.");
    return a.navigate("Ouvrir Risques", "/risk");
  }

  EchoAnswer rejection(AuthUser user, UUID pid) {
    EchoAnswer a = new EchoAnswer("ORDER_REJECTION");
    List<Map<String, Object>> orders = tools.orders(user, pid, "all", 20);
    a.tool("portfolio.orders");
    Map<String, Object> rejected = orders.stream().filter(o -> "REJECTED".equals(o.get("status"))).findFirst().orElse(null);
    if (rejected == null) {
      return a.status("NO_DATA").text("Aucun ordre rejeté parmi vos 20 derniers ordres sur ce portefeuille.");
    }
    String code = String.valueOf(rejected.get("rejectionCode"));
    a.evidence(Kind.OBSERVED, "Ordre rejeté", map("symbol", rejected.get("symbol"), "side", rejected.get("side"),
        "quantity", rejected.get("quantity"), "submittedAt", rejected.get("submittedAt")), null, "Journal des ordres");
    a.evidence(Kind.OBSERVED, "Code de rejet", code, null, "Moteur d'ordres");
    String why = switch (code) {
      case "INSUFFICIENT_CASH" -> "les liquidités disponibles ne couvraient pas le montant et les frais (les ordres limités "
          + "en attente réservent aussi des liquidités)";
      case "INSUFFICIENT_POSITION" -> "la quantité vendue dépassait la quantité détenue";
      case "POSITION_LIMIT" -> "la ligne aurait dépassé le plafond de poids fixé pour ce portefeuille";
      default -> "le contrôle « " + code + " » du moteur";
    };
    return a.text("Votre ordre " + ("BUY".equals(rejected.get("side")) ? "d'achat" : "de vente") + " de "
        + EchoFormat.num(num(rejected.get("quantity")), 0) + " " + rejected.get("symbol") + " (soumis le "
        + EchoFormat.day(String.valueOf(rejected.get("submittedAt"))) + ") a été rejeté parce que " + why + "."
        + (rejected.get("statusReason") == null ? "" : " Détail enregistré : " + rejected.get("statusReason") + "."))
        .navigate("Retour au ticket", "/trading");
  }

  EchoAnswer preTradeIntent(AuthUser user, ClientContext ctx, Map<String, Object> state) {
    TradingDtos.OrderTerms terms = EchoRiskAdvisor.terms(ctx.orderDraft());
    if (terms == null) {
      return new EchoAnswer("PRETRADE").clarify("Quel ordre voulez-vous examiner ?", List.of())
          .text("Je n'ai pas d'ordre en préparation. Renseignez le ticket (instrument, sens, quantité) dans Trading, "
              + "puis demandez-moi d'examiner son risque.").navigate("Ouvrir le ticket", "/trading");
    }
    state.put("symbol", terms.symbol());
    return withPortfolio(user, ctx, state, Intent.PRETRADE, pid -> advisor.analyse(user, pid, terms));
  }

  EchoAnswer alternative(AuthUser user, ClientContext ctx, Map<String, Object> state) {
    if (ctx.sessionId() != null || "MISSION".equals(ctx.module()) || "MARKETQUEST".equals(ctx.module())) {
      UUID sid = ctx.sessionId() != null ? ctx.sessionId() : latestEndedMission(user);
      if (sid == null) {
        return new EchoAnswer("ALTERNATIVE").status("NO_DATA")
            .text("Aucune mission terminée : la Machine à remonter le temps a besoin d'une session achevée.");
      }
      return scenarios.missionHold(user, sid);
    }
    return withPortfolio(user, ctx, state, Intent.ALTERNATIVE, pid -> scenarios.undoLastExecution(user, pid));
  }

  // ------------------------------------------------------------------ market

  EchoAnswer instrument(AuthUser user, String symbol, Map<String, Object> state) {
    EchoAnswer a = new EchoAnswer("INSTRUMENT_ANALYSIS");
    Map<String, Object> inst = tools.instrument(symbol).orElseThrow();
    a.tool("market.instrument").tool("market.history");
    state.put("symbol", symbol);
    pushSymbol(state, symbol);
    a.context.put("symbol", symbol);
    String ccy = String.valueOf(inst.getOrDefault("quoteCurrency", inst.get("currency")));
    String kind = String.valueOf(inst.get("dataKind"));
    Map<String, Object> quote = castMap(inst.get("quote"));
    Double mid = num(quote.get("mid"));
    String asOf = (String) (inst.get("observationAsOf") != null ? inst.get("observationAsOf") : quote.get("asOf"));
    a.asOf(asOf);
    a.source("Marchés", "FICTIONAL".equals(kind) ? "Simulateur de marché fictif" : "Clôtures historiques de l'entrepôt",
        castMap(inst.get("provenance")));
    a.evidence(Kind.OBSERVED, "FICTIONAL".equals(kind) ? "Cotation simulée" : "Dernière clôture disponible", mid, ccy,
        EchoFormat.day(asOf));
    a.evidence(Kind.CALCULATED, "Variation vs clôture précédente", num(inst.get("changePct")), "ratio", "Marchés");
    var points = tools.history(symbol, "6M");
    var stats = EchoFinancialTools.stats(points);
    List<String> lines = new ArrayList<>();
    lines.add(symbol + " — " + inst.get("name") + " (" + inst.get("assetClass") + ", " + inst.get("sector") + ").");
    if ("FICTIONAL".equals(kind)) {
      lines.add("C'est un instrument pédagogique fictif : ses prix viennent du simulateur, pas d'un marché réel.");
    } else {
      lines.add("Prix affiché : dernière clôture disponible au " + EchoFormat.day(asOf) + ", ce n'est pas un cours en direct.");
      a.limitation("Données historiques de séance : pas de cotation temps réel.");
    }
    if (stats.isPresent()) {
      var s = stats.get();
      a.evidence(Kind.CALCULATED, "Performance sur la période", s.returnPct(), "ratio",
          EchoFormat.day(s.from()) + " → " + EchoFormat.day(s.to()) + " (" + s.observations() + " obs.)");
      a.evidence(Kind.CALCULATED, "Volatilité annualisée", s.annualVol(), "ratio", "Écart-type quotidien × √252");
      a.evidence(Kind.CALCULATED, "Drawdown maximal", s.maxDrawdown(), "ratio", "Risk.maxDrawdown");
      lines.add("Du " + EchoFormat.day(s.from()) + " au " + EchoFormat.day(s.to()) + " : " + EchoFormat.signedPct(s.returnPct())
          + ", volatilité annualisée " + EchoFormat.pct(s.annualVol()) + ", baisse maximale " + EchoFormat.pct(s.maxDrawdown()) + ".");
      int step = Math.max(1, points.size() / 60);
      List<Map<String, Object>> chart = new ArrayList<>();
      for (int i = 0; i < points.size(); i += step) chart.add(map("x", points.get(i).get("at"), "y", points.get(i).get("mid")));
      a.chart("line", symbol + " — " + EchoFormat.day(s.from()) + " → " + EchoFormat.day(s.to()), chart, ccy);
    } else {
      a.status("PARTIAL").limitation("Historique insuffisant pour calculer volatilité et drawdown.");
      lines.add("L'historique disponible est trop court pour mesurer sa volatilité.");
    }
    if (Boolean.FALSE.equals(inst.get("tradable"))) lines.add("Cet instrument n'est pas négociable dans le simulateur.");
    a.text(String.join(" ", lines));
    a.ask("Comportement en crise", "Que s'est-il passé sur ce titre pendant la crise de 2020 ?");
    a.navigate("Préparer un ordre", "/trading");
    return a;
  }

  @SuppressWarnings("unchecked")
  private static void pushSymbol(Map<String, Object> state, String symbol) {
    List<String> recent = state.get("recentSymbols") instanceof List<?> l ? new ArrayList<>((List<String>) l) : new ArrayList<>();
    recent.remove(symbol);
    recent.addFirst(symbol);
    while (recent.size() > 4) recent.removeLast();
    state.put("recentSymbols", recent);
  }

  @SuppressWarnings("unchecked")
  EchoAnswer compare(Parsed p, Map<String, Object> state) {
    EchoAnswer a = new EchoAnswer("COMPARE_INSTRUMENTS");
    List<String> symbols = new ArrayList<>();
    for (String s : p.symbolCandidates()) if (tools.instrument(s).isPresent() && !symbols.contains(s)) symbols.add(s);
    if (symbols.size() < 2 && state.get("recentSymbols") instanceof List<?> l) {
      for (String s : (List<String>) l) if (symbols.size() < 2 && !symbols.contains(s)) symbols.add(s);
    }
    if (symbols.size() < 2) {
      return a.clarify("Quels instruments comparer ?", List.of())
          .text("Donnez-moi deux symboles, par exemple « Compare la volatilité de A et B ».");
    }
    a.tool("market.instrument").tool("market.history");
    List<Map<String, Object>> rows = new ArrayList<>();
    List<String> lines = new ArrayList<>();
    for (String s : symbols.subList(0, 2)) {
      var stats = EchoFinancialTools.stats(tools.history(s, "6M"));
      pushSymbol(state, s);
      if (stats.isEmpty()) {
        lines.add(s + " : historique insuffisant.");
        a.status("PARTIAL");
        continue;
      }
      var st = stats.get();
      rows.add(map("label", s, "returnPct", st.returnPct(), "annualVol", st.annualVol(), "maxDrawdown", st.maxDrawdown(),
          "observations", st.observations(), "from", EchoFormat.day(st.from()), "to", EchoFormat.day(st.to())));
      a.evidence(Kind.CALCULATED, "Volatilité annualisée " + s, st.annualVol(), "ratio",
          st.observations() + " obs., " + EchoFormat.day(st.from()) + " → " + EchoFormat.day(st.to()));
      lines.add(s + " : volatilité " + EchoFormat.pct(st.annualVol()) + ", performance " + EchoFormat.signedPct(st.returnPct())
          + ", baisse maximale " + EchoFormat.pct(st.maxDrawdown()) + ".");
      a.asOf(st.to());
    }
    if (rows.size() == 2) {
      Double v0 = num(rows.get(0).get("annualVol"));
      Double v1 = num(rows.get(1).get("annualVol"));
      if (v0 != null && v1 != null) {
        lines.add((v0 > v1 ? rows.get(0).get("label") : rows.get(1).get("label")) + " a été le plus volatil sur la période.");
      }
      if (!rows.get(0).get("from").equals(rows.get(1).get("from"))) {
        a.limitation("Les deux séries ne couvrent pas exactement la même période.");
      }
    }
    a.scenario(map("kind", "COMPARISON", "hypothetical", false, "label", "Comparaison sur 6 mois", "rows", rows));
    return a.text(String.join(" ", lines));
  }

  @SuppressWarnings("unchecked")
  EchoAnswer crisis(Parsed p, ClientContext ctx, Map<String, Object> state) {
    EchoAnswer a = new EchoAnswer("CRISIS");
    Map<String, Object> c = tools.crises();
    a.tool("market.crises");
    List<Map<String, Object>> episodes = (List<Map<String, Object>>) c.getOrDefault("episodes", List.of());
    if (episodes.isEmpty()) {
      return a.status("NO_DATA").text("Les épisodes de crise historiques ne sont pas disponibles sur cette base de "
          + "données (entrepôt de données de marché non installé). Je ne reconstruirai pas une crise de mémoire.")
          .limitation("Entrepôt historique absent : tables market_* non migrées sur cet environnement.");
    }
    Map<String, Object> ep = null;
    if (p.year() != null) {
      for (Map<String, Object> e : episodes) {
        int y0 = LocalDate.parse(String.valueOf(e.get("startDate"))).getYear();
        int y1 = LocalDate.parse(String.valueOf(e.get("endDate"))).getYear();
        if (p.year() >= y0 && p.year() <= y1) ep = e;
      }
    }
    if (ep == null) {
      return a.clarify("Quelle crise voulez-vous étudier ?", episodes.stream().map(e -> map("label", e.get("title")
          + " (" + e.get("startDate") + " → " + e.get("endDate") + ")", "message",
          "Que s'est-il passé pendant la crise de " + String.valueOf(e.get("startDate")).substring(0, 4) + " ?")).toList())
          .text(p.year() == null ? "Voici les " + episodes.size() + " épisodes de crise enregistrés."
              : "Aucun épisode enregistré ne couvre " + p.year() + ". Voici ceux disponibles.");
    }
    LocalDate start = LocalDate.parse(String.valueOf(ep.get("startDate")));
    LocalDate end = LocalDate.parse(String.valueOf(ep.get("endDate")));
    a.evidence(Kind.OBSERVED, "Épisode", ep.get("title"), null, start + " → " + end);
    String symbol = p.symbolCandidates().stream().filter(s -> tools.instrument(s).isPresent()).findFirst()
        .orElse(p.refersToPrevious() && state.get("symbol") instanceof String s ? s : ctx.symbol());
    List<String> lines = new ArrayList<>();
    lines.add("Épisode « " + ep.get("title") + " » du " + start + " au " + end + "."
        + (ep.get("summary") == null ? "" : " " + ep.get("summary")));
    if (symbol != null) {
      Map<String, Object> inst = tools.instrument(symbol).orElse(Map.of());
      String source = (String) castMap(inst.get("coverage")).get("sourceSymbol");
      var bars = tools.crisisBars(source, start, end);
      a.tool("market.crisisBars");
      if (bars.size() >= 2) {
        double first = bars.getFirst().close();
        double last = bars.getLast().close();
        double[] closes = bars.stream().mapToDouble(b -> b.close()).toArray();
        double dd = com.pif.api.finance.Risk.maxDrawdown(closes);
        a.evidence(Kind.CALCULATED, symbol + " sur l'épisode", last / first - 1, "ratio",
            bars.size() + " séances, " + bars.getFirst().sessionDate() + " → " + bars.getLast().sessionDate());
        a.evidence(Kind.CALCULATED, "Baisse maximale " + symbol, dd, "ratio", "Risk.maxDrawdown sur les clôtures");
        lines.add(symbol + " : " + EchoFormat.signedPct(last / first - 1) + " entre le " + bars.getFirst().sessionDate()
            + " et le " + bars.getLast().sessionDate() + ", avec une baisse maximale de " + EchoFormat.pct(dd)
            + " (" + bars.size() + " séances observées).");
        a.chart("line", symbol + " pendant « " + ep.get("title") + " »", bars.stream()
            .map(b -> map("x", b.sessionDate().toString(), "y", b.close() / 1000.0)).toList(), null);
      } else {
        a.status("PARTIAL");
        lines.add("Je n'ai pas d'observations de " + symbol + " sur cette période : l'instrument n'était pas couvert "
            + "(ou est fictif). Je ne fabrique pas de série.");
      }
    } else {
      lines.add("Précisez un instrument pour mesurer son comportement pendant cet épisode.");
    }
    a.limitation("Un comportement passé en crise n'indique pas le comportement lors d'une prochaine crise.");
    return a.text(String.join(" ", lines));
  }

  // ------------------------------------------------------------------ AI models

  @SuppressWarnings("unchecked")
  EchoAnswer forecast() {
    EchoAnswer a = new EchoAnswer("FORECAST");
    Map<String, Object> card = tools.aiModel("market-return-gbm");
    a.tool("ai.model");
    Map<String, Object> test = castMap(at(card, "metrics", "test"));
    Map<String, Object> base = castMap(at(card, "metrics", "baselineMeanTest"));
    Double r2 = num(test.get("r2"));
    Double rmse = num(test.get("rmse"));
    Double rmseBase = num(base.get("rmse"));
    a.evidence(Kind.MODEL, "R² hors échantillon (test)", r2, null, "Fiche modèle " + card.get("id"));
    a.evidence(Kind.MODEL, "RMSE test", rmse, null, "Fiche modèle");
    a.evidence(Kind.MODEL, "RMSE d'une prévision naïve (moyenne)", rmseBase, null, "Référence");
    a.evidence(Kind.OBSERVED, "Données d'entraînement", card.get("dataProvenance"), null, "Fiche modèle");
    List<Map<String, Object>> imp = (List<Map<String, Object>>) card.getOrDefault("globalImportance", List.of());
    if (!imp.isEmpty()) {
      Map<String, Object> top = imp.stream().max(Comparator.comparingDouble(m -> num(m.get("importanceMean")))).orElseThrow();
      a.evidence(Kind.MODEL, "Variable la plus utilisée par le modèle", top.get("feature"), null,
          "Importance par permutation (dépendance du modèle, pas causalité)");
    }
    a.source("IA › Modèles", String.valueOf(card.get("method")), map("kind", "SYNTHETIC"));
    boolean beats = rmse != null && rmseBase != null && rmse < rmseBase;
    a.text("La prévision de rendement journalier est incertaine pour trois raisons mesurables. Le R² hors échantillon "
        + "est de " + EchoFormat.num(r2, 3) + " : le modèle explique " + (r2 != null && r2 > 0.05 ? "une petite part"
            : "très peu") + " des variations du jour suivant. Son erreur (RMSE " + EchoFormat.num(rmse, 4) + ") "
        + (beats ? "est à peine inférieure" : "n'est pas meilleure") + " à celle d'une prévision naïve (" + EchoFormat.num(rmseBase, 4)
        + "). Enfin, il est entraîné sur une série synthétique : ses résultats ne mesurent pas sa qualité sur un marché réel.");
    for (Object l : (List<Object>) card.getOrDefault("limitations", List.of())) a.limitation(String.valueOf(l));
    return a.navigate("Ouvrir la fiche modèle", "/ai");
  }

  // ------------------------------------------------------------------ learning

  private UUID latestEndedMission(AuthUser user) {
    return tools.learningSessions(user).stream()
        .filter(s -> "MISSION".equals(s.get("kind")) && !"ACTIVE".equals(s.get("status")) && !"ABANDONED".equals(s.get("status")))
        .map(s -> UUID.fromString(String.valueOf(s.get("id")))).findFirst().orElse(null);
  }

  @SuppressWarnings("unchecked")
  EchoAnswer mission(AuthUser user, ClientContext ctx, Map<String, Object> state) {
    EchoAnswer a = new EchoAnswer("MISSION_REVIEW");
    String level = repo.preferences(user.id()).helpLevel();
    UUID sid = ctx.sessionId();
    if (sid != null) {
      Map<String, Object> s = tools.learningSession(user, sid);
      a.tool("learning.session");
      if ("ACTIVE".equals(s.get("status"))) return activeMission(a, s, level);
    } else {
      sid = latestEndedMission(user);
      a.tool("learning.sessions");
    }
    if (sid == null) {
      return a.status("NO_DATA").text("Vous n'avez pas encore terminé de mission MarketQuest.")
          .navigate("Ouvrir MarketQuest", "/learn");
    }
    state.put("sessionId", sid.toString());
    a.context.put("sessionId", sid.toString());
    Map<String, Object> r = tools.whatIfHold(user, sid, 1);
    a.tool("learning.whatIfHold");
    var assess = tools.assessment(user, sid);
    a.tool("learning.assessment");
    List<Map<String, Object>> decisions = (List<Map<String, Object>>) r.getOrDefault("decisions", List.of());
    List<String> lines = new ArrayList<>();
    lines.add("Mission « " + r.get("missionTitle") + " » : " + decisions.size() + " décision(s) enregistrée(s).");
    if (!decisions.isEmpty()) {
      Map<String, Object> last = decisions.getLast();
      Map<String, Object> cmd = castMap(last.get("command"));
      String desc = "PLACE_ORDER".equals(cmd.get("type"))
          ? ("BUY".equals(cmd.get("side")) ? "achat" : "vente") + " de " + EchoFormat.num(num(cmd.get("quantity")), 0)
              + " " + cmd.get("symbol") + " (" + cmd.get("orderType") + ")"
          : "annulation d'ordre";
      a.evidence(Kind.OBSERVED, "Dernière décision", map("seq", last.get("seq"), "step", last.get("step"),
          "command", cmd, "outcome", last.get("outcome")), null, "Journal de commandes de la mission");
      lines.add("Votre dernière décision était un " + desc + " à l'étape " + last.get("step") + " (résultat : "
          + last.get("outcome") + ").");
    }
    if (assess.isPresent()) {
      Map<String, Object> as = assess.get();
      Double total = num(as.get("total"));
      a.evidence(Kind.CALCULATED, "Score de la mission", total, "/100", "Évaluation déterministe MarketQuest");
      List<Map<String, Object>> comps = (List<Map<String, Object>>) as.getOrDefault("components", List.of());
      Map<String, Object> weakest = comps.stream().filter(c -> num(c.get("score")) != null)
          .min(Comparator.comparingDouble(c -> num(c.get("score")))).orElse(null);
      lines.add("Score : " + EchoFormat.num(total, 0) + "/100" + (Boolean.TRUE.equals(as.get("passed")) ? " (réussie)." : " (non réussie)."));
      if (weakest != null) {
        a.evidence(Kind.CALCULATED, "Composante la plus faible", map("key", weakest.get("key"), "score", weakest.get("score")),
            null, "Évaluation");
        lines.add("La composante la plus faible est « " + weakest.get("key") + " » (" + EchoFormat.num(num(weakest.get("score")), 0)
            + "/100) : c'est là que se trouve la principale marge de progression.");
        List<Map<String, Object>> ev = (List<Map<String, Object>>) weakest.getOrDefault("evidence", List.of());
        if (!ev.isEmpty() && ev.getFirst().get("detail") != null) lines.add("Constat du moteur : " + ev.getFirst().get("detail"));
      }
    } else {
      a.status("PARTIAL").limitation("Évaluation non disponible pour cette session.");
    }
    a.text(String.join(" ", lines));
    a.ask("Et si j'avais conservé ?", "Qu'aurais-je pu faire différemment ?");
    return a.navigate("Revoir la session", "/learn/sessions/" + sid + "/review");
  }

  /** During an active mission ÉCHO guides without giving the optimal move; scoring stays with the engine. */
  private EchoAnswer activeMission(EchoAnswer a, Map<String, Object> s, String level) {
    Map<String, Object> mission = castMap(s.get("mission"));
    a.context.put("sessionId", String.valueOf(s.get("id")));
    a.evidence(Kind.OBSERVED, "Objectif de la mission", mission.get("objective") != null ? mission.get("objective")
        : mission.get("summary"), null, "Briefing de mission");
    String hint = switch (level) {
      case "DEBUTANT" -> "Relisez l'objectif et la contrainte de risque, puis demandez-vous : si le marché baissait de 10 %, "
          + "mon portefeuille respecterait-il encore la limite ?";
      case "AVANCE" -> "Je ne commente pas les coups pendant la mission en mode avancé. Le bilan détaillé sera disponible "
          + "à la fin.";
      default -> "Avant chaque ordre, vérifiez la part de liquidités restante et le poids de la ligne visée par rapport "
          + "aux contraintes de la mission.";
    };
    a.limitation("Pendant une mission, ÉCHO ne donne pas la réponse optimale et n'utilise pas l'indice du mentor : "
        + "votre score n'est pas affecté.");
    return a.text("Mission en cours. " + hint).ask("Qu'est-ce que la diversification ?", "Qu'est-ce que la diversification ?");
  }

  @SuppressWarnings("unchecked")
  EchoAnswer story(AuthUser user, ClientContext ctx) {
    EchoAnswer a = new EchoAnswer("STORY");
    Map<String, Object> feed = tools.storiesFeed(user);
    a.tool("stories.feed");
    List<Map<String, Object>> list = (List<Map<String, Object>>) feed.getOrDefault("stories", List.of());
    String slug = ctx.storySlug();
    if (slug == null) {
      slug = list.stream().filter(s -> Boolean.TRUE.equals(castMap(s.get("progress")).get("completed")))
          .map(s -> String.valueOf(s.get("slug"))).findFirst().orElse(null);
    }
    if (slug == null) {
      return a.status("NO_DATA").text("Vous n'avez terminé aucun épisode FinStories. Je commenterai un épisode une fois "
          + "que vous l'aurez regardé jusqu'au bout, pour ne pas en dévoiler la fin.").navigate("Ouvrir FinStories", "/stories");
    }
    Map<String, Object> story = tools.story(user, slug);
    a.tool("stories.get");
    Map<String, Object> progress = castMap(story.get("progress"));
    if (!Boolean.TRUE.equals(progress.get("completed"))) {
      return a.status("PARTIAL").text("Vous n'avez pas encore terminé « " + story.get("title") + " ». Je vous expliquerai "
          + "ses enjeux à la fin de l'épisode, pour préserver la découverte.");
    }
    List<Map<String, Object>> scenes = (List<Map<String, Object>>) story.getOrDefault("scenes", List.of());
    a.evidence(Kind.OBSERVED, "Épisode", story.get("title"), null, "FinStories");
    a.evidence(Kind.OBSERVED, "Compétence travaillée", story.get("competency"), null, "Catalogue FinStories");
    List<String> lines = new ArrayList<>();
    lines.add("« " + story.get("title") + " » : " + story.get("summary"));
    if (!scenes.isEmpty() && scenes.getLast().get("caption") != null) {
      lines.add("Le dénouement : " + scenes.getLast().get("caption"));
    }
    if (progress.get("reflection") instanceof String refl && !refl.isBlank()) {
      a.evidence(Kind.OBSERVED, "Votre réflexion", refl, null, "Saisie à la fin de l'épisode");
      lines.add("Vous aviez noté : « " + refl + " ».");
    }
    String comp = String.valueOf(story.get("competency"));
    String concept = switch (comp.toLowerCase(Locale.ROOT)) {
      case "diversification" -> "diversification";
      case "risk", "risk_management", "risque" -> "var";
      case "costs", "fees", "frais" -> "frais";
      case "liquidity", "liquidite" -> "liquidite";
      default -> null;
    };
    if (concept != null) a.ask("Approfondir la notion", "Qu'est-ce que " + EchoGlossary.ENTRIES.get(concept).title() + " ?");
    if (story.get("relatedMissionSlug") != null) a.navigate("Mettre en pratique (mission liée)", "/learn/missions/" + story.get("relatedMissionSlug"));
    a.limitation("FinStories est un récit pédagogique fictif ; ÉCHO commente l'épisode terminé sans en modifier la progression.");
    return a.text(String.join(" ", lines));
  }

  // ------------------------------------------------------------------ actuarial & bank stress

  @SuppressWarnings("unchecked")
  EchoAnswer actuarial(AuthUser user, ClientContext ctx) {
    EchoAnswer a = new EchoAnswer("ACTUARIAL");
    Map<String, Object> pricing;
    String label;
    UUID sid = ctx.actuarialScenarioId();
    if (sid == null) {
      List<Map<String, Object>> saved = tools.actuarialScenarios(user);
      a.tool("actuarial.scenarios");
      if (!saved.isEmpty()) sid = UUID.fromString(String.valueOf(saved.getFirst().get("id")));
    }
    if (sid != null) {
      Map<String, Object> sc = tools.actuarialScenario(user, sid);
      a.tool("actuarial.scenario");
      pricing = castMap(sc.get("results"));
      label = "votre scénario enregistré « " + sc.get("name") + " »";
      a.evidence(Kind.ASSUMPTION, "Hypothèses", "Scénario « " + sc.get("name") + " » saisi par vous", null, "Actuariat");
    } else {
      Map<String, Object> preset = ((List<Map<String, Object>>) tools.actuarialPresets().get("presets")).getFirst();
      a.tool("actuarial.presets");
      pricing = tools.actuarialPrice(castMap(preset.get("assumptions")));
      a.tool("actuarial.price");
      label = "le jeu d'hypothèses de référence « " + preset.get("name") + " » (aucun scénario enregistré)";
      a.evidence(Kind.ASSUMPTION, "Hypothèses", "Preset « " + preset.get("name") + " »", null, "Actuariat");
    }
    Map<String, Object> totals = castMap(at(pricing, "premium", "totals"));
    Double gross = num(totals.get("grossPremium"));
    if (gross == null || gross <= 0) {
      return a.status("NO_DATA").text("Je n'ai pas de résultat de tarification exploitable pour " + label + ".");
    }
    List<String[]> parts = List.of(new String[] {"purePremium", "Prime pure (sinistres attendus)"},
        new String[] {"riskLoading", "Chargement de risque"}, new String[] {"fixedExpenses", "Frais fixes"},
        new String[] {"variableExpenses", "Frais variables"}, new String[] {"profitMargin", "Marge"});
    List<Map<String, Object>> rows = new ArrayList<>();
    String topPart = null;
    double topShare = 0;
    for (String[] part : parts) {
      Double v = num(totals.get(part[0]));
      if (v == null) continue;
      rows.add(map("x", part[1], "y", v / gross));
      a.evidence(Kind.CALCULATED, part[1], v, "TND", "Décomposition de la prime brute");
      if (v / gross > topShare) {
        topShare = v / gross;
        topPart = part[1];
      }
    }
    a.chart("bar", "Composition de la prime brute", rows, "ratio");
    Double combined = num(at(pricing, "premium", "ratios", "combined"));
    a.evidence(Kind.CALCULATED, "Ratio combiné", combined, "ratio", "Sinistres + frais / prime");
    List<String> lines = new ArrayList<>();
    lines.add("Pour " + label + ", la prime brute totale est de " + EchoFormat.money(gross, "TND") + ". Son premier "
        + "composant est « " + topPart + " » (" + EchoFormat.pct(topShare) + ").");
    List<Map<String, Object>> sens = (List<Map<String, Object>>) pricing.getOrDefault("sensitivities", List.of());
    Map<String, Object> strongest = sens.stream().filter(s -> num(s.get("premiumChange")) != null)
        .max(Comparator.comparingDouble(s -> Math.abs(num(s.get("premiumChange"))))).orElse(null);
    if (strongest != null) {
      a.evidence(Kind.CALCULATED, "Hypothèse la plus sensible : " + strongest.get("label"), num(strongest.get("premiumChange")),
          "ratio", "Sensibilité une-à-une du moteur de tarification");
      lines.add("L'hypothèse qui fait le plus bouger la prime est « " + strongest.get("label") + " » ("
          + EchoFormat.signedPct(num(strongest.get("premiumChange"))) + " de prime lorsqu'on la fait varier).");
    }
    if (combined != null) lines.add("Ratio combiné attendu : " + EchoFormat.pct(combined) + ".");
    for (Object w : (List<Object>) pricing.getOrDefault("warnings", List.of())) a.flag("ACTUARIAL_WARNING", "WARNING", String.valueOf(w), Map.of());
    a.limitation("Résultats calculés sur des hypothèses fictives saisies : ce n'est pas un tarif réel.");
    a.limitation("Une sensibilité mesure l'effet mécanique d'une hypothèse dans le modèle, pas une causalité observée.");
    a.ask("Qu'est-ce que la prime pure ?", "Qu'est-ce que la prime pure ?");
    return a.text(String.join(" ", lines)).navigate("Ouvrir la tarification", "/actuarial/pricing");
  }

  @SuppressWarnings("unchecked")
  EchoAnswer bank(ClientContext ctx, Parsed p) {
    EchoAnswer a = new EchoAnswer("BANK_STRESS");
    Map<String, Object> run = tools.stressRun(ctx.stressPresetId());
    a.tool("stress.run");
    Map<String, Object> scen = castMap(run.get("scenario"));
    a.evidence(Kind.ASSUMPTION, "Scénario", scen.get("name") + " — " + scen.get("description"), null, "Stress bancaire");
    List<String> lines = new ArrayList<>();
    lines.add("Scénario « " + scen.get("name") + " » (" + scen.get("description") + ").");
    for (Map<String, Object> b : (List<Map<String, Object>>) run.getOrDefault("banks", List.of())) {
      Map<String, Object> attr = castMap(b.get("attribution"));
      List<Map<String, Object>> contrib = new ArrayList<>((List<Map<String, Object>>) attr.getOrDefault("cet1Ratio", List.of()));
      contrib.sort(Comparator.comparingDouble(c -> num(c.get("value"))));
      Double total = num(attr.get("cet1RatioTotal"));
      a.evidence(Kind.CALCULATED, "Variation du CET1 — " + b.get("name"), total, "ratio", "Moteur de stress déterministe");
      if (!contrib.isEmpty() && num(contrib.getFirst().get("value")) < 0) {
        Map<String, Object> worst = contrib.getFirst();
        a.evidence(Kind.CALCULATED, "Premier facteur de baisse — " + b.get("name"), map("factor", worst.get("label"),
            "contribution", worst.get("value")), "ratio", "Décomposition de Shapley exacte");
        lines.add(b.get("name") + " : CET1 " + EchoFormat.pp(total) + " par rapport au scénario central ; le choc qui "
            + "contribue le plus à la baisse est « " + worst.get("label") + " » (" + EchoFormat.pp(num(worst.get("value"))) + ").");
      }
    }
    a.limitation("Les valeurs de Shapley décomposent le calcul du modèle : elles indiquent une contribution dans le "
        + "modèle, pas une causalité économique démontrée.");
    a.limitation("Banques fictives et paramètres pédagogiques.");
    a.ask("Qu'est-ce que le CET1 ?", "Qu'est-ce que le CET1 ?");
    return a.text(String.join(" ", lines)).navigate("Ouvrir le stress bancaire", "/stress");
  }

  // ------------------------------------------------------------------ misc

  EchoAnswer concept(Parsed p, AuthUser user) {
    EchoAnswer a = new EchoAnswer("CONCEPT");
    EchoGlossary.Entry e = EchoGlossary.ENTRIES.get(p.concept());
    if (e == null) return unknown(new ClientContext(null, null, null, null, null, null, null, null, Map.of()));
    a.evidence(Kind.INTERPRETATION, "Définition", e.title(), null, "Glossaire pédagogique ÉCHO");
    String level = repo.preferences(user.id()).helpLevel();
    String text = e.title() + ". " + e.definition() + ("DEBUTANT".equals(level) ? "" : " " + e.inProduct());
    return a.text(text).navigate("Voir dans l'application", e.route());
  }

  EchoAnswer journal(AuthUser user) {
    EchoAnswer a = new EchoAnswer("JOURNAL");
    var prefs = repo.preferences(user.id());
    if (!prefs.memoryEnabled()) {
      return a.status("NO_DATA").text("La mémoire décisionnelle est désactivée : je n'enregistre aucune intention. Vous "
          + "pouvez l'activer dans les paramètres d'ÉCHO ; vous pourrez consulter, corriger et supprimer chaque entrée.");
    }
    List<Map<String, Object>> d = repo.decisions(user.id(), 5);
    if (d.isEmpty()) return a.status("NO_DATA").text("Votre journal de décisions est vide.");
    for (Map<String, Object> x : d) {
      a.evidence(Kind.OBSERVED, EchoFormat.day(String.valueOf(x.get("createdAt"))) + " — " + (x.get("symbol") == null ? "" : x.get("symbol")),
          EchoMemoryService.INTENT_LABELS.get(String.valueOf(x.get("intent"))), null, "Journal ÉCHO");
    }
    Map<String, Object> last = d.getFirst();
    return a.text("Vous avez " + d.size() + " décision(s) récente(s). La dernière (" + EchoFormat.day(String.valueOf(last.get("createdAt")))
        + ") avait pour intention « " + EchoMemoryService.INTENT_LABELS.get(String.valueOf(last.get("intent")))
        + " »" + (last.get("symbol") == null ? "" : " sur " + last.get("symbol")) + ". Ouvrez le journal pour confronter "
        + "chaque intention au résultat mesuré.");
  }

  EchoAnswer news() {
    EchoAnswer a = new EchoAnswer("NEWS");
    List<Map<String, Object>> items = tools.news(5);
    a.tool("news.feed");
    if (items.isEmpty()) return a.status("NO_DATA").text("Aucune actualité n'est disponible actuellement.");
    for (Map<String, Object> n : items) {
      // Headlines are untrusted third-party data: quoted as evidence, never interpreted as instructions.
      a.evidence(Kind.OBSERVED, String.valueOf(n.getOrDefault("source", "Actualité")), n.get("title"), null,
          String.valueOf(n.getOrDefault("publishedAt", "")));
    }
    a.limitation("Les titres d'actualité sont affichés tels quels ; ÉCHO n'en déduit aucune recommandation.");
    return a.text("Voici les " + items.size() + " dernières actualités disponibles dans Market Trading Room.");
  }

  @SuppressWarnings("unchecked")
  EchoAnswer coverage() {
    EchoAnswer a = new EchoAnswer("DATA_COVERAGE");
    Map<String, Object> cov = tools.coverage();
    a.tool("market.coverage");
    if (cov.isEmpty() || !Boolean.TRUE.equals(cov.get("available"))) {
      return a.status("PARTIAL").text("Sur cet environnement, l'entrepôt de données historiques n'est pas installé : "
          + "les marchés affichés proviennent du simulateur fictif. Les analyses d'ÉCHO portent alors sur ces "
          + "données simulées, et je le signale à chaque réponse.");
    }
    a.evidence(Kind.OBSERVED, "Observations de séance", cov.get("bars"), null, "Entrepôt");
    a.evidence(Kind.OBSERVED, "Instruments", cov.get("instruments"), null, "Entrepôt");
    a.evidence(Kind.OBSERVED, "Épisodes de crise", cov.get("crises"), null, "Entrepôt");
    for (Map<String, Object> s : (List<Map<String, Object>>) cov.getOrDefault("bySource", List.of())) {
      a.evidence(Kind.OBSERVED, "Source " + s.get("sourceId"), s.get("minDate") + " → " + s.get("maxDate") + " ("
          + s.get("bars") + " obs.)", null, "Entrepôt");
    }
    return a.text("L'entrepôt contient " + cov.get("bars") + " observations sur " + cov.get("instruments")
        + " instruments, et " + cov.get("crises") + " épisodes de crise. Ce sont des clôtures historiques, pas des cours en direct.");
  }

  EchoAnswer help(ClientContext ctx) {
    EchoAnswer a = new EchoAnswer("HELP");
    a.text("Je suis ÉCHO. J'analyse vos portefeuilles, le risque d'un ordre avant confirmation, des scénarios "
        + "« et si… », vos missions MarketQuest et vos résultats actuariels, à partir des données et moteurs de Market "
        + "Trading Room. Je ne passe jamais d'ordre et j'indique toujours d'où viennent les chiffres.");
    a.limitation("ÉCHO fonctionne par règles déterministes et outils de calcul ; il ne s'appuie pas sur un grand modèle "
        + "de langage : les questions très libres peuvent ne pas être comprises.");
    suggestions(a, ctx);
    return a;
  }

  EchoAnswer unknown(ClientContext ctx) {
    EchoAnswer a = new EchoAnswer("UNKNOWN").status("CLARIFICATION");
    a.text("Je n'ai pas compris la demande. Je réponds à des questions précises sur vos portefeuilles, un instrument, "
        + "un ordre en préparation, un scénario, une mission ou une notion financière.");
    suggestions(a, ctx);
    return a;
  }

  static void suggestions(EchoAnswer a, ClientContext ctx) {
    String m = ctx.module() == null ? "" : ctx.module();
    switch (m) {
      case "TRADING" -> {
        a.ask("Examiner le risque de cet ordre", "Examiner le risque de cet ordre");
        a.ask("Analyser cet actif", "Peux-tu analyser cet actif ?");
      }
      case "MARKETS" -> a.ask("Analyser cet actif", "Peux-tu analyser cet actif ?");
      case "MISSION", "MARKETQUEST" -> a.ask("Expliquer ma dernière décision", "Quelle décision ai-je prise lors de ma dernière mission ?");
      case "ACTUARIAL" -> a.ask("Comprendre ce résultat", "Pourquoi cette prime est-elle élevée ?");
      case "STRESS" -> a.ask("Pourquoi cette banque est vulnérable", "Pourquoi cette banque est-elle vulnérable ?");
      case "STORIES" -> a.ask("Expliquer l'épisode", "Explique-moi mon dernier épisode FinStories.");
      default -> {
        a.ask("Analyser ma diversification", "Quels actifs représentent ma plus grande exposition ?");
        a.ask("Performance de mon portefeuille", "Quelle est la performance de mon portefeuille ?");
      }
    }
    a.ask("Qu'est-ce que la VaR ?", "Explique-moi ce que signifie la VaR.");
  }
}
