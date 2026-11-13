package com.pif.api.learning;

import static org.assertj.core.api.Assertions.assertThat;

import com.pif.api.learning.engine.Command;
import com.pif.api.learning.stories.StoryCatalog;
import com.pif.api.learning.stories.StoryCatalog.StoryDefinition;
import com.pif.api.learning.stories.StoryCatalog.StoryScene;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/** The French display layer of FinStories and of the Time Machine command list. */
class StoryCaptionsFrTest {

  private static final Pattern PLACEHOLDER = Pattern.compile("\\{(\\d+)}");

  @Test
  void frenchNumbersUseANonBreakingSpaceAndADecimalComma() {
    assertThat(LearningFr.number(10_000)).isEqualTo("10 000");
    assertThat(LearningFr.number(8_457.5)).isEqualTo("8 457,5");
    assertThat(LearningFr.number(990.25)).isEqualTo("990,25");
    assertThat(LearningFr.number(18_600)).isEqualTo("18 600");
  }

  @Test
  void everyPlaceholderOfEveryCaptionHasItsComputedAmount() {
    for (StoryDefinition story : StoryCatalog.STORIES) {
      for (StoryScene scene : story.scenes()) {
        String template = LearningFr.get("story.scene." + story.slug() + "." + scene.id(), null);
        assertThat(template).as("French caption of %s/%s", story.slug(), scene.id()).isNotNull();
        int needed = 0;
        Matcher m = PLACEHOLDER.matcher(template);
        while (m.find()) needed = Math.max(needed, Integer.parseInt(m.group(1)) + 1);
        assertThat(StoryCatalog.captionValues(story.slug(), scene.id()))
            .as("amounts for %s/%s", story.slug(), scene.id()).hasSize(needed);

        String caption = LearningFr.sceneCaption(story.slug(), scene.id(), scene.caption(),
            StoryCatalog.captionValues(story.slug(), scene.id()));
        assertThat(caption).as("%s/%s", story.slug(), scene.id()).doesNotContain("{").doesNotContain("}");
      }
    }
  }

  @Test
  void captionsQuoteTheSameAmountsAsTheEnglishScript() {
    StoryDefinition sarah = StoryCatalog.find("sarah-and-the-market-crash");
    String s2 = LearningFr.sceneCaption(sarah.slug(), "s2", "", StoryCatalog.captionValues(sarah.slug(), "s2"));
    // 10,000 DT falling 15 % is 8,500 DT in the English script.
    assertThat(sarah.scenes().get(1).caption()).contains("10,000").contains("8,500");
    assertThat(s2).contains("10 000").contains("8 500");
  }

  @Test
  void everyVisualTextIsTranslated() {
    for (StoryDefinition story : StoryCatalog.STORIES) {
      for (StoryScene scene : story.scenes()) {
        String base = "story.visual." + story.slug() + "." + scene.id() + ".";
        Map<String, Object> visual = scene.visual();
        for (String field : List.of("label", "text")) {
          if (visual.get(field) instanceof String) {
            assertThat(LearningFr.get(base + field, null)).as(base + field).isNotNull();
          }
        }
        if (visual.get("points") instanceof List<?> points) {
          for (int i = 0; i < points.size(); i++) {
            assertThat(LearningFr.get(base + "point." + i, null)).as(base + "point." + i).isNotNull();
          }
        }
        Map<String, Object> fr = LearningFr.sceneVisual(story.slug(), scene.id(), visual);
        assertThat(fr.keySet()).containsExactlyElementsOf(visual.keySet());
        assertThat(fr.get("type")).isEqualTo(visual.get("type"));
        assertThat(fr.get("series")).isEqualTo(visual.get("series"));
      }
    }
  }

  @Test
  void timeMachineCommandsAreDescribedInFrenchWithTheirIdentifiers() {
    assertThat(LearningViews.describeCommand(Command.fromJson(Map.of("type", "CANCEL_ORDER", "orderId", "o7"))))
        .isEqualTo("Annuler l'ordre o7");
    assertThat(LearningViews.describeCommand(Command.fromJson(Map.of("type", "PLACE_ORDER", "symbol", "OLV",
        "side", "BUY", "orderType", "LIMIT", "quantity", "120", "limitPrice", "9.85", "rationale", "DIVERSIFY"))))
        .isEqualTo("Achat 120 OLV à cours limité à 9.85 DT");
    assertThat(LearningViews.describeCommand(Command.fromJson(Map.of("type", "RUN_STRESS_TEST",
        "scenarioId", "equity-crash")))).isEqualTo("Test de résistance : Krach actions");
  }
}
