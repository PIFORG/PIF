package com.pif.api.learning;

import static com.pif.api.learning.LearningRepository.map;
import static com.pif.api.learning.engine.MissionCatalog.MISSIONS;
import com.pif.api.data.Db;
import com.pif.api.finance.Money;
import com.pif.api.learning.LearningRepository.Session;
import com.pif.api.learning.LearningRepository.Logged;
import com.pif.api.learning.engine.*;
import com.pif.api.learning.engine.Definitions.MissionDefinition;
import com.pif.api.learning.engine.Simulator.Context;
import com.pif.api.security.AuthUser;
import com.pif.api.web.ApiException;
import java.time.Clock;
import java.time.Instant;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/** Durable mission sessions rebuilt from their versioned, immutable command log. */
@Service
public class LearningService {
  private final LearningRepository repo;
  private final TransactionTemplate tx;
  private final Clock clock;
  public LearningService(LearningRepository repo, TransactionTemplate tx, Clock clock) {
    this.repo=repo; this.tx=tx; this.clock=clock;
  }
  private Instant now() { return clock.instant(); }
  private static ApiException error(HttpStatus status,String code,String message) { return new ApiException(status,code,message); }
  private static ApiException conflict() { return error(HttpStatus.CONFLICT,"SEQUENCE_CONFLICT",com.pif.api.web.Messages.get("learning.sequence_conflict")); }
  private MissionDefinition mission(String slug) {
    var m=MissionCatalog.find(slug);
    if(m==null)throw error(HttpStatus.NOT_FOUND,"MISSION_NOT_FOUND",com.pif.api.web.Messages.get("learning.mission_not_found"));
    return m;
  }
  private Context context(Session s) {
    var m=mission(s.slug());
    if(m.version()!=s.version())throw error(HttpStatus.CONFLICT,"MISSION_VERSION_RETIRED",com.pif.api.web.Messages.get("learning.mission_retired"));
    return Simulator.createContext(m);
  }
  private Session owned(UUID user,UUID id,boolean lock) {
    var s=repo.owned(user,id,lock);
    if(s==null)throw error(HttpStatus.NOT_FOUND,"SESSION_NOT_FOUND",com.pif.api.web.Messages.get("learning.session_not_found"));
    return s;
  }
  record Loaded(Session session,Context ctx,SimState state,List<Logged> commands) {}
  private Loaded load(UUID user,UUID id,boolean lock) {
    var s=owned(user,id,lock); var ctx=context(s); var log=repo.commands(id);
    var state=Simulator.initialState(ctx);
    for(var c:log) state=Simulator.applyCommand(ctx,state,c.command(),c.seq()).state();
    return new Loaded(s,ctx,state,log);
  }
  private Map<String,Object> view(Session s,Context ctx,SimState state) {
    return map("id",s.id(),"kind",s.kind(),"status",s.status(),"missionSlug",s.slug(),"missionVersion",s.version(),
        "parentSessionId",s.parent(),"branchFromSeq",s.branch(),"mentorMode",s.mode(),"assisted",s.assisted(),
        "lastSeq",s.seq(),"startedAt",Db.iso(s.started()),"endedAt",Db.iso(s.ended()),"countsTowardProfile",s.kind().equals("MISSION"),
        "mission",LearningViews.missionBriefing(ctx.mission()),"state",LearningViews.sessionState(ctx,state));
  }
  private Map<String,Object> view(Loaded l) { return view(l.session(),l.ctx(),l.state()); }
  public Map<String,Object> getMission(String slug) { return LearningViews.missionBriefing(mission(slug)); }
  private Map<String,Mastery.MissionProgress> progress(UUID user) {
    Map<String,Mastery.MissionProgress> result=new LinkedHashMap<>();
    for(var s:repo.sessions(user)) {
      if(!s.kind().equals("MISSION"))continue;
      var p=result.getOrDefault(s.slug(),new Mastery.MissionProgress(s.slug(),0,false,null));
      var a=repo.assessment(s.id());
      // Keep both branches as Double: mixing Double with Math.max's primitive double unboxes a null bestScore.
      Double best = a == null ? p.bestScore()
          : Double.valueOf(Math.max(p.bestScore() == null ? 0.0 : p.bestScore(), ((Number) a.get("total")).doubleValue()));
      result.put(s.slug(), new Mastery.MissionProgress(s.slug(), p.attempts() + 1,
          p.passed() || (a != null && Boolean.TRUE.equals(a.get("passed"))), best));
    }
    return result;
  }
  public Map<String,Object> listMissions(AuthUser user) {
    var progress=progress(user.id()); var sessions=repo.sessions(user.id());
    var unlocked=Mastery.unlockedLevel(MISSIONS,progress,user.user().experienceLevel());
    var rows=new ArrayList<Map<String,Object>>();
    for(var m:MISSIONS) {
      var p=progress.get(m.slug());
      var active=sessions.stream().filter(s->s.kind().equals("MISSION")&&s.status().equals("ACTIVE")&&s.slug().equals(m.slug())).findFirst().orElse(null);
      rows.add(map("slug",m.slug(),"version",m.version(),"order",m.order(),"title",LearningFr.missionTitle(m.slug(),m.title()),"level",m.level(),
          "availability",m.availability(),"summary",m.summary(),"estimatedMinutes",m.estimatedMinutes(),
          "competencies",LearningViews.competencies(m),"playable",MissionCatalog.isPlayable(m),
          "levelLocked",Definitions.LEVELS.indexOf(m.level())>Definitions.LEVELS.indexOf(unlocked),"relatedStorySlug",m.relatedStorySlug(),
          "progress",map("attempts",p==null?0:p.attempts(),"passed",p!=null&&p.passed(),"bestScore",p==null?null:p.bestScore(),
              "activeSessionId",active==null?null:active.id())));
    }
    return map("unlockedLevel",unlocked,"missions",rows);
  }
  public Map<String,Object> start(AuthUser user,String slug,String mode) {
    var m=mission(slug);
    if(!MissionCatalog.isPlayable(m))throw error(HttpStatus.CONFLICT,"MISSION_NOT_AVAILABLE",com.pif.api.web.Messages.get("learning.mission_unavailable"));
    return tx.execute(status->{
      // Lock the owner, as no active-session uniqueness constraint exists in the preserved schema.
      repo.jdbc().queryForObject("SELECT id FROM users WHERE id=? FOR UPDATE",UUID.class,user.id());
      var existing=repo.sessions(user.id()).stream().filter(s->s.kind().equals("MISSION")&&s.status().equals("ACTIVE")&&s.slug().equals(slug))
          .min(Comparator.comparing(Session::started)).orElse(null);
      if(existing!=null)return map("resumed",true,"session",view(load(user.id(),existing.id(),false)));
      var made=create(user.id(),Simulator.createContext(m),"MISSION",mode==null?m.mentorMode():mode,null,null,List.of());
      return map("resumed",false,"session",view(made));
    });
  }
  private Loaded create(UUID user,Context ctx,String kind,String mode,UUID parent,Integer branch,List<Command> commands) {
    var played=TimeMachine.play(ctx,commands); var state=played.state(); var id=Db.newId(); var time=now();
    repo.jdbc().update("INSERT INTO learning_sessions (id,user_id,mission_slug,mission_version,kind,status,parent_session_id,branch_from_seq,last_seq,current_step,equity_millimes,mentor_mode,assisted,started_at,updated_at,ended_at) VALUES (?,?,?,?,?::\"LearningSessionKind\",?::\"LearningSessionStatus\",?,?,?,?,?,?,?,?,?,?)",
        id,user,ctx.mission().slug(),ctx.mission().version(),kind,state.status,parent,branch,state.lastCommandSeq,state.step,
        (long)Simulator.equityOf(ctx,state),mode,state.hintsUsed>0,Db.ts(time),Db.ts(time),state.status.equals("ACTIVE")?null:Db.ts(time));
    for(var applied:played.applied())recordCommand(id,applied.seq(),applied.command(),"copy-"+applied.seq(),applied.result().outcome(),applied.step(),time);
    recordEvents(id,state.events,0,time);
    var session=owned(user,id,false);
    if(!state.status.equals("ACTIVE"))recordOutcome(session,ctx,state,time);
    return new Loaded(session,ctx,state,repo.commands(id));
  }
  private void recordCommand(UUID id,int seq,Command command,String key,String outcome,int step,Instant time) {
    repo.jdbc().update("INSERT INTO learning_commands (id,session_id,seq,type,payload,idempotency_key,outcome,step,created_at) VALUES (?,?,?,?,?::jsonb,?,?,?,?)",
        Db.newId(),id,seq,command.type(),repo.encode(command.toJson()),key,outcome,step,Db.ts(time));
  }
  private void recordEvents(UUID id,List<SimState.DomainEvent> events,int first,Instant time) {
    for(int i=first;i<events.size();i++) {
      var e=events.get(i);
      repo.jdbc().update("INSERT INTO learning_events (id,session_id,ordinal,command_seq,type,step,data,created_at) VALUES (?,?,?,?,?,?,?::jsonb,?)",
          Db.newId(),id,i,e.commandSeq(),e.type(),e.step(),repo.encode(e.data()),Db.ts(time));
    }
  }
  private void recordOutcome(Session s,Context ctx,SimState state,Instant time) {
    var a=Assessments.assessSession(ctx,state);
    repo.jdbc().update("INSERT INTO learning_assessments (id,session_id,user_id,mission_slug,mission_version,engine_version,total,passed,assisted,result,created_at) VALUES (?,?,?,?,?,?,?,?,?,?::jsonb,?)",
        Db.newId(),s.id(),s.userId(),s.slug(),s.version(),a.engineVersion(),a.total(),a.passed(),a.assisted(),repo.encode(a.toJson()),Db.ts(time));
    if(!s.kind().equals("MISSION"))return;
    for(var entry:a.competencyScores().entrySet()) {
      if(entry.getValue()==null)continue;
      double weight=ctx.mission().competencies().stream().filter(c->c.competency().equals(entry.getKey())).mapToDouble(Definitions.CompetencyWeight::weight).findFirst().orElse(Mastery.NON_TARGET_WEIGHT);
      repo.jdbc().update("INSERT INTO competency_observations (id,user_id,session_id,competency,score,weight,assisted,created_at) VALUES (?,?,?,?,?,?,?,?)",
          Db.newId(),s.userId(),s.id(),entry.getKey(),entry.getValue(),weight,a.assisted(),Db.ts(time));
    }
  }
  private record Appended(Session session,Simulator.CommandResult result) {}
  private Appended append(Loaded loaded,Command command,String key) {
    var s=loaded.session();
    if(!s.status().equals("ACTIVE"))throw error(HttpStatus.CONFLICT,"SESSION_CLOSED",com.pif.api.web.Messages.get("learning.session_closed"));
    Simulator.CommandResult result;
    try { result=Simulator.applyCommand(loaded.ctx(),loaded.state(),command,s.seq()+1); }
    catch(Simulator.SimulationError e) { throw error(HttpStatus.UNPROCESSABLE_ENTITY,e.code(),e.getMessage()); }
    var next=result.state(); var time=now();
    int changed=repo.jdbc().update("UPDATE learning_sessions SET last_seq=?,current_step=?,status=?::\"LearningSessionStatus\",equity_millimes=?,assisted=?,ended_at=?,updated_at=? WHERE id=? AND last_seq=? AND status='ACTIVE'",
        next.lastCommandSeq,next.step,next.status,(long)Simulator.equityOf(loaded.ctx(),next),next.hintsUsed>0,
        next.status.equals("ACTIVE")?null:Db.ts(time),Db.ts(time),s.id(),s.seq());
    if(changed!=1)throw conflict();
    recordCommand(s.id(),s.seq()+1,command,key,result.outcome(),loaded.state().step,time);
    recordEvents(s.id(),next.events,loaded.state().events.size(),time);
    if(!next.status.equals("ACTIVE"))recordOutcome(s,loaded.ctx(),next,time);
    return new Appended(owned(s.userId(),s.id(),false),result);
  }
  public Map<String,Object> command(AuthUser user,UUID id,LearningDtos.Submit dto) {
    return tx.execute(status->{
      var loaded=load(user.id(),id,true);
      var previous=repo.jdbc().query("SELECT seq,payload::text FROM learning_commands WHERE session_id=? AND idempotency_key=?",
          (r,n)->map("seq",r.getInt("seq"),"payload",repo.parse(r.getString("payload"))),id,dto.key());
      if(!previous.isEmpty()) {
        var prior=previous.getFirst();
        // Key-order-independent JSON, matching NestJS learning.service.ts `canonical`.
        if (!canonical(prior.get("payload")).equals(canonical(dto.command().toJson())))
          throw error(HttpStatus.UNPROCESSABLE_ENTITY,"IDEMPOTENCY_KEY_REUSED",com.pif.api.web.Messages.get("learning.idempotency_reused"));
        var state=Simulator.initialState(loaded.ctx()); Simulator.CommandResult result=null;
        for(var c:loaded.commands()) {
          result=Simulator.applyCommand(loaded.ctx(),state,c.command(),c.seq()); state=result.state();
          if(c.seq()==((Number)prior.get("seq")).intValue())break;
        }
        return map("replayed",true,"outcome",result.outcome(),"message",result.message(),"session",view(loaded));
      }
      if(dto.seq()!=loaded.session().seq())throw conflict();
      var added=append(loaded,dto.command(),dto.key());
      return map("replayed",false,"outcome",added.result().outcome(),"message",added.result().message(),
          "session",view(added.session(),loaded.ctx(),added.result().state()));
    });
  }
  public Map<String,Object> getSession(AuthUser user,UUID id) { return view(load(user.id(),id,false)); }
  public Map<String,Object> preview(AuthUser user,UUID id,Command command) {
    if(!command.isPlaceOrder())throw error(HttpStatus.UNPROCESSABLE_ENTITY,"NOT_AN_ORDER",com.pif.api.web.Messages.get("learning.not_an_order"));
    var l=load(user.id(),id,false); return LearningViews.orderPreviewView(Simulator.previewOrder(l.ctx(),l.state(),command));
  }
  public Map<String,Object> abandon(AuthUser user,UUID id) {
    return tx.execute(status->{
      owned(user.id(),id,true); var time=Db.ts(now());
      if(repo.jdbc().update("UPDATE learning_sessions SET status='ABANDONED',ended_at=?,updated_at=? WHERE id=? AND status='ACTIVE'",time,time,id)!=1)
        throw error(HttpStatus.CONFLICT,"SESSION_CLOSED",com.pif.api.web.Messages.get("learning.session_closed_abandon"));
      return getSession(user,id);
    });
  }
  private Map<String,Object> assessmentSummary(UUID id) {
    var a=repo.assessment(id);return a==null?null:map("total",a.get("total"),"passed",a.get("passed"));
  }
  public List<Map<String,Object>> sessions(AuthUser user) {
    return repo.sessions(user.id()).stream().limit(50).map(s->map("id",s.id(),"kind",s.kind(),"status",s.status(),"missionSlug",s.slug(),
        "missionTitle",MissionCatalog.find(s.slug())==null?s.slug():LearningFr.missionTitle(s.slug(),mission(s.slug()).title()),"parentSessionId",s.parent(),"branchFromSeq",s.branch(),
        "currentStep",s.step(),"equity",s.equity()==null?null:Money.fromAmount(s.equity()),"startedAt",Db.iso(s.started()),"endedAt",Db.iso(s.ended()),
        "assessment",assessmentSummary(s.id()))).toList();
  }
  public Map<String,Object> assessment(AuthUser user,UUID id) {
    var s=owned(user.id(),id,false); var a=repo.assessment(id);
    if(a==null)throw error(HttpStatus.NOT_FOUND,"ASSESSMENT_NOT_READY",com.pif.api.web.Messages.get("learning.assessment_not_ready"));
    // Mirror NestJS assessmentView: spread stored fields (metrics keeps its place), then countsTowardProfile + createdAt.
    Map<String,Object> out=new LinkedHashMap<>();
    String createdAt=a.get("createdAt") instanceof String iso?iso:null;
    for(var e:a.entrySet()) {
      if("createdAt".equals(e.getKey()))continue;
      out.put(e.getKey(),e.getValue());
    }
    if(out.get("metrics") instanceof Map<?,?> raw) {
      @SuppressWarnings("unchecked") Map<String,Object> metrics=new LinkedHashMap<>((Map<String,Object>)raw);
      for(String k:List.of("equity","cash","invested","realizedPnl","unrealizedPnl","var95","es95","feesPaid","spreadCost"))
        if(metrics.get(k) instanceof Number n)metrics.put(k,Money.fromAmount(n.doubleValue()));
      out.put("metrics",metrics);
    }
    out.put("countsTowardProfile",s.kind().equals("MISSION"));
    out.put("createdAt",createdAt);
    return out;
  }

  /** NestJS `canonical`: sorted object keys, JSON.stringify of leaves (js number text). */
  private static String canonical(Object value) {
    if(value==null)return "null";
    if(value instanceof List<?> list){
      StringBuilder sb=new StringBuilder("[");
      for(int i=0;i<list.size();i++){if(i>0)sb.append(',');sb.append(canonical(list.get(i)));}
      return sb.append(']').toString();
    }
    if(value instanceof Map<?,?> map){
      List<String> keys=new ArrayList<>();
      for(Object k:map.keySet())if(k!=null)keys.add(k.toString());
      keys.sort(String::compareTo);
      StringBuilder sb=new StringBuilder("{");
      boolean first=true;
      for(String k:keys){
        Object v=map.get(k);
        if(!first)sb.append(',');
        first=false;
        sb.append(repoJsonString(k)).append(':').append(canonical(v));
      }
      return sb.append('}').toString();
    }
    if(value instanceof Number n){
      String text=com.pif.api.web.JsNumbers.toJson(n.doubleValue());
      return text==null?"null":text;
    }
    if(value instanceof Boolean b)return b?"true":"false";
    if(value instanceof String s)return repoJsonString(s);
    return repoJsonString(String.valueOf(value));
  }

  private static String repoJsonString(String s) {
    StringBuilder out=new StringBuilder("\"");
    for(int i=0;i<s.length();i++){
      char c=s.charAt(i);
      switch(c){
        case '"'->out.append("\\\"");
        case '\\'->out.append("\\\\");
        case '\b'->out.append("\\b");
        case '\f'->out.append("\\f");
        case '\n'->out.append("\\n");
        case '\r'->out.append("\\r");
        case '\t'->out.append("\\t");
        default->{
          if(c<0x20)out.append(String.format("\\u%04x",(int)c));
          else out.append(c);
        }
      }
    }
    return out.append('"').toString();
  }
  public Map<String,Object> mentor(AuthUser user,UUID id,String mode) {
    return tx.execute(status->{
      var l=load(user.id(),id,true); var s=l.session(); var state=l.state(); Mentor.MentorMessage message;
      if(s.status().equals("ACTIVE")) {
        String selected=mode==null?s.mode():mode;
        if(selected.equals("DEBRIEF"))throw error(HttpStatus.UNPROCESSABLE_ENTITY,"DEBRIEF_NOT_AVAILABLE",com.pif.api.web.Messages.get("learning.debrief_not_available"));
        var added=append(l,Command.of("REQUEST_HINT"),"mentor-"+Db.newId()); s=added.session();state=added.result().state();
        message=Mentor.mentorDuringSession(l.ctx(),state,selected);
      } else if(s.status().equals("ABANDONED"))throw error(HttpStatus.CONFLICT,"SESSION_ABANDONED",com.pif.api.web.Messages.get("learning.session_abandoned"));
      else message=Mentor.mentorDebrief(l.ctx(),state,Assessments.assessSession(l.ctx(),state));
      repo.jdbc().update("INSERT INTO mentor_interactions (id,user_id,session_id,mode,source,rule_id,step,response,created_at) VALUES (?,?,?,?,?,?,?,?::jsonb,?)",
          Db.newId(),user.id(),id,message.mode(),message.source(),message.ruleId(),state.step,repo.encode(message.toJson()),Db.ts(now()));
      return map("mentor",message.toJson(),"session",view(s,l.ctx(),state));
    });
  }
  private List<Map<String,Object>> curve(SimState s) {
    return s.history.stream().map(h->map("step",h.step(),"equity",Money.fromAmount(h.equity()))).toList();
  }
  public Map<String,Object> timeline(AuthUser user,UUID id) {
    var l=load(user.id(),id,false);var s=l.session();
    var branches=repo.sessions(user.id()).stream().filter(b->id.equals(b.parent())).map(b->map("id",b.id(),"status",b.status(),
        "branchFromSeq",b.branch(),"startedAt",Db.iso(b.started()),"assessment",assessmentSummary(b.id()))).toList();
    return map("sessionId",id,"kind",s.kind(),"status",s.status(),"missionSlug",s.slug(),"missionTitle",LearningFr.missionTitle(l.ctx().mission().slug(),l.ctx().mission().title()),
        "canBranch",!s.status().equals("ACTIVE"),"decisions",l.commands().stream().map(c->map("seq",c.seq(),"step",c.step(),
            "type",c.command().type(),"summary",LearningViews.describeCommand(c.command()),"rationale",c.command().isPlaceOrder()?c.command().rationale():null,
            "outcome",c.outcome(),"at",Db.iso(c.created()))).toList(),"equityCurve",curve(l.state()),
        "news",l.ctx().mission().scenario().events().stream().filter(e->e.step()<=l.state().step)
            .map(e->map("id",e.id(),"step",e.step(),"headline",LearningFr.get("mission."+l.ctx().mission().slug()+".event."+e.id()+".headline",e.headline()),"sentiment",e.sentiment())).toList(),"branches",branches);
  }
  public Map<String,Object> branch(AuthUser user,UUID id,int from,String strategy) {
    return tx.execute(status->{
      var l=load(user.id(),id,true);
      if(l.session().status().equals("ACTIVE"))throw error(HttpStatus.CONFLICT,"BRANCH_REQUIRES_ENDED_SESSION",
          com.pif.api.web.Messages.get("learning.branch_requires_ended"));
      if(from>l.session().seq())throw error(HttpStatus.UNPROCESSABLE_ENTITY,"INVALID_BRANCH_POINT",
          com.pif.api.web.Messages.format("learning.invalid_branch",l.session().seq()));
      var commands=TimeMachine.branchCommands(l.ctx(),l.commands().stream().map(c->new Simulator.RecordedCommand(c.seq(),c.command())).toList(),from,strategy);
      return view(create(user.id(),l.ctx(),"REPLAY",l.session().mode(),id,from,commands));
    });
  }
  private Map<String,Object> comparison(Loaded l) {
    var a=l.state().status.equals("ACTIVE")?null:Assessments.assessSession(l.ctx(),l.state());
    var s=l.session();
    return map("id",s.id(),"kind",s.kind(),"status",s.status(),"branchFromSeq",s.branch(),"countsTowardProfile",s.kind().equals("MISSION"),
        "step",l.state().step,"decisions",l.commands().stream().filter(c->c.command().isPlaceOrder()||c.command().type().equals("CANCEL_ORDER")).count(),
        "metrics",LearningViews.metricsView(l.ctx(),l.state()),"assessment",a==null?null:map("total",a.total(),"passed",a.passed(),
            "components",a.components().stream().map(c->map("key",c.key(),"score",c.score())).toList()),"equityCurve",curve(l.state()));
  }
  public Map<String,Object> compare(AuthUser user,UUID id,UUID other) {
    var a=load(user.id(),id,false); var b=load(user.id(),other,false);
    if(!a.session().slug().equals(b.session().slug())||a.session().version()!=b.session().version())
      throw error(HttpStatus.UNPROCESSABLE_ENTITY,"NOT_COMPARABLE",com.pif.api.web.Messages.get("learning.not_comparable"));
    Integer divergence=null;
    for(int i=0;i<Math.max(a.commands().size(),b.commands().size());i++) {
      if(i>=a.commands().size()||i>=b.commands().size()||!a.commands().get(i).command().equals(b.commands().get(i).command())) { divergence=i+1;break; }
    }
    return map("missionSlug",a.session().slug(),"missionTitle",LearningFr.missionTitle(a.ctx().mission().slug(),a.ctx().mission().title()),"divergenceSeq",divergence,
        "note", LearningFr.timemachineCompareNote(),
        "sessions",List.of(comparison(a),comparison(b)));
  }
  public Map<String,Object> profile(AuthUser user) {
    var progress=progress(user.id());var mastery=Mastery.computeMastery(repo.observations(user.id()));var sessions=repo.sessions(user.id());
    var assessments=sessions.stream().filter(s->s.kind().equals("MISSION")).map(s->{
      var a=repo.assessment(s.id());if(a!=null)a.put("sessionId",s.id());return a;
    }).filter(Objects::nonNull).sorted(Comparator.comparing(a->(String)a.get("createdAt"),Comparator.reverseOrder())).limit(20).toList();
    double rated=0,observed=0,brier=0,confidence=0,hits=0,signals=0;
    for(var a:assessments) {
      if(!(a.get("calibration") instanceof Map<?,?> c)||!"MARKET_ADJUSTED".equals(c.get("method")))continue;
      double orders=num(c.get("orders"));if(orders==0)continue;
      rated+=orders;confidence+=num(c.get("meanConfidence"))*orders;
      signals+=c.get("signals") instanceof List<?> list?list.size():0;
      double count=num(c.get("observations"));if(count==0||c.get("brierScore")==null)continue;
      observed+=count;brier+=num(c.get("brierScore"))*count;hits+=num(c.get("hitRate"))*count;
    }
    var active=sessions.stream().filter(s->s.status().equals("ACTIVE")).sorted(Comparator.comparing(Session::updated).reversed())
        .map(s->map("id",s.id(),"kind",s.kind(),"missionSlug",s.slug(),"currentStep",s.step(),"updatedAt",Db.iso(s.updated()),"missionTitle",LearningFr.missionTitle(s.slug(),mission(s.slug()).title()))).toList();
    var recent=assessments.stream().limit(5).map(a->map("sessionId",a.get("sessionId"),"missionSlug",a.get("missionSlug"),
        "missionTitle",LearningFr.missionTitle((String)a.get("missionSlug"),mission((String)a.get("missionSlug")).title()),"total",a.get("total"),"passed",a.get("passed"),"assisted",a.get("assisted"),"createdAt",a.get("createdAt"))).toList();
    return map("experienceLevel",user.user().experienceLevel(),"unlockedLevel",Mastery.unlockedLevel(MISSIONS,progress,user.user().experienceLevel()),
        "competencies",mastery.stream().map(Mastery.CompetencyMastery::toJson).toList(),
        "stats",map("missionsPassed",progress.values().stream().filter(Mastery.MissionProgress::passed).count(),"missionsAttempted",progress.size(),
            "assessedSessions",assessments.size(),"implementedMissions",MISSIONS.stream().filter(m->m.availability().equals("IMPLEMENTED")).count(),
            "playableMissions",MISSIONS.stream().filter(MissionCatalog::isPlayable).count()),"activeSessions",active,"recentAssessments",recent,
        "recommendations",Mastery.recommend(MISSIONS,progress,mastery,user.user().experienceLevel()).stream().map(Mastery.Recommendation::toJson).toList(),
        "calibration",map("ratedOrders",rated,"observations",observed,"minimumOrders",Assessments.CALIBRATION_MIN_ORDERS,"interpretable",observed>=Assessments.CALIBRATION_MIN_ORDERS,
            "brierScore",observed>0?brier/observed:null,"meanConfidence",rated>0?confidence/rated:null,"hitRate",observed>0?hits/observed:null,"signals",signals,
            "note", LearningFr.profileCalibrationNote(Assessments.CALIBRATION_MIN_ORDERS)));
  }
  private static double num(Object o) { return o instanceof Number n?n.doubleValue():0; }
}
