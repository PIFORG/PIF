package com.pif.api.learning;

import static com.pif.api.learning.LearningRepository.map;
import com.pif.api.data.Db;
import com.pif.api.learning.engine.Mastery;
import com.pif.api.learning.stories.StoryCatalog;
import com.pif.api.learning.stories.StoryCatalog.StoryDefinition;
import com.pif.api.learning.stories.StoryProgress;
import com.pif.api.learning.stories.StoryProgress.StoredProgress;
import com.pif.api.learning.stories.StoryProgress.ProgressUpdate;
import com.pif.api.security.AuthUser;
import com.pif.api.web.ApiException;
import java.time.Clock;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class StoriesService {
  private final LearningRepository repo;
  private final TransactionTemplate tx;
  private final Clock clock;
  public StoriesService(LearningRepository repo,TransactionTemplate tx,Clock clock) { this.repo=repo;this.tx=tx;this.clock=clock; }
  private StoryDefinition story(String slug) {
    var s=StoryCatalog.find(slug);
    if(s==null)throw new ApiException(HttpStatus.NOT_FOUND,"STORY_NOT_FOUND",com.pif.api.web.Messages.get("learning.story_not_found"));
    return s;
  }
  private StoredProgress stored(UUID user,String slug) {
    var rows=repo.jdbc().query("SELECT * FROM story_progress WHERE user_id=? AND story_slug=?",(r,n)->new StoredProgress(
        r.getInt("story_version"),r.getInt("position_ms"),r.getString("scene_id"),r.getBoolean("completed"),
        Db.instant(r,"completed_at"),(Integer)r.getObject("completed_version"),r.getString("reflection")),user,slug);
    return rows.isEmpty()?null:rows.getFirst();
  }
  private Map<String,Object> summary(StoryDefinition s) {
    return map("slug",s.slug(),"version",s.version(),"title",LearningFr.storyTitle(s.slug(),s.title()),"character",s.character(),"summary",LearningFr.storySummary(s.slug(),s.summary()),
        "competency",s.competency(),"level",s.level(),"relatedMissionSlug",s.relatedMissionSlug(),"durationMs",StoryCatalog.storyDuration(s),"media",StoryCatalog.media());
  }
  public Map<String,Object> feed(AuthUser user) {
    var weakest=Mastery.computeMastery(repo.observations(user.id())).stream().filter(m->m.score()!=null)
        .min(Comparator.comparingDouble(Mastery.CompetencyMastery::score)).map(Mastery.CompetencyMastery::competency).orElse(null);
    record Item(Map<String,Object> value,boolean complete,boolean recommended) {}
    var items=new ArrayList<Item>();
    for(var story:StoryCatalog.STORIES) {
      var value=summary(story);var progress=StoryProgress.progressView(story,stored(user.id(),story.slug()));
      boolean recommended=story.competency().equals(weakest);
      value.put("progress",progress.toJson());value.put("recommended",recommended);
      items.add(new Item(value,progress.completed(),recommended));
    }
    items.sort(Comparator.comparing(Item::complete).thenComparing(Item::recommended,Comparator.reverseOrder()));
    return map("weakestCompetency",weakest,"stories",items.stream().map(Item::value).toList());
  }
  public Map<String,Object> get(AuthUser user,String slug) {
    var s=story(slug);var value=summary(s);
    var scenes=new ArrayList<Map<String,Object>>();
    for(var scene:s.scenes()) {
      var json=new LinkedHashMap<>(scene.toJson());
      json.put("caption",LearningFr.sceneCaption(s.slug(),scene.id(),scene.caption()));
      scenes.add(json);
    }
    value.put("scenes",scenes);
    value.put("progress",StoryProgress.progressView(s,stored(user.id(),slug)).toJson());return value;
  }
  public Map<String,Object> save(AuthUser user,String slug,ProgressUpdate dto) {
    var s=story(slug);
    return tx.execute(status->{
      // Serializes first writes as well as updates, preventing a concurrent older playback save from clearing completion.
      repo.jdbc().queryForObject("SELECT id FROM users WHERE id=? FOR UPDATE",UUID.class,user.id());
      var now=clock.instant();var p=StoryProgress.nextProgress(s,stored(user.id(),slug),dto,now);
      repo.jdbc().update("INSERT INTO story_progress (id,user_id,story_slug,story_version,position_ms,scene_id,completed,completed_at,completed_version,reflection,updated_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (user_id,story_slug) DO UPDATE SET story_version=EXCLUDED.story_version,position_ms=EXCLUDED.position_ms,scene_id=EXCLUDED.scene_id,completed=EXCLUDED.completed,completed_at=EXCLUDED.completed_at,completed_version=EXCLUDED.completed_version,reflection=EXCLUDED.reflection,updated_at=EXCLUDED.updated_at",
          Db.newId(),user.id(),slug,p.storyVersion(),p.positionMs(),p.sceneId(),p.completed(),Db.ts(p.completedAt()),p.completedVersion(),p.reflection(),Db.ts(now),Db.ts(now));
      var value=map("slug",slug);value.putAll(StoryProgress.progressView(s,p).toJson());value.put("durationMs",StoryCatalog.storyDuration(s));return value;
    });
  }
}
