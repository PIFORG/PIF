package com.pif.api.actuarial;

import static com.pif.api.actuarial.Js.obj;
import com.pif.api.data.Db;
import com.pif.api.web.ApiException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.*;
import java.util.stream.IntStream;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

/** apps/api/src/actuarial/reserving.service.ts: claims-triangle analysis and each user's stored reserving runs. */
@Service
public class ReservingService {
  /** Saved reserving runs kept per user; older runs are removed when a new one is stored. */
  static final int RUNS_KEPT=25;
  private static final String EXAMPLES_RESOURCE="actuarial/reserving-examples.json";
  private final JdbcTemplate jdbc; private final TransactionTemplate tx; private final ObjectMapper mapper;
  private volatile Map<String,Object> exampleCache;
  public ReservingService(JdbcTemplate jdbc,TransactionTemplate tx,ObjectMapper mapper){this.jdbc=jdbc;this.tx=tx;this.mapper=mapper;}

  public Map<String,Object> examples(){var value=exampleCache;if(value==null){value=obj("modelVersion",Reserving.VERSION,"currency",Presets.CURRENCY,"limits",Reserving.LIMITS,"averages",Reserving.AVERAGES,"methods",IntStream.range(0,Reserving.METHODS.size()).mapToObj(i->obj("id",Reserving.METHODS.get(i),"label",Reserving.LABELS.get(i))).toList(),"examples",loadExamples());exampleCache=value;}return value;}
  @SuppressWarnings("unchecked") private List<Object> loadExamples(){try(InputStream in=new ClassPathResource(EXAMPLES_RESOURCE).getInputStream()){return mapper.readValue(in,List.class);}catch(IOException e){throw new IllegalStateException("Cannot read "+EXAMPLES_RESOURCE,e);}}

  public Map<String,Object> analyze(Map<String,Object> body){var input=ActuarialDtos.reserving(body,false);return obj("provenance",provenance(),"results",compute(input.data(),input.assumptions()));}

  public Map<String,Object> save(UUID user,Map<String,Object> body){
    var input=ActuarialDtos.reserving(body,true);var data=input.data();var assumptions=input.assumptions();var results=compute(data,assumptions);
    String inputs=json(obj("data",data.json(),"assumptions",assumptions.json())),stored=json(results),checksum=checksum(data);
    return tx.execute(status->{
      lock(user);UUID id=Db.newId();
      jdbc.update("INSERT INTO actuarial_reserving_runs (id,user_id,label,model_version,currency,first_origin,origin_count,valuation_year,data_checksum,inputs,results,created_at) VALUES (?,?,?,?,?,?,?,?,?,?::jsonb,?::jsonb,?)",id,user,input.label(),Reserving.VERSION,Presets.CURRENCY,data.firstOrigin(),data.paid().size(),results.get("valuationYear"),checksum,inputs,stored,Db.ts(Db.now()));
      jdbc.update("DELETE FROM actuarial_reserving_runs WHERE user_id=? AND id IN (SELECT id FROM actuarial_reserving_runs WHERE user_id=? ORDER BY created_at DESC,id DESC OFFSET ?)",user,user,RUNS_KEPT);
      return run(user,id);
    });
  }
  public Map<String,Object> runs(UUID user){return obj("kept",RUNS_KEPT,"runs",jdbc.query("SELECT * FROM actuarial_reserving_runs WHERE user_id=? ORDER BY created_at DESC,id DESC",(rs,n)->view(rs,false),user));}
  public Map<String,Object> run(UUID user,UUID id){var values=jdbc.query("SELECT * FROM actuarial_reserving_runs WHERE id=? AND user_id=?",(rs,n)->view(rs,true),id,user);if(values.isEmpty())throw notFound();return values.getFirst();}
  public void deleteRun(UUID user,UUID id){if(jdbc.update("DELETE FROM actuarial_reserving_runs WHERE id=? AND user_id=?",id,user)==0)throw notFound();}

  static Map<String,Object> provenance(){return obj("kind","MODEL_ESTIMATE","currency",Presets.CURRENCY,"modelVersion",Reserving.VERSION,"note","Deterministic best estimates from the triangle and assumptions entered. Undiscounted, without a risk margin; not a regulatory technical provision.");}
  static Map<String,Object> compute(Reserving.Data data,Reserving.Assumptions assumptions){
    try{return Reserving.analyze(data,assumptions);}
    catch(Reserving.InputError e){throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,e.code,e.code.equals("FACTOR_UNDEFINED")?com.pif.api.web.Messages.format("actuarial.factor_missing",e.getMessage()):com.pif.api.web.Messages.format("actuarial.invalid_triangle",e.getMessage()));}
  }
  /** SHA-256 of the data in a fixed key order: identical triangles and premiums give the same checksum. */
  static String checksum(Reserving.Data data){
    var parts=new ArrayList<Object>();parts.add((double)data.firstOrigin());parts.add(data.paid());parts.add(data.incurred());parts.add(data.premiums());
    try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Js.stringify(parts).getBytes(StandardCharsets.UTF_8)));}catch(NoSuchAlgorithmException e){throw new IllegalStateException(e);}
  }
  /** Headline per method: total ultimate and unpaid, null when the method was unavailable. */
  static Map<String,Object> headline(Map<String,Object> results){
    var methods=((List<?>)results.get("methods")).stream().map(m->{var method=(Map<?,?>)m;boolean available=Boolean.TRUE.equals(method.get("available"));var totals=available?(Map<?,?>)method.get("totals"):null;return obj("method",method.get("method"),"ultimate",available?totals.get("ultimate"):null,"unpaid",available?totals.get("unpaid"):null);}).toList();
    return obj("paid",ActuarialView.at(results,"reserves","totals","paid"),"incurred",ActuarialView.at(results,"reserves","totals","incurred"),"caseReserve",ActuarialView.at(results,"reserves","totals","caseReserve"),"methods",methods,"warnings",((List<?>)results.get("warnings")).size());
  }
  private String json(Object value){return mapper.writeValueAsString(value);}
  private void lock(UUID user){jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",(rs,n)->0,"actuarial-reserving:"+user);}
  private static ApiException notFound(){return new ApiException(HttpStatus.NOT_FOUND,"RESERVING_RUN_NOT_FOUND",com.pif.api.web.Messages.get("actuarial.reserving_not_found"));}
  private Map<String,Object> read(ResultSet rs,String column)throws SQLException{return Js.readObject(rs.getString(column));}
  private Map<String,Object> view(ResultSet rs,boolean detail)throws SQLException{
    var results=read(rs,"results");String version=rs.getString("model_version");
    var v=obj("id",rs.getObject("id").toString(),"label",rs.getString("label"),"modelVersion",version,"stale",!Reserving.VERSION.equals(version),"currency",rs.getString("currency"),"firstOrigin",rs.getInt("first_origin"),"originCount",rs.getInt("origin_count"),"valuationYear",rs.getInt("valuation_year"),"dataChecksum",rs.getString("data_checksum"),"headline",headline(results),"createdAt",Db.iso(Db.instant(rs,"created_at")));
    if(detail){v.put("inputs",read(rs,"inputs"));v.put("results",results);}
    return v;
  }
}
