package com.pif.api.learning;

import static com.pif.api.web.ApiDocs.describe;
import static com.pif.api.web.ApiDocs.object;
import static com.pif.api.web.ApiDocs.oneOf;
import static com.pif.api.web.ApiDocs.prop;

import com.pif.api.learning.engine.Command;
import com.pif.api.learning.engine.Definitions;
import com.pif.api.learning.stories.StoryProgress.ProgressUpdate;
import com.pif.api.web.ApiException;
import com.pif.api.web.Validation;
import com.pif.api.web.Validation.Checker;
import io.swagger.v3.oas.models.media.BooleanSchema;
import io.swagger.v3.oas.models.media.NumberSchema;
import io.swagger.v3.oas.models.media.ObjectSchema;
import io.swagger.v3.oas.models.media.Schema;
import java.math.BigDecimal;
import java.util.*;

/** Client DTO validation; engine-only commands such as REQUEST_HINT cannot be submitted directly. */
public final class LearningDtos {
  private LearningDtos() {}
  static final List<String> TYPES=List.of("PLACE_ORDER","CANCEL_ORDER","ADVANCE","FINISH","RUN_STRESS_TEST");
  static final List<String> MODES=List.of("GUIDED","SOCRATIC","CRITICAL");

  /** NestJS DTO names for OpenAPI; PreviewOrderDto is the trading schema Nest also publishes under that name. */
  public static Map<String, Schema<?>> openApiSchemas() {
    Map<String, Schema<?>> s = new LinkedHashMap<>();
    NumberSchema expectedSeq = new NumberSchema();
    expectedSeq.setMinimum(BigDecimal.ZERO);
    expectedSeq.setDescription("The last command sequence number you have seen. Prevents lost updates.");
    s.put("SubmitCommandDto", object(List.of("idempotencyKey", "expectedSeq", "command"),
        prop("idempotencyKey", describe(com.pif.api.web.ApiDocs.pattern("^[A-Za-z0-9_-]{8,80}$"),
            "Client-generated key; resending the same key returns the original result.")),
        prop("expectedSeq", expectedSeq),
        prop("command", new ObjectSchema())));
    NumberSchema fromSeq = new NumberSchema();
    fromSeq.setMinimum(BigDecimal.ONE);
    fromSeq.setDescription("First command to replace; earlier commands are copied into the replay.");
    s.put("BranchDto", object(List.of("fromSeq", "strategy"),
        prop("fromSeq", fromSeq),
        prop("strategy", describe(oneOf(List.of("HOLD", "MANUAL")),
            "MANUAL: you play on from that point. HOLD: no further trades; the market runs to the end."))));
    s.put("StartSessionDto", object(List.of(),
        prop("mentorMode", describe(oneOf(List.of("CRITICAL", "GUIDED", "SOCRATIC")),
            "Defaults to the mission\u2019s recommended mode."))));
    s.put("MentorRequestDto", object(List.of(),
        prop("mode", describe(oneOf(List.of("CRITICAL", "DEBRIEF", "GUIDED", "SOCRATIC")),
            "DEBRIEF is only available after the session ends."))));
    NumberSchema positionMs = new NumberSchema();
    positionMs.setMinimum(BigDecimal.ZERO);
    positionMs.setMaximum(BigDecimal.valueOf(3_600_000));
    positionMs.setDescription("Playback position in milliseconds.");
    BooleanSchema completed = new BooleanSchema();
    completed.setEnum(List.of(Boolean.FALSE, Boolean.TRUE));
    s.put("StoryProgressDto", object(List.of("positionMs"),
        prop("positionMs", positionMs),
        prop("completed", completed),
        prop("reflection", describe(oneOf(List.of("UNSURE", "WOULD_CHOOSE_A", "WOULD_CHOOSE_B")),
            "Optional reflection recorded after the story."))));
    return s;
  }
  public record Submit(String key,int seq,Command command) {}
  public record Branch(int from,String strategy) {}
  public static String mode(Map<String,Object> body,boolean mentor) {
    String key=mentor?"mode":"mentorMode"; var c=new Checker(body,Set.of(key));
    String value=c.present(key)?choice(c,key,mentor?List.of("GUIDED","SOCRATIC","CRITICAL","DEBRIEF"):MODES):null;
    c.requireValid();return value;
  }
  public static Branch branch(Map<String,Object> body) {
    var c=new Checker(body,Set.of("fromSeq","strategy"));
    double from=integer(c,"fromSeq",1,null);String strategy=choice(c,"strategy",List.of("MANUAL","HOLD"));
    c.requireValid();return new Branch((int)from,strategy);
  }
  public static Submit submit(Map<String,Object> body) {
    var c=new Checker(body,Set.of("idempotencyKey","expectedSeq","command"));
    String key=pattern(c,"idempotencyKey","^[A-Za-z0-9_-]{8,80}$");
    double seq=integer(c,"expectedSeq",0,null);
    Command command=nested(c,"command");c.requireValid();return new Submit(key,(int)seq,command);
  }
  public static Command preview(Map<String,Object> body) {
    var c=new Checker(body,Set.of("order"));var order=nested(c,"order");c.requireValid();return order;
  }
  private static Command nested(Checker parent,String key) {
    Object raw=parent.raw(key);
    if(!(raw instanceof Map<?,?> m)) { parent.add("la propriete imbrique "+key+" doit etre un objet ou un tableau");return null; }
    Map<String,Object> input=new LinkedHashMap<>();m.forEach((k,v)->input.put(String.valueOf(k),v));
    try { return command(input); }
    catch(ApiException e) {
      if(e.details()==null)throw e;
      for(String message:e.details())parent.add(key+"."+message);
      return null;
    }
  }
  static Command command(Map<String,Object> body) {
    var c=new Checker(body,Set.of("type","symbol","side","orderType","quantity","limitPrice","stopPrice","rationale","confidence","orderId","scenarioId"));
    var type=choice(c,"type",TYPES);
    String symbol=null,side=null,orderType=null,rationale=null,orderId=null,scenarioId=null;
    Double quantity=null,limit=null,stop=null,confidence=null;
    if("PLACE_ORDER".equals(type)) {
      symbol=pattern(c,"symbol","^[A-Z]{2,8}$");side=choice(c,"side",List.of("BUY","SELL"));
      orderType=choice(c,"orderType",List.of("MARKET","LIMIT","STOP"));quantity=integer(c,"quantity",1,1000000.0);
      if("LIMIT".equals(orderType))limit=price(c,"limitPrice");
      if("STOP".equals(orderType))stop=price(c,"stopPrice");
      rationale=choice(c,"rationale",Definitions.RATIONALES);
    }
    if(c.present("confidence"))confidence=integer(c,"confidence",0,100.0);
    if("CANCEL_ORDER".equals(type))orderId=pattern(c,"orderId","^o\\d{1,6}$");
    if("RUN_STRESS_TEST".equals(type)) {
      Object value=c.stringValue("scenarioId");
      if(!Validation.maxLength(value,40))c.add(Validation.shorterThan("scenarioId",40));
      if(!(value instanceof String))c.add(Validation.mustBeString("scenarioId"));
      scenarioId=value instanceof String s?s:null;
    }
    c.requireValid();return new Command(type,symbol,side,orderType,quantity,limit,stop,rationale,body.containsKey("confidence"),confidence,orderId,scenarioId);
  }
  public static ProgressUpdate progress(Map<String,Object> body) {
    var c=new Checker(body,Set.of("positionMs","completed","reflection"));
    double position=integer(c,"positionMs",0,3600000.0);
    // Nest ValidationPipe enableImplicitConversion turns non-boolean completed values into Boolean(value) before @IsIn.
    Boolean completed = null;
    if (c.present("completed")) {
      Object raw = c.raw("completed");
      if (raw instanceof Boolean b) completed = b;
      else if (raw instanceof Number n) completed = n.doubleValue() != 0;
      else if (raw instanceof String s) completed = !s.isEmpty();
      else c.add("completed doit etre l'une des valeurs suivantes : true, false");
    }
    String reflection=c.present("reflection")?choice(c,"reflection",List.of("WOULD_CHOOSE_A","WOULD_CHOOSE_B","UNSURE")):null;
    c.requireValid();return new ProgressUpdate((int)position,completed,body.containsKey("reflection"),reflection);
  }
  private static String choice(Checker c,String key,List<String> values) {
    Object raw=c.raw(key);
    // Union-typed properties carry Object design metadata: class-transformer does not coerce them.
    if(!Validation.isIn(raw,values))c.add(Validation.oneOf(key,values));
    return raw instanceof String s?s:null;
  }
  private static String pattern(Checker c,String key,String regex) {
    Object value=c.stringValue(key);
    if(!(value instanceof String s)||!s.matches(regex))c.add(key+" doit correspondre a /"+regex+"/");
    if(!(value instanceof String))c.add(Validation.mustBeString(key));
    return value instanceof String s?s:null;
  }
  private static double numeric(Checker c,String key) {
    Object value=c.raw(key);if(value==null)return Double.NaN;
    if(value instanceof Number n)return n.doubleValue();
    if(value instanceof Boolean b)return b?1:0;
    if(value instanceof String s) {
      try { return s.isBlank()?0:Double.parseDouble(s); }catch(NumberFormatException e) { return Double.NaN; }
    }
    return Double.NaN;
  }
  private static double integer(Checker c,String key,double min,Double max) {
    double n=numeric(c,key);
    if(max!=null&&!(n<=max))c.add(key+" ne doit pas etre superieur a "+max.longValue());
    if(!(n>=min))c.add(key+" ne doit pas etre inferieur a "+(long)min);
    if(!Double.isFinite(n)||n!=Math.rint(n))c.add(key+" doit etre un nombre entier");
    return n;
  }
  private static double price(Checker c,String key) {
    double n=numeric(c,key);
    if(!(n>=0.001))c.add(key+" ne doit pas etre inferieur a 0.001");
    if(!Double.isFinite(n)||BigDecimal.valueOf(n).stripTrailingZeros().scale()>3)
      c.add(key+" doit etre un nombre conforme aux contraintes specifiees");
    return n;
  }
}
