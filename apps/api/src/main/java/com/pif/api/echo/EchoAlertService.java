package com.pif.api.echo;

import static com.pif.api.echo.EchoFinancialTools.map;
import static com.pif.api.echo.EchoFinancialTools.num;

import com.pif.api.echo.EchoRepository.AlertCandidate;
import com.pif.api.security.AuthUser;
import com.pif.api.web.ApiException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/**
 * Proactive alerts. Each one is a verifiable rule on numbers computed by the trading engine — never the
 * impression of a language model. Anti-spam: one ACTIVE row per fingerprint (DB unique index), a cooldown
 * after dismissal or resolution, hysteresis on thresholds, an evaluation throttle and a per-run cap.
 */
@Service
public class EchoAlertService {

  static final double CONCENTRATION_HIGH = 0.40;
  static final double CONCENTRATION_HIGH_EXIT = 0.37;
  static final double CASH_LOW = 0.02;
  static final double CASH_LOW_EXIT = 0.03;
  static final double[] LOSS_BUCKETS = {-0.40, -0.25, -0.15};
  static final double VAR_HIGH = 0.05;
  static final double VAR_HIGH_EXIT = 0.045;
  static final Duration COOLDOWN = Duration.ofHours(12);
  static final Duration THROTTLE = Duration.ofSeconds(30);
  static final int MAX_PORTFOLIOS = 5;

  private final EchoRepository repo;
  private final EchoFinancialTools tools;
  private final Clock clock;
  private final Map<UUID, Instant> lastRun = new ConcurrentHashMap<>();

  public EchoAlertService(EchoRepository repo, EchoFinancialTools tools, Clock clock) {
    this.repo = repo;
    this.tools = tools;
    this.clock = clock;
  }

  /** Evaluates (at most every 30 s per user) then returns the active alerts and the ids raised by this run. */
  public Map<String, Object> poll(AuthUser user, boolean force) {
    if (!repo.tablesPresent()) {
      throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "ECHO_NOT_MIGRATED", "ÉCHO n'est pas installé sur cette base.");
    }
    var prefs = repo.preferences(user.id());
    List<String> raised = new ArrayList<>();
    Instant now = clock.instant();
    Instant prev = lastRun.get(user.id());
    boolean evaluated = false;
    if (prefs.alertsEnabled() && (force || prev == null || Duration.between(prev, now).compareTo(THROTTLE) >= 0)) {
      lastRun.put(user.id(), now);
      raised = evaluate(user, prefs.memoryEnabled());
      evaluated = true;
    }
    return map("alertsEnabled", prefs.alertsEnabled(), "proactiveVoice", prefs.proactiveVoice(), "evaluated", evaluated,
        "raised", raised, "alerts", repo.alerts(user.id(), true, 20),
        "rules", rules());
  }

  static List<Map<String, Object>> rules() {
    return List.of(
        map("code", "POSITION_LIMIT", "rule", "Poids d'une ligne > plafond du portefeuille", "severity", "CRITICAL"),
        map("code", "CONCENTRATION_HIGH", "rule", "Plus grande ligne ≥ 40 % (sortie sous 37 %)", "severity", "WARNING"),
        map("code", "VAR_HIGH", "rule", "VaR historique 95 % ≥ 5 % des capitaux (sortie sous 4,5 %)", "severity", "WARNING"),
        map("code", "POSITION_LOSS", "rule", "Moins-value latente d'une ligne ≤ −15 / −25 / −40 %", "severity", "WARNING"),
        map("code", "CASH_LOW", "rule", "Liquidités disponibles < 2 % des capitaux (sortie au-dessus de 3 %)", "severity", "INFO"),
        map("code", "INTENT_MISMATCH", "rule", "Décision « diversification » suivie d'une baisse des positions effectives "
            + "(mémoire activée uniquement)", "severity", "INFO"));
  }

  List<String> evaluate(AuthUser user, boolean memoryEnabled) {
    Set<String> active = new HashSet<>(repo.activeFingerprints(user.id()));
    Set<String> closed = new HashSet<>(repo.recentlyClosedFingerprints(user.id(), clock.instant().minus(COOLDOWN)));
    List<AlertCandidate> candidates = new ArrayList<>();
    List<Map<String, Object>> list = tools.portfolioList(user);
    for (Map<String, Object> pf : list.subList(0, Math.min(MAX_PORTFOLIOS, list.size()))) {
      candidates.addAll(portfolioRules(user, pf, active));
    }
    if (memoryEnabled) candidates.addAll(intentRules(user, list));
    List<String> stillTrue = new ArrayList<>();
    List<String> raised = new ArrayList<>();
    for (AlertCandidate c : candidates) {
      stillTrue.add(c.fingerprint());
      if (closed.contains(c.fingerprint()) && !active.contains(c.fingerprint())) continue;
      if (repo.upsertActive(user.id(), c)) raised.add(c.fingerprint());
    }
    repo.resolveMissing(user.id(), stillTrue);
    return raised;
  }

  List<AlertCandidate> portfolioRules(AuthUser user, Map<String, Object> pf, Set<String> active) {
    List<AlertCandidate> out = new ArrayList<>();
    String pid = String.valueOf(pf.get("id"));
    String name = String.valueOf(pf.get("name"));
    String ccy = String.valueOf(pf.get("baseCurrency"));
    Double equity = num(pf.get("equity"));
    Double available = num(pf.get("availableCash"));
    Double cap = num(pf.get("maxPositionWeightPct"));
    List<Map<String, Object>> positions = EchoScenarioService.positions(pf);
    if (equity == null || equity <= 0 || positions.isEmpty()) return out;
    Map<String, Object> navigate = map("label", "Analyser le portefeuille", "route", "/risk");
    for (Map<String, Object> p : positions) {
      String sym = String.valueOf(p.get("symbol"));
      Double w = num(p.get("weight"));
      if (w == null) continue;
      if (cap != null && w * 100 > cap + 1e-9) {
        out.add(new AlertCandidate("limit:" + pid + ":" + sym, "POSITION_LIMIT", "CRITICAL",
            "Plafond de ligne dépassé — " + sym,
            sym + " pèse " + EchoFormat.pct(w) + " de « " + name + " », au-delà du plafond de " + EchoFormat.num(cap, 0)
                + " %. Les nouveaux achats sur cette ligne seront refusés.",
            map("portfolioId", pid, "symbol", sym, "weight", w, "capPct", cap, "asOf", pf.get("asOf")), navigate));
      } else {
        String fp = "conc:" + pid + ":" + sym;
        double threshold = active.contains(fp) ? CONCENTRATION_HIGH_EXIT : CONCENTRATION_HIGH;
        if (w >= threshold) {
          out.add(new AlertCandidate(fp, "CONCENTRATION_HIGH", "WARNING", "Concentration élevée — " + sym,
              sym + " représente " + EchoFormat.pct(w) + " de « " + name + " ». Une baisse de 10 % de ce titre "
                  + "réduirait la valeur du portefeuille d'environ " + EchoFormat.pct(w * 0.10) + ".",
              map("portfolioId", pid, "symbol", sym, "weight", w, "threshold", CONCENTRATION_HIGH, "asOf", pf.get("asOf")),
              navigate));
        }
      }
      Double loss = num(p.get("unrealizedPct"));
      if (loss != null) {
        for (double b : LOSS_BUCKETS) {
          if (loss <= b) {
            out.add(new AlertCandidate("loss:" + pid + ":" + sym + ":" + (int) Math.round(b * 100), "POSITION_LOSS",
                "WARNING", "Moins-value latente — " + sym,
                sym + " affiche " + EchoFormat.signedPct(loss) + " par rapport à son prix de revient dans « " + name
                    + " ». C'est un constat, pas une recommandation de vendre.",
                map("portfolioId", pid, "symbol", sym, "unrealizedPct", loss, "bucket", b, "asOf", pf.get("asOf")),
                map("label", "Comprendre cette position", "route", "/portfolios")));
            break;
          }
        }
      }
    }
    if (available != null) {
      String fp = "cash:" + pid;
      double threshold = active.contains(fp) ? CASH_LOW_EXIT : CASH_LOW;
      if (available / equity < threshold) {
        out.add(new AlertCandidate(fp, "CASH_LOW", "INFO", "Liquidités faibles — " + name,
            "Il reste " + EchoFormat.money(available, ccy) + " disponibles (" + EchoFormat.pct(available / equity)
                + " des capitaux) : un nouvel achat pourrait être refusé faute de fonds.",
            map("portfolioId", pid, "availableCash", available, "equity", equity, "threshold", CASH_LOW), null));
      }
    }
    try {
      Map<String, Object> an = tools.analytics(user, UUID.fromString(pid));
      Double var = num(EchoFinancialTools.at(an, "risk", "valueAtRisk95", "value"));
      if (var != null) {
        String fp = "var:" + pid;
        double ratio = Math.abs(var) / equity;
        double threshold = active.contains(fp) ? VAR_HIGH_EXIT : VAR_HIGH;
        if (ratio >= threshold) {
          out.add(new AlertCandidate(fp, "VAR_HIGH", "WARNING", "Risque de perte élevé — " + name,
              "La VaR historique à 95 % atteint " + EchoFormat.money(Math.abs(var), ccy) + ", soit "
                  + EchoFormat.pct(ratio) + " des capitaux : une journée sur vingt a historiquement fait pire.",
              map("portfolioId", pid, "valueAtRisk95", var, "equity", equity, "ratio", ratio, "threshold", VAR_HIGH,
                  "observations", EchoFinancialTools.at(an, "risk", "observations")),
              navigate));
        }
      }
    } catch (ApiException | IllegalArgumentException ignored) {
      // Analytics unavailable for this portfolio: no VaR alert rather than a guessed one.
    }
    return out;
  }

  @SuppressWarnings("unchecked")
  List<AlertCandidate> intentRules(AuthUser user, List<Map<String, Object>> portfolios) {
    List<AlertCandidate> out = new ArrayList<>();
    Map<String, Map<String, Object>> byId = new LinkedHashMap<>();
    for (Map<String, Object> pf : portfolios) byId.put(String.valueOf(pf.get("id")), pf);
    for (Map<String, Object> d : repo.decisions(user.id(), 20)) {
      if (!"DIVERSIFICATION".equals(d.get("intent")) || d.get("portfolioId") == null) continue;
      Map<String, Object> pf = byId.get(String.valueOf(d.get("portfolioId")));
      Map<String, Object> snap = (Map<String, Object>) d.get("snapshot");
      if (pf == null || snap == null) continue;
      Double before = num(snap.get("effectiveHoldings"));
      Double now = num(EchoMemoryService.concentration(pf).get("effectiveHoldings"));
      if (before != null && now != null && now < before - 0.5) {
        out.add(new AlertCandidate("intent:" + d.get("id"), "INTENT_MISMATCH", "INFO",
            "Intention et exposition divergent",
            "Vous aviez noté une intention de diversification" + (d.get("symbol") == null ? "" : " sur " + d.get("symbol"))
                + ". Depuis, les positions effectives sont passées de " + EchoFormat.num(before, 1) + " à "
                + EchoFormat.num(now, 1) + ".",
            map("decisionId", d.get("id"), "effectiveBefore", before, "effectiveNow", now),
            map("label", "Revoir la décision", "route", "/portfolios")));
      }
    }
    return out;
  }

  public Map<String, Object> history(AuthUser user) {
    return map("alerts", repo.alerts(user.id(), false, 50));
  }

  public void markRead(AuthUser user, UUID id) {
    if (!repo.markRead(user.id(), id)) throw notFound();
  }

  public void dismiss(AuthUser user, UUID id) {
    if (!repo.dismiss(user.id(), id)) throw notFound();
  }

  private static ApiException notFound() {
    return new ApiException(HttpStatus.NOT_FOUND, "ECHO_ALERT_NOT_FOUND", "Alerte introuvable.");
  }
}
