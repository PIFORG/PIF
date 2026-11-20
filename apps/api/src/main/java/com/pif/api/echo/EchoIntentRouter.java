package com.pif.api.echo;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.function.Predicate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Deterministic French intent recognition. This is NOT a language model: it is an ordered list of
 * auditable rules over accent-folded text, plus entity extraction (symbols, percentages, fractions, years).
 * Rules are ordered from the most specific to the most generic; the first match wins.
 */
public final class EchoIntentRouter {

  public enum Intent {
    GREETING, HELP, ORDER_REJECTION, PRETRADE, STRESS_SCENARIO, WHATIF_SELL, COMPARE_BEFORE_AFTER, ALTERNATIVE,
    FORECAST, CRISIS, COMPARE_INSTRUMENTS, MISSION_REVIEW, STORY, ACTUARIAL, BANK_STRESS, JOURNAL, CONCEPT,
    PORTFOLIO_EXPOSURE, PORTFOLIO_RISK, PORTFOLIO_PERFORMANCE, INSTRUMENT_ANALYSIS, NEWS, DATA_COVERAGE, UNKNOWN
  }

  /** What was understood from one message. Values are null when absent. */
  public record Parsed(Intent intent, String normalized, List<String> symbolCandidates, Double percent,
      Double fraction, Integer year, String concept, boolean refersToPrevious) {}

  private record Rule(Intent intent, Predicate<String> test) {}

  private static final Pattern PERCENT = Pattern.compile("(\\d{1,3}(?:[.,]\\d{1,2})?)\\s*(?:%|pour ?cent)");
  private static final Pattern YEAR = Pattern.compile("\\b(19[89]\\d|20[0-4]\\d)\\b");
  /** Candidate tickers in the ORIGINAL text: upper-case words, optionally with a dot or dash suffix. */
  private static final Pattern TICKER = Pattern.compile("\\b([A-Z][A-Z0-9]{1,9}(?:[.-][A-Z0-9]{1,4})?)\\b");
  private static final Set<String> NOT_TICKERS = Set.of("VAR", "ES", "CET1", "LCR", "HHI", "PNL", "TND", "USD", "EUR",
      "SEC", "FED", "IA", "AI", "ETF", "OK", "ECHO", "QCM", "BVMT", "CMF", "PIF", "XAI", "ALM", "TVAR", "LE", "LA",
      "LES", "UN", "UNE", "DE", "DU", "ET", "OU", "EN", "MON", "MA", "MES", "JE", "TU", "IL", "SI", "CE", "CET", "QUE",
      "QUI", "QUOI", "POURQUOI", "COMMENT", "BUY", "SELL");

  /** Glossary terms recognised in questions, mapped to {@link EchoGlossary} keys. */
  private static final List<String[]> CONCEPTS = List.of(
      new String[] {"var", "\\bvar\\b|value at risk|valeur a risque"},
      new String[] {"es", "expected shortfall|\\bes\\b|perte moyenne au-dela|cvar|tvar"},
      new String[] {"drawdown", "drawdown|perte maximale|baisse maximale"},
      new String[] {"volatilite", "volatilit"},
      new String[] {"hhi", "\\bhhi\\b|herfindahl|positions effectives"},
      new String[] {"diversification", "diversif"},
      new String[] {"correlation", "correl"},
      new String[] {"spread", "spread|fourchette|bid|ask"},
      new String[] {"frais", "\\bfrais\\b|commission|courtage"},
      new String[] {"twr", "time.weighted|rendement pondere par le temps|\\btwr\\b"},
      new String[] {"mwr", "money.weighted|\\bmwr\\b|\\btri\\b"},
      new String[] {"stop", "stop.loss|ordre stop"},
      new String[] {"limite", "ordre limite|ordre a cours limite"},
      new String[] {"take-profit", "take.profit"},
      new String[] {"backtest", "backtest"},
      new String[] {"cet1", "\\bcet1\\b|fonds propres de base"},
      new String[] {"lcr", "\\blcr\\b|liquidity coverage|ratio de liquidite"},
      new String[] {"shapley", "shapley"},
      new String[] {"prime-pure", "prime pure"},
      new String[] {"ratio-combine", "ratio combine"},
      new String[] {"provisions", "provision|chain.ladder|reserv"},
      new String[] {"capital-economique", "capital economique|solvabilit"},
      new String[] {"liquidite", "liquidit"},
      new String[] {"concentration", "concentration"});

  private static boolean has(String text, String regex) {
    return Pattern.compile(regex).matcher(text).find();
  }

  private static final List<Rule> RULES = List.of(
      new Rule(Intent.GREETING, t -> has(t, "^(bonjour|salut|bonsoir|hello|coucou|merci)\\b") && t.split(" ").length <= 4),
      new Rule(Intent.HELP, t -> has(t, "que (peux|sais)[- ]tu faire|^aide\\b|comment (tu )?fonctionnes?|qui es[- ]tu|tes capacites")),
      new Rule(Intent.ORDER_REJECTION, t -> has(t, "(rejet|refus|bloque|pas passe)") && has(t, "ordre|achat|vente|transaction")),
      new Rule(Intent.PRETRADE, t -> has(t, "(risque|impact|examiner).{0,20}(de |d')?(cet|mon|ce) (ordre|achat|ticket)|avant (de confirmer|d'acheter|de vendre)|pre.?trade|si j'achete|cet achat|ce ticket")),
      new Rule(Intent.STRESS_SCENARIO, t -> has(t, "(baiss|chut|krach|recul|choc|hauss|perd|plong)") && PERCENT.matcher(t).find()),
      new Rule(Intent.WHATIF_SELL, t -> has(t, "(vend|cede|alleg)") && has(t, "moitie|tiers|quart|\\d+ ?%|pour ?cent|la totalite|tout")),
      new Rule(Intent.COMPARE_BEFORE_AFTER, t -> has(t, "avant et apres|apres et avant")),
      new Rule(Intent.ALTERNATIVE, t -> has(t, "qu'aurai[st][- ]je|aurais[- ]je (du|pu)|fait (autrement|differemment)|et si (je n'avais pas|j'avais|je n'avais)|sans (mon|ce) dernier")),
      new Rule(Intent.FORECAST, t -> has(t, "prevision|prediction|predi|modele (ia|predictif)|incertain")),
      new Rule(Intent.CRISIS, t -> has(t, "\\bcrise|covid|subprimes?|lehman|pandemie")),
      new Rule(Intent.COMPARE_INSTRUMENTS, t -> has(t, "compar") && !has(t, "banque")),
      new Rule(Intent.MISSION_REVIEW, t -> has(t, "mission|marketquest|mon score|bilan|ma derniere decision|derniere session")),
      new Rule(Intent.STORY, t -> has(t, "finstor|episode|histoire|mon choix|ce choix")),
      new Rule(Intent.ACTUARIAL, t -> has(t, "\\bprime|sinistr|provision|actuari|capital economique|ratio combine|assur")),
      new Rule(Intent.BANK_STRESS, t -> has(t, "banque|bancaire|\\bcet1\\b|\\blcr\\b|vulnerab")),
      new Rule(Intent.JOURNAL, t -> has(t, "journal|mes decisions|decisions? (que j'ai|enregistr)|mon intention|mes intentions")),
      new Rule(Intent.CONCEPT, t -> has(t, "qu'est[- ]ce (que|qu')|que (signifie|veut dire)|c'est quoi|definition|definis|explique[- ]moi (ce qu|la |le |l'|les )") && conceptOf(t) != null),
      new Rule(Intent.PORTFOLIO_EXPOSURE, t -> has(t, "expos|concentr|diversif|plus grande|poids|repartition|allocation")),
      new Rule(Intent.PORTFOLIO_RISK, t -> has(t, "risque|\\bvar\\b|volatil|perte potentielle|drawdown")),
      new Rule(Intent.PORTFOLIO_PERFORMANCE, t -> has(t, "performance|rendement|gagne|perdu|\\bpnl\\b|plus.value|resultat|portefeuille")),
      new Rule(Intent.INSTRUMENT_ANALYSIS, t -> has(t, "analys|cet actif|ce titre|cet instrument|cette action|ce fonds|que penses?[- ]tu")),
      new Rule(Intent.NEWS, t -> has(t, "actualit|nouvelles|\\bnews\\b|\\bfed\\b|\\bsec\\b|annonce")),
      new Rule(Intent.DATA_COVERAGE, t -> has(t, "donnees|couverture|source|historique disponible|fraicheur")),
      new Rule(Intent.CONCEPT, t -> conceptOf(t) != null));

  private EchoIntentRouter() {}

  public static String normalize(String text) {
    String folded = Normalizer.normalize(text == null ? "" : text, Normalizer.Form.NFD)
        .replaceAll("\\p{M}+", "")
        .replace('’', '\'')
        .toLowerCase(Locale.ROOT);
    return folded.replaceAll("[\\s\\u00a0]+", " ").trim();
  }

  static String conceptOf(String normalized) {
    for (String[] c : CONCEPTS) if (has(normalized, c[1])) return c[0];
    return null;
  }

  public static Parsed parse(String raw) {
    String text = raw == null ? "" : raw.strip();
    String n = normalize(text);
    Intent intent = Intent.UNKNOWN;
    for (Rule r : RULES) {
      if (r.test().test(n)) {
        intent = r.intent();
        break;
      }
    }
    List<String> symbols = new ArrayList<>(tickers(text));
    // A bare symbol with no other recognised intent means "analyse this instrument".
    if (intent == Intent.UNKNOWN && !symbols.isEmpty()) intent = Intent.INSTRUMENT_ANALYSIS;
    if (intent == Intent.COMPARE_INSTRUMENTS && symbols.isEmpty() && !has(n, "ces deux|les deux")) {
      intent = has(n, "risque") ? Intent.COMPARE_BEFORE_AFTER : Intent.UNKNOWN;
    }
    Double percent = null;
    Matcher pm = PERCENT.matcher(n);
    if (pm.find()) percent = Double.parseDouble(pm.group(1).replace(',', '.'));
    Double fraction = null;
    if (has(n, "moitie")) fraction = 0.5;
    else if (has(n, "tiers")) fraction = 1.0 / 3;
    else if (has(n, "quart")) fraction = 0.25;
    else if (has(n, "la totalite|\\btout\\b")) fraction = 1.0;
    Integer year = null;
    Matcher ym = YEAR.matcher(n);
    if (ym.find()) year = Integer.parseInt(ym.group(1));
    boolean previous = has(n, "\\b(cette|ce|cet|celle|celui|la meme|le meme|ces deux|cela|ca)\\b");
    return new Parsed(intent, n, symbols, percent, fraction, year, conceptOf(n), previous);
  }

  static Set<String> tickers(String original) {
    Set<String> out = new LinkedHashSet<>();
    Matcher m = TICKER.matcher(original);
    while (m.find()) {
      String s = m.group(1);
      if (!NOT_TICKERS.contains(s) && !YEAR.matcher(s).matches()) out.add(s);
    }
    return out;
  }
}
