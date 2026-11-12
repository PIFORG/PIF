package com.pif.api.actuarial;

import static com.pif.api.actuarial.Js.obj;
import com.pif.api.data.Db;
import com.pif.api.web.ApiException;
import jakarta.annotation.PreDestroy;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Supplier;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

@Service
public class ActuarialService {
  private final JdbcTemplate jdbc; private final TransactionTemplate tx; private final ObjectMapper mapper;
  private final ThreadPoolExecutor workers=new ThreadPoolExecutor(2,2,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(6),Thread.ofPlatform().name("actuarial-simulation-",0).factory(),new ThreadPoolExecutor.AbortPolicy());
  private volatile Map<String,Object> presetCache;
  public ActuarialService(JdbcTemplate jdbc,TransactionTemplate tx,ObjectMapper mapper){this.jdbc=jdbc;this.tx=tx;this.mapper=mapper;}
  @PreDestroy void close(){workers.shutdownNow();}
  static <T>T compute(Supplier<T> fn){try{return fn.get();}catch(AssumptionException e){throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"INVALID_ASSUMPTIONS",com.pif.api.web.Messages.format("actuarial.invalid_assumptions",e.getMessage()));}catch(SimulationLimitException e){throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"SIMULATION_LIMIT",com.pif.api.web.Messages.format("actuarial.simulation_limit",e.getMessage()));}}
  public Map<String,Object> presets(){var value=presetCache;if(value==null){value=obj("modelVersion",Presets.MODEL_VERSION,"currency",Presets.CURRENCY,"presets",Presets.ALL.stream().map(p->obj("id",p.id(),"name",p.name(),"description",p.description(),"provenance",p.provenance(),"assumptions",p.assumptions().toJson(),"headline",ActuarialView.pricingHeadline(ActuarialView.pricing(p.assumptions())))).toList());presetCache=value;}return value;}
  public Map<String,Object> frequency(Map<String,Object> body){var a=ActuarialDtos.frequencyRequest(body);return compute(()->obj("provenance",ActuarialView.provenance(),"frequency",ActuarialView.frequency(Frequency.model(a))));}
  public Map<String,Object> severity(Map<String,Object> body){var r=ActuarialDtos.severityRequest(body);return compute(()->obj("provenance",ActuarialView.provenance(),"severity",ActuarialView.severity(Severity.model(r.assumptions()),r.thresholds())));}
  public Map<String,Object> aggregate(Map<String,Object> body){var r=ActuarialDtos.aggregateRequest(body);return compute(()->obj("provenance",ActuarialView.provenance(),"aggregate",ActuarialView.aggregate(Frequency.model(r.frequency()),Severity.model(r.severity()),r.thresholds(),null)));}
  public Map<String,Object> price(Map<String,Object> body){var a=ActuarialDtos.pricing(body);return compute(()->ActuarialView.pricing(a));}
  public Map<String,Object> overview(UUID user){var p=Presets.ALL.getFirst();var scenarios=rows("actuarial_scenarios",user,false);var simulations=rows("actuarial_simulation_runs",user,false);var reserves=jdbc.query("SELECT id,label,valuation_year,created_at FROM actuarial_reserving_runs WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 5",(rs,i)->obj("id",rs.getObject("id").toString(),"label",rs.getString("label"),"valuationYear",rs.getInt("valuation_year"),"createdAt",Db.iso(Db.instant(rs,"created_at"))),user);
    return obj("modelVersion",Presets.MODEL_VERSION,"currency",Presets.CURRENCY,"reference",obj("id",p.id(),"name",p.name(),"description",p.description(),"provenance",p.provenance(),"pricing",ActuarialView.pricing(p.assumptions())),"scenarios",obj("available",true,"count",scenarios.size(),"limit",50,"recent",scenarios.stream().limit(5).toList()),"simulations",obj("available",true,"count",simulations.size(),"kept",25,"recent",simulations.stream().limit(5).toList()),"reserving",obj("available",true,"count",jdbc.queryForObject("SELECT count(*) FROM actuarial_reserving_runs WHERE user_id=?",Integer.class,user),"kept",25,"recent",reserves),"workspaces",List.of(obj("id","pricing","title","Claims & Pricing Studio","status","AVAILABLE"),obj("id","monte-carlo","title","Monte Carlo Lab","status","AVAILABLE"),obj("id","reserving","title","Reserving Studio","status","AVAILABLE"),obj("id","capital","title","Economic Capital","status","PLANNED"),obj("id","alm","title","ALM Lab","status","PLANNED")));
  }
  public Map<String,Object> scenarios(UUID user){return obj("limit",50,"scenarios",rows("actuarial_scenarios",user,false));}
  public Map<String,Object> simulations(UUID user){return obj("kept",25,"runs",rows("actuarial_simulation_runs",user,false));}
  public Map<String,Object> scenario(UUID user,UUID id){return get("actuarial_scenarios",user,id);}
  public Map<String,Object> simulation(UUID user,UUID id){return get("actuarial_simulation_runs",user,id);}
  public void deleteScenario(UUID user,UUID id){delete("actuarial_scenarios",user,id);}
  public void deleteSimulation(UUID user,UUID id){delete("actuarial_simulation_runs",user,id);}
  public Map<String,Object> save(UUID user,Map<String,Object> body){var dto=ActuarialDtos.scenario(body);var result=compute(()->ActuarialView.pricing(dto.assumptions()));try{return tx.execute(status->{lock("actuarial-scenarios:",user);int count=jdbc.queryForObject("SELECT count(*) FROM actuarial_scenarios WHERE user_id=?",Integer.class,user);if(count>=50)throw new ApiException(HttpStatus.CONFLICT,"SCENARIO_LIMIT",com.pif.api.web.Messages.get("actuarial.scenario_limit"));UUID id=UUID.randomUUID();var now=Db.ts(Db.now());jdbc.update("INSERT INTO actuarial_scenarios (id,user_id,name,kind,model_version,currency,inputs,results,created_at,updated_at) VALUES (?,?,?,'PRICING',?,'TND',?::jsonb,?::jsonb,?,?)",id,user,dto.name(),Presets.MODEL_VERSION,mapper.writeValueAsString(dto.assumptions().toJson()),mapper.writeValueAsString(result),now,now);return scenario(user,id);});}catch(DuplicateKeyException e){throw new ApiException(HttpStatus.CONFLICT,"SCENARIO_NAME_TAKEN",com.pif.api.web.Messages.get("actuarial.scenario_name_taken"));}}
  public CompletableFuture<Map<String,Object>> simulate(UUID user,Map<String,Object> body){var dto=ActuarialDtos.simulation(body);compute(()->Simulation.prepare(dto.input()));try{return CompletableFuture.supplyAsync(()->{long start=System.nanoTime();var result=compute(()->ActuarialView.simulation(Simulation.run(dto.input(),()->{if(Thread.currentThread().isInterrupted()||System.nanoTime()-start>30_000_000_000L)throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"SIMULATION_TIMEOUT",com.pif.api.web.Messages.get("actuarial.simulation_timeout"));})));int duration=(int)Math.round((System.nanoTime()-start)/1_000_000.0);return tx.execute(status->{lock("actuarial-simulations:",user);UUID id=UUID.randomUUID();var inputs=obj("assumptions",dto.input().assumptions().toJson(),"initialCapital",dto.input().initialCapital(),"premiumCharged",dto.input().premiumCharged());jdbc.update("INSERT INTO actuarial_simulation_runs (id,user_id,label,engine_version,currency,seed,simulations,duration_ms,inputs,results,created_at) VALUES (?,?,?,?,'TND',?,?,?,?::jsonb,?::jsonb,?)",id,user,dto.label(),Simulation.ENGINE_VERSION,(int)dto.input().seed(),(int)dto.input().simulations(),duration,mapper.writeValueAsString(inputs),mapper.writeValueAsString(result),Db.ts(Db.now()));jdbc.update("DELETE FROM actuarial_simulation_runs WHERE user_id=? AND id IN (SELECT id FROM actuarial_simulation_runs WHERE user_id=? ORDER BY created_at DESC,id DESC OFFSET 25)",user,user);return simulation(user,id);});},workers);}catch(RejectedExecutionException e){throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"SIMULATION_BUSY",com.pif.api.web.Messages.get("actuarial.simulation_busy"));}}
  private void lock(String scope,UUID user){jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",(rs,n)->0,scope+user);}
  private List<Map<String,Object>> rows(String table,UUID user,boolean detail){return jdbc.query("SELECT * FROM "+table+" WHERE user_id=? ORDER BY "+(table.equals("actuarial_scenarios")?"updated_at DESC":"created_at DESC,id DESC"),(rs,n)->view(rs,table,detail),user);}
  private Map<String,Object> get(String table,UUID user,UUID id){var values=jdbc.query("SELECT * FROM "+table+" WHERE id=? AND user_id=?",(rs,n)->view(rs,table,true),id,user);if(values.isEmpty())throw notFound(table);return values.getFirst();}
  private void delete(String table,UUID user,UUID id){if(jdbc.update("DELETE FROM "+table+" WHERE id=? AND user_id=?",id,user)==0)throw notFound(table);}
  private ApiException notFound(String table){boolean scenario=table.equals("actuarial_scenarios");return new ApiException(HttpStatus.NOT_FOUND,scenario?"SCENARIO_NOT_FOUND":"SIMULATION_NOT_FOUND",scenario?com.pif.api.web.Messages.get("actuarial.scenario_not_found"):com.pif.api.web.Messages.get("actuarial.simulation_not_found"));}
  private Map<String,Object> json(ResultSet rs,String column)throws SQLException{return Js.readObject(rs.getString(column));}
  private Map<String,Object> view(ResultSet rs,String table,boolean detail)throws SQLException{var results=json(rs,"results");var inputs=json(rs,"inputs");Map<String,Object> v;
    if(table.equals("actuarial_scenarios")){String version=rs.getString("model_version");v=obj("id",rs.getObject("id").toString(),"name",rs.getString("name"),"kind",rs.getString("kind"),"modelVersion",version,"currency",rs.getString("currency"),"stale",!Presets.MODEL_VERSION.equals(version),"headline",ActuarialView.pricingHeadline(results),"createdAt",Db.iso(Db.instant(rs,"created_at")),"updatedAt",Db.iso(Db.instant(rs,"updated_at")));}
    else{String version=rs.getString("engine_version");v=obj("id",rs.getObject("id").toString(),"label",rs.getString("label"),"engineVersion",version,"currency",rs.getString("currency"),"stale",!Simulation.ENGINE_VERSION.equals(version),"seed",rs.getInt("seed"),"simulations",rs.getInt("simulations"),"durationMs",rs.getInt("duration_ms"),"portfolio",obj("frequency",ActuarialView.at(inputs,"assumptions","frequency","family"),"severity",ActuarialView.at(inputs,"assumptions","severity","family"),"policies",ActuarialView.at(inputs,"assumptions","frequency","policies")),"headline",ActuarialView.simulationHeadline(results),"createdAt",Db.iso(Db.instant(rs,"created_at")));}
    if(detail){v.put("inputs",inputs);v.put("results",results);}return v;
  }
}
