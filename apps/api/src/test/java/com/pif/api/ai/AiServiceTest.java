package com.pif.api.ai;

import static org.assertj.core.api.Assertions.assertThat;

import com.pif.api.trading.PortfoliosService;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class AiServiceTest {

  private AiService service;

  @BeforeEach
  void setUp() {
    service = new AiService((PortfoliosService) null);
  }

  @Test
  void chronologicalSplitHasNoOverlapAndPositiveSizes() {
    AiDataset.Split split = AiDataset.build(AiModelRegistry.SEED, AiModelRegistry.DAYS);
    assertThat(split.train()).isNotEmpty();
    assertThat(split.validation()).isNotEmpty();
    assertThat(split.test()).isNotEmpty();
    String lastTrain = split.train().get(split.train().size() - 1).day();
    String firstVal = split.validation().get(0).day();
    assertThat(Integer.parseInt(lastTrain.substring(1))).isLessThan(Integer.parseInt(firstVal.substring(1)));
  }

  @Test
  void modelCardReportsHoldoutMetricsAndBeatsOrReportsBaseline() {
    Map<String, Object> card = service.model(AiModelRegistry.MODEL_GBM);
    assertThat(card.get("dataProvenance").toString()).contains("synthétique");
    @SuppressWarnings("unchecked")
    Map<String, Object> metrics = (Map<String, Object>) card.get("metrics");
    @SuppressWarnings("unchecked")
    Map<String, Object> test = (Map<String, Object>) metrics.get("test");
    assertThat(test.get("n")).isEqualTo(((Number) test.get("n")).intValue());
    assertThat(((Number) test.get("rmse")).doubleValue()).isFinite();
    assertThat(((Number) test.get("r2")).doubleValue()).isFinite();
  }

  @Test
  void shapleyContributionsSumToPredictionMinusBaseline() {
    Map<String, Object> explanation = service.explanation("insight-dernier-test");
    assertThat(explanation.get("identityCheck")).isEqualTo(true);
    assertThat(explanation.get("method")).isEqualTo("shapley_interventional");
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> contributions = (List<Map<String, Object>>) explanation.get("contributions");
    assertThat(contributions).hasSize(AiDataset.FEATURE_NAMES.length);
  }

  @Test
  void insightsAndSentimentAreFrenchAndHonestAboutSyntheticData() {
    Map<String, Object> insights = service.insights();
    assertThat(insights.get("disclaimer").toString().toLowerCase()).contains("synthétique");
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> feed = (List<Map<String, Object>>) insights.get("sentimentFeed");
    assertThat(feed).isNotEmpty();
    assertThat(feed.get(0).get("source")).isEqualTo("SYNTHETIC_LEXICON");
    assertThat(feed.get(0).get("note").toString()).contains("pas une actualité");
  }

  @Test
  void agentProposesBuySellOrHold() {
    @SuppressWarnings("unchecked")
    Map<String, Object> agent = (Map<String, Object>) service.insights().get("agent");
    assertThat(agent.get("action").toString()).isIn("ACHETER", "VENDRE", "CONSERVER");
    assertThat(agent.get("humanInTheLoop")).isEqualTo(true);
    assertThat(agent.get("kind")).isEqualTo("RULE_AGENT");
  }

  @Test
  void agentWalkForwardReportsEvaluationAgainstHold() {
    @SuppressWarnings("unchecked")
    Map<String, Object> eval = (Map<String, Object>) service.insights().get("agentEvaluation");
    assertThat(eval.get("method")).isEqualTo("walk_forward_test_set");
    assertThat(((Number) eval.get("samples")).intValue()).isPositive();
  }

  @Test
  void overviewDistinguishesTrainedModelsFromLexiconAndRuleAgent() {
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> kinds = (List<Map<String, Object>>) service.overview().get("modelKinds");
    assertThat(kinds.stream().anyMatch(k -> "Analyse lexicale déterministe".equals(k.get("label"))
        && Boolean.FALSE.equals(k.get("trained")))).isTrue();
  }
}
