package com.pif.api.echo;

import static org.assertj.core.api.Assertions.assertThat;

import com.pif.api.echo.EchoIntentRouter.Intent;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/** The questions of the ÉCHO specification, routed by the deterministic French router. */
class EchoIntentRouterTest {

  @ParameterizedTest(name = "{0} → {1}")
  @CsvSource(delimiter = '|', value = {
      "Quelle est la performance de mon portefeuille ?|PORTFOLIO_PERFORMANCE",
      "Pourquoi mon risque a-t-il augmenté ?|PORTFOLIO_RISK",
      "Quels actifs représentent ma plus grande exposition ?|PORTFOLIO_EXPOSURE",
      "Pourquoi suis-je autant exposé ?|PORTFOLIO_EXPOSURE",
      "Que s'est-il passé sur ce titre pendant la crise de 2020 ?|CRISIS",
      "Compare la volatilité de ces deux instruments.|COMPARE_INSTRUMENTS",
      "Explique-moi pourquoi cette prévision est incertaine.|FORECAST",
      "Quel serait l'impact d'une baisse simulée de 10 % ?|STRESS_SCENARIO",
      "Et si le marché chutait de 15 % ?|STRESS_SCENARIO",
      "Quelle décision ai-je prise lors de ma dernière mission ?|MISSION_REVIEW",
      "Qu'aurais-je pu faire différemment ?|ALTERNATIVE",
      "Et si je n'avais pas vendu ?|ALTERNATIVE",
      "Explique-moi ce que signifie la VaR.|CONCEPT",
      "Pourquoi mon ordre a-t-il été rejeté ?|ORDER_REJECTION",
      "Analyse mon portefeuille.|PORTFOLIO_PERFORMANCE",
      "Et si je vendais la moitié de cette position ?|WHATIF_SELL",
      "Compare le risque avant et après.|COMPARE_BEFORE_AFTER",
      "Peux-tu analyser cet actif ?|INSTRUMENT_ANALYSIS",
      "Examiner le risque de cet ordre|PRETRADE",
      "Pourquoi cette prime est-elle élevée ?|ACTUARIAL",
      "Qu'est-ce qui influence la probabilité de sinistre ?|ACTUARIAL",
      "Pourquoi cette banque est-elle vulnérable ?|BANK_STRESS",
      "Bonjour|GREETING",
      "Que peux-tu faire ?|HELP",
      "Montre mon journal de décisions.|JOURNAL",
      "Qu'est-ce que le HHI ?|CONCEPT",
      "Explique-moi mon dernier épisode FinStories.|STORY",
  })
  void routesSpecificationQuestions(String question, Intent expected) {
    assertThat(EchoIntentRouter.parse(question).intent()).isEqualTo(expected);
  }

  @Test
  void extractsEntities() {
    var p = EchoIntentRouter.parse("Et si le marché chutait de 12,5 % sur CTB en 2020 ?");
    assertThat(p.percent()).isEqualTo(12.5);
    assertThat(p.year()).isEqualTo(2020);
    assertThat(p.symbolCandidates()).containsExactly("CTB");
    assertThat(EchoIntentRouter.parse("vendre le tiers").fraction()).isEqualTo(1.0 / 3);
    assertThat(EchoIntentRouter.parse("Et si je vendais la moitié de cette position ?").refersToPrevious()).isTrue();
  }

  @Test
  void financialAcronymsAreNotTickers() {
    assertThat(EchoIntentRouter.parse("Quelle est la VaR, le CET1 et le LCR en TND ?").symbolCandidates()).isEmpty();
  }

  @Test
  void bareSymbolMeansInstrumentAnalysis() {
    assertThat(EchoIntentRouter.parse("BIAT").intent()).isEqualTo(Intent.INSTRUMENT_ANALYSIS);
  }

  @Test
  void ambiguousQuestionUsesPageContextNeverAGuess() {
    var mission = new EchoConversationService.ClientContext("/learn/sessions/x", "MISSION", null, null, null, null, null,
        null, Map.of());
    assertThat(EchoConversationService.contextual(Intent.UNKNOWN, mission)).isEqualTo(Intent.MISSION_REVIEW);
    var nowhere = new EchoConversationService.ClientContext("/dashboard", "DASHBOARD", null, null, null, null, null,
        null, Map.of());
    assertThat(EchoConversationService.contextual(Intent.UNKNOWN, nowhere)).isEqualTo(Intent.UNKNOWN);
    var ticket = new EchoConversationService.ClientContext("/trading", "TRADING", "CTB", null, null, null, null, null,
        Map.of("symbol", "CTB", "side", "BUY", "quantity", 5));
    assertThat(EchoConversationService.contextual(Intent.UNKNOWN, ticket)).isEqualTo(Intent.PRETRADE);
  }

  @Test
  void accentsAndCaseAreFolded() {
    assertThat(EchoIntentRouter.normalize("Qu’EST-CE  que la Volatilité ?")).isEqualTo("qu'est-ce que la volatilite ?");
  }

  @Test
  void orderTermsRequireExplicitQuantity() {
    assertThat(EchoRiskAdvisor.terms(Map.of("symbol", "CTB", "side", "BUY"))).isNull();
    assertThat(EchoRiskAdvisor.terms(Map.of("symbol", "CTB", "side", "HOLD", "quantity", 3))).isNull();
    assertThat(EchoRiskAdvisor.terms(Map.of("symbol", "ctb", "side", "sell", "quantity", 3)).side()).isEqualTo("SELL");
  }
}
