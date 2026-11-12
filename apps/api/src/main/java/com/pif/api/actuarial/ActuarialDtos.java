package com.pif.api.actuarial;

import com.pif.api.web.ApiException;
import com.pif.api.web.JsNumbers;
import com.pif.api.web.Validation;
import java.math.BigDecimal;
import java.util.*;

/** Bounded, whitelisted inputs for the actuarial models; never persist request extras. */
public final class ActuarialDtos {
  static Map<String,Object> object(Object raw,String path) {
    if(!(raw instanceof Map<?,?> m))throw ApiException.validation(List.of(path+" doit etre un objet"));
    Map<String,Object> result=new LinkedHashMap<>();m.forEach((k,v)->result.put(k.toString(),v));return result;
  }
  static void keys(Map<String,Object> m,String...allowed) { var set=Set.of(allowed);List<String>errors=new ArrayList<>();for(String k:m.keySet())if(!set.contains(k))errors.add("la propriete "+k+" ne doit pas exister");if(!errors.isEmpty())throw ApiException.validation(errors); }
  static double number(Map<String,Object> m,String key,double min,double max,int decimals) {
    return number(m,key,min,max,decimals,"");
  }
  static double number(Map<String,Object> m,String key,double min,double max,int decimals,String prefix) {
    List<String>errors=new ArrayList<>();double n=check(m.get(key),key,prefix,min,max,decimals,true,errors);
    if(!errors.isEmpty())throw ApiException.validation(errors);return n;
  }
  /** One numeric property: errors in class-validator order (Max, Min, then IsInt/IsNumber), each prefixed by its parent path. {@code convert}: implicit conversion of a {@code number}-typed property; otherwise only a JSON number is accepted. */
  static double check(Object raw,String key,String prefix,double min,double max,int decimals,boolean convert,List<String> errors) {
    double n=Double.NaN;
    if(raw instanceof Number v)n=v.doubleValue();else if(convert&&raw instanceof String s){try{n=s.isBlank()?0:Double.parseDouble(s);}catch(NumberFormatException ignored){/* validation below */}}else if(convert&&raw instanceof Boolean b)n=b?1:0;
    if(!(n<=max))errors.add(prefix+key+" ne doit pas etre superieur a "+fmt(max));if(!(n>=min))errors.add(prefix+key+" ne doit pas etre inferieur a "+fmt(min));
    if(!Double.isFinite(n)||BigDecimal.valueOf(n).stripTrailingZeros().scale()>decimals)errors.add(prefix+key+(decimals==0?" doit etre un nombre entier":" doit etre un nombre conforme aux contraintes specifiees"));
    return n;
  }
  static String fmt(double x){return BigDecimal.valueOf(x).stripTrailingZeros().toPlainString();}
  static String choice(Map<String,Object> m,String key,List<String> values){return choice(m,key,values,"");}
  /** NestJS class-validator prefixes nested paths ({@code frequency.family}, {@code severity.family}, …). */
  static String choice(Map<String,Object> m,String key,List<String> values,String prefix){Object v=m.get(key);if(!values.contains(v))throw ApiException.validation(List.of(prefix+Validation.oneOf(key,values)));return(String)v;}
  static String label(Map<String,Object> m,String key,boolean optional){Object v=m.get(key);if(v==null&&optional)return null;String s=v instanceof Number||v instanceof Boolean?v.toString():v instanceof String str?Validation.jsTrim(str):null;
    List<String>errors=new ArrayList<>();if(s==null||!s.matches("^[\\p{L}\\p{N} .,'&()%+/-]+$"))errors.add(key+" peut contenir des lettres, des chiffres, des espaces et . , ' & ( ) % + / -");if(s==null||s.codePointCount(0,s.length())>80)errors.add(Validation.shorterThan(key,80));if(s==null||s.isEmpty())errors.add(Validation.longerThan(key,1));if(s==null)errors.add(Validation.mustBeString(key));if(!errors.isEmpty())throw ApiException.validation(errors);return s;}
  /**
   * POST /actuarial/frequency/analyze. A missing {@code frequency} is the documented 400 (NestJS 500s while reading it).
   * JSON null is the ValidateNested message. An array passes validation and fails in the model, as an empty array does.
   */
  static Frequency.Assumptions frequencyRequest(Map<String,Object> body) {
    List<String> errors=new ArrayList<>();whitelist(body.keySet(),"",errors,"frequency");
    Frequency.Assumptions a=null;
    if(!body.containsKey("frequency"))errors.add("frequency doit etre un objet");
    else a=frequencyValue(body.get("frequency"),"",errors);
    if(!errors.isEmpty())throw ApiException.validation(errors);return a;
  }
  record SeverityRequest(Severity.Assumptions assumptions,List<Double> thresholds){}
  static SeverityRequest severityRequest(Map<String,Object> body) {
    List<String> errors=new ArrayList<>();whitelist(body.keySet(),"",errors,"severity","thresholds");
    Severity.Assumptions a=null;
    if(!body.containsKey("severity"))errors.add("severity doit etre un objet");
    else a=severityValue(body.get("severity"),"",errors);
    var t=thresholdValues(body,errors);
    if(!errors.isEmpty())throw ApiException.validation(errors);return new SeverityRequest(a,t);
  }
  record AggregateRequest(Frequency.Assumptions frequency,Severity.Assumptions severity,List<Double> thresholds){}
  static AggregateRequest aggregateRequest(Map<String,Object> body) {
    List<String> errors=new ArrayList<>();whitelist(body.keySet(),"",errors,"frequency","severity","thresholds");
    Frequency.Assumptions f=null;Severity.Assumptions s=null;
    if(!body.containsKey("frequency"))errors.add("frequency doit etre un objet");else f=frequencyValue(body.get("frequency"),"",errors);
    if(!body.containsKey("severity"))errors.add("severity doit etre un objet");else s=severityValue(body.get("severity"),"",errors);
    var t=thresholdValues(body,errors);
    if(!errors.isEmpty())throw ApiException.validation(errors);return new AggregateRequest(f,s,t);
  }
  /** Pricing body, or the nested assumptions of a scenario. Null is not an object; a present object collects every failure. */
  static Pricing.Assumptions pricing(Object raw) {
    if(!(raw instanceof Map<?,?> m))throw ApiException.validation(List.of("assumptions doit etre un objet"));
    List<String> errors=new ArrayList<>();var a=pricingValue(m,errors);
    if(!errors.isEmpty())throw ApiException.validation(errors);
    if(a==null)throw new Js.TypeError("Cannot read properties of undefined (reading 'family')");
    return a;
  }
  /** IsDefined, then Max, Min and IsNumber. ValidateIf has already selected this property. */
  private static double required(Map<String,Object> m,String key,String prefix,String defined,double min,double max,int decimals,List<String> errors) {
    if(!m.containsKey(key)||m.get(key)==null)errors.add(prefix+defined);
    return check(m.get(key),key,prefix,min,max,decimals,true,errors);
  }
  private static Map<String,Object> copy(Map<?,?> m){Map<String,Object> result=new LinkedHashMap<>();m.forEach((k,v)->result.put(k.toString(),v));return result;}
  /** {@code parent} is "" at the root and is reserved for a future nested caller. Field messages use {@code frequency.}. */
  private static Frequency.Assumptions frequencyValue(Object raw,String parent,List<String> errors) {
    if(raw instanceof List<?>)return new Frequency.Assumptions(null,null,null,null,null);
    if(!(raw instanceof Map<?,?> src)){errors.add(parent+"la propriete imbrique frequency doit etre un objet ou un tableau");return null;}
    var m=copy(src);String prefix=parent+"frequency.";int mark=errors.size();
    whitelist(m.keySet(),prefix,errors,"family","policies","years","probability","intensity");
    String family=Frequency.FAMILIES.contains(m.get("family"))?(String)m.get("family"):null;
    if(family==null)errors.add(prefix+Validation.oneOf("family",Frequency.FAMILIES));
    double policies=check(m.get("policies"),"policies",prefix,1,1_000_000,0,true,errors);
    double years=check(m.get("years"),"years",prefix,.25,5,2,true,errors);
    Double probability=null,intensity=null;
    if("BINOMIAL".equals(family))probability=required(m,"probability",prefix,"probability is required for the binomial model",.0001,.5,6,errors);
    if("POISSON".equals(family))intensity=required(m,"intensity",prefix,"intensity is required for the Poisson model",.0001,2,6,errors);
    if(errors.size()!=mark)return null;return new Frequency.Assumptions(family,policies,years,probability,intensity);
  }
  /** cv is required whenever the family is not DETERMINISTIC, including a family that itself fails IsIn. */
  private static Severity.Assumptions severityValue(Object raw,String parent,List<String> errors) {
    if(!(raw instanceof Map<?,?> src)){errors.add(parent+"la propriete imbrique severity doit etre un objet ou un tableau");return null;}
    var m=copy(src);String prefix=parent+"severity.";int mark=errors.size();
    whitelist(m.keySet(),prefix,errors,"family","mean","cv");
    String family=Severity.FAMILIES.contains(m.get("family"))?(String)m.get("family"):null;
    if(family==null)errors.add(prefix+Validation.oneOf("family",Severity.FAMILIES));
    double mean=check(m.get("mean"),"mean",prefix,1,10_000_000,3,true,errors);
    Double cv=null;
    if(!"DETERMINISTIC".equals(family))cv=required(m,"cv",prefix,"cv is required for the gamma and lognormal models",.05,5,4,errors);
    if(errors.size()!=mark)return null;return new Severity.Assumptions(family,mean,cv);
  }
  private record Inflation(double annual,double years){}
  private record Expenses(double fixed,double perPolicy,double variable){}
  private record Risk(String method,double parameter){}
  private static Inflation inflationValue(Object raw,List<String> errors) {
    if(!(raw instanceof Map<?,?> src)){errors.add("la propriete imbrique inflation doit etre un objet ou un tableau");return null;}
    var m=copy(src);int mark=errors.size();whitelist(m.keySet(),"inflation.",errors,"annualRate","years");
    double annual=check(m.get("annualRate"),"annualRate","inflation.",-.05,.3,4,true,errors);
    double years=check(m.get("years"),"years","inflation.",0,10,2,true,errors);
    if(errors.size()!=mark)return null;return new Inflation(annual,years);
  }
  private static Expenses expensesValue(Object raw,List<String> errors) {
    if(!(raw instanceof Map<?,?> src)){errors.add("la propriete imbrique expenses doit etre un objet ou un tableau");return null;}
    var m=copy(src);int mark=errors.size();whitelist(m.keySet(),"expenses.",errors,"fixed","perPolicy","variableRate");
    double fixed=check(m.get("fixed"),"fixed","expenses.",0,100_000_000,3,true,errors);
    double perPolicy=check(m.get("perPolicy"),"perPolicy","expenses.",0,100_000,3,true,errors);
    double variable=check(m.get("variableRate"),"variableRate","expenses.",0,.5,4,true,errors);
    if(errors.size()!=mark)return null;return new Expenses(fixed,perPolicy,variable);
  }
  private static Risk riskValue(Object raw,List<String> errors) {
    if(!(raw instanceof Map<?,?> src)){errors.add("la propriete imbrique riskLoading doit etre un objet ou un tableau");return null;}
    var m=copy(src);int mark=errors.size();whitelist(m.keySet(),"riskLoading.",errors,"method","parameter");
    String method=Pricing.RISK_LOADING_METHODS.contains(m.get("method"))?(String)m.get("method"):null;
    if(method==null)errors.add("riskLoading."+Validation.oneOf("method",Pricing.RISK_LOADING_METHODS));
    double parameter=check(m.get("parameter"),"parameter","riskLoading.",0,5,4,true,errors);
    if(errors.size()!=mark)return null;return new Risk(method,parameter);
  }
  /** Missing nested objects are skipped. A fully valid body with one of them absent returns null so the caller can 500. */
  private static Pricing.Assumptions pricingValue(Map<?,?> src,List<String> errors) {
    var m=copy(src);int mark=errors.size();
    whitelist(m.keySet(),"",errors,"frequency","severity","inflation","expenses","profitMarginRate","riskLoading");
    Frequency.Assumptions f=m.containsKey("frequency")?frequencyValue(m.get("frequency"),"",errors):null;
    Severity.Assumptions s=m.containsKey("severity")?severityValue(m.get("severity"),"",errors):null;
    Inflation i=m.containsKey("inflation")?inflationValue(m.get("inflation"),errors):null;
    Expenses e=m.containsKey("expenses")?expensesValue(m.get("expenses"),errors):null;
    double profit=check(m.get("profitMarginRate"),"profitMarginRate","",0,.3,4,true,errors);
    Risk r=m.containsKey("riskLoading")?riskValue(m.get("riskLoading"),errors):null;
    if(errors.size()!=mark||f==null||s==null||i==null||e==null||r==null)return null;
    return new Pricing.Assumptions(f,s,i.annual,i.years,e.fixed,e.perPolicy,e.variable,profit,r.method,r.method.equals("NONE")?0:r.parameter);
  }
  /**
   * Optional thresholds: at most 5, each a finite number &gt;= 0, with no decimal cap.
   * Decorator order is Min each, IsNumber each, then ArrayMaxSize.
   */
  private static List<Double> thresholdValues(Map<String,Object> m,List<String> errors) {
    if(!m.containsKey("thresholds")||m.get("thresholds")==null)return List.of();
    Object raw=m.get("thresholds");
    if(!(raw instanceof List<?> list)){errors.add("chaque valeur de thresholds ne doit pas etre inferieur a 0");errors.add("chaque valeur de thresholds doit etre un nombre conforme aux contraintes specifiees");errors.add("thresholds ne doit pas contenir plus de 5 elements");errors.add("thresholds doit etre un tableau");return List.of();}
    boolean minOk=true,numberOk=true;List<Double> values=new ArrayList<>();
    for(Object v:list){boolean number=v instanceof Number n&&Double.isFinite(n.doubleValue());if(!number||((Number)v).doubleValue()<0)minOk=false;if(!number)numberOk=false;else values.add(((Number)v).doubleValue());}
    if(!minOk)errors.add("chaque valeur de thresholds ne doit pas etre inferieur a 0");
    if(!numberOk)errors.add("chaque valeur de thresholds doit etre un nombre conforme aux contraintes specifiees");
    if(list.size()>5)errors.add("thresholds ne doit pas contenir plus de 5 elements");
    if(!minOk||!numberOk||list.size()>5)return List.of();return values;
  }
  record Scenario(String name,Pricing.Assumptions assumptions){}
  static Scenario scenario(Map<String,Object> m){keys(m,"name","assumptions");return new Scenario(label(m,"name",false),pricing(m.get("assumptions")));}
  record Run(String label,Simulation.Input input){}
  /* Reserving: apps/api/src/actuarial/dto/reserving.dto.ts. Every message of the global ValidationPipe is collected (not just the first), in class-validator order and with the dotted path of nested properties. */
  record ReservingInput(String label,Reserving.Data data,Reserving.Assumptions assumptions){}
  private static final java.util.regex.Pattern RESERVING_LABEL=java.util.regex.Pattern.compile("[\\p{L}\\p{N} .,'&()%+/\\u2013-]+");
  /** The body of POST /actuarial/reserving/analyze, or of POST /actuarial/reserving/runs when {@code withLabel}. */
  static ReservingInput reserving(Map<String,Object> body,boolean withLabel){
    List<String>errors=new ArrayList<>();whitelist(body.keySet(),"",errors,withLabel?new String[]{"label","data","assumptions"}:new String[]{"data","assumptions"});
    String label=withLabel?reservingLabel(body.get("label"),errors):null;
    var data=nested(body,"data","",errors);var parsedData=data==null?null:reservingData(data,"data.",errors);
    var assumptions=nested(body,"assumptions","",errors);var parsedAssumptions=assumptions==null?null:reservingAssumptions(assumptions,"assumptions.",errors);
    if(!errors.isEmpty())throw ApiException.validation(errors);
    // A missing nested object passes class-validator (ValidateNested skips undefined), then the service reads it: a TypeError, answered as 500 like Nest.
    if(parsedData==null)throw new Js.TypeError("Cannot read properties of undefined (reading 'firstOrigin')");
    if(parsedAssumptions==null)throw new Js.TypeError("Cannot read properties of undefined (reading 'paid')");
    return new ReservingInput(label,parsedData,parsedAssumptions);
  }
  private static void whitelist(Collection<String> keys,String prefix,List<String> errors,String...allowed){var set=Set.of(allowed);for(String k:keys)if(!set.contains(k))errors.add(prefix+"la propriete "+k+" ne doit pas exister");}
  /** ValidateNested: undefined is skipped (null here), null and primitives fail, arrays are not descended into. */
  private static Map<String,Object> nested(Map<String,Object> parent,String key,String prefix,List<String> errors){
    if(!parent.containsKey(key))return null;Object v=parent.get(key);
    if(v instanceof Map<?,?> m){Map<String,Object> result=new LinkedHashMap<>();m.forEach((k,x)->result.put(k.toString(),x));return result;}
    if(!(v instanceof List<?>))errors.add(prefix+"la propriete imbrique "+key+" doit etre un objet ou un tableau");return null;
  }
  /** IsArray / ArrayMaxSize / ArrayMinSize and an optional {@code each} validator, in decorator order (bottom first). Constraints sharing a type keep the first position and the last message, as class-validator's constraints object does. */
  private static void array(Object raw,String key,String prefix,List<String> errors,String each,Integer min,int max){
    Map<String,String> constraints=new LinkedHashMap<>();
    if(each!=null){boolean numbers=each.equals("number");boolean ok=raw instanceof List<?> list?list.stream().allMatch(x->numbers?x instanceof Number n&&Double.isFinite(n.doubleValue()):x instanceof List<?>):(numbers?raw instanceof Number n2&&Double.isFinite(n2.doubleValue()):raw instanceof List<?>);
      if(!ok)constraints.put(numbers?"isNumber":"isArray","chaque valeur de "+key+(numbers?" doit etre un nombre conforme aux contraintes specifiees":" doit etre un tableau"));}
    if(!(raw instanceof List<?> sized&&sized.size()<=max))constraints.put("arrayMaxSize",key+" ne doit pas contenir plus de "+max+" elements");
    if(min!=null&&!(raw instanceof List<?> atLeast&&atLeast.size()>=min))constraints.put("arrayMinSize",key+" doit contenir au moins "+min+" elements");
    if(!(raw instanceof List<?>))constraints.put("isArray",key+" doit etre un tableau");
    for(String message:constraints.values())errors.add(prefix+message);
  }
  /** Cells as numbers: null stays missing; anything else that is not a JSON number becomes NaN, which the model reports as "is not a number". */
  private static List<Double> cells(Object raw){List<Double> out=new ArrayList<>();if(raw instanceof List<?> list)for(Object x:list)out.add(x==null?null:x instanceof Number n?Double.valueOf(n.doubleValue()):Double.valueOf(Double.NaN));return out;}
  private static List<List<Double>> rows(Object raw){List<List<Double>> out=new ArrayList<>();if(raw instanceof List<?> list)for(Object x:list)out.add(cells(x));return out;}
  private static Reserving.Data reservingData(Map<String,Object> d,String prefix,List<String> errors){
    whitelist(d.keySet(),prefix,errors,"firstOrigin","paid","incurred","premiums");
    double first=check(d.get("firstOrigin"),"firstOrigin",prefix,1950,2100,0,true,errors);
    Object paid=d.get("paid"),incurred=d.get("incurred"),premiums=d.get("premiums");
    array(paid,"paid",prefix,errors,"array",3,25);
    if(incurred!=null)array(incurred,"incurred",prefix,errors,"array",null,25);
    if(premiums!=null)array(premiums,"premiums",prefix,errors,"number",null,25);
    return new Reserving.Data(Double.isFinite(first)?(int)first:0,rows(paid),incurred==null?null:rows(incurred),premiums==null?null:cells(premiums));
  }
  /** Null when the required {@code tail} object is missing (Nest then fails reading it). */
  private static Reserving.Assumptions reservingAssumptions(Map<String,Object> a,String prefix,List<String> errors){
    whitelist(a.keySet(),prefix,errors,"average","latestDiagonals","tail","selectedFactors","expectedLossRatio");
    Object average=a.get("average");
    if(!(average instanceof String name&&Reserving.AVERAGES.contains(name)))errors.add(prefix+Validation.oneOf("average",Reserving.AVERAGES));
    Integer latest=null;
    if("LATEST_DIAGONALS".equals(average)){
      if(a.get("latestDiagonals")==null)errors.add(prefix+"latestDiagonals est requis lorsque average vaut LATEST_DIAGONALS");
      double k=check(a.get("latestDiagonals"),"latestDiagonals",prefix,1,24,0,true,errors);latest=Double.isFinite(k)?(int)k:null;
    }
    var tail=nested(a,"tail",prefix,errors);double paidTail=Double.NaN,incurredTail=Double.NaN;
    if(tail!=null){String p=prefix+"tail.";whitelist(tail.keySet(),p,errors,"paid","incurred");paidTail=check(tail.get("paid"),"paid",p,.5,3,6,true,errors);incurredTail=check(tail.get("incurred"),"incurred",p,.5,3,6,true,errors);}
    List<Double> paidFactors=null,incurredFactors=null;
    if(a.get("selectedFactors")!=null){var selected=nested(a,"selectedFactors",prefix,errors);
      if(selected!=null){String p=prefix+"selectedFactors.";whitelist(selected.keySet(),p,errors,"paid","incurred");
        if(selected.get("paid")!=null){array(selected.get("paid"),"paid",p,errors,null,null,24);paidFactors=cells(selected.get("paid"));}
        if(selected.get("incurred")!=null){array(selected.get("incurred"),"incurred",p,errors,null,null,24);incurredFactors=cells(selected.get("incurred"));}}}
    Double lossRatio=a.get("expectedLossRatio")==null?null:check(a.get("expectedLossRatio"),"expectedLossRatio",prefix,.01,5,6,false,errors);
    if(tail==null)return null;
    return new Reserving.Assumptions(average instanceof String s?s:"VOLUME_WEIGHTED",latest,paidTail,incurredTail,paidFactors,incurredFactors,lossRatio);
  }
  /** IsString, MinLength(1), MaxLength(80), Matches, after the implicit string conversion and the trim. */
  private static String reservingLabel(Object raw,List<String> errors){
    String s=raw instanceof String str?Validation.jsTrim(str):raw instanceof Number n?JsNumbers.toJsString(n.doubleValue()):raw instanceof Boolean b?b.toString():raw instanceof Map<?,?>?"[object Object]":null;
    if(s==null||!RESERVING_LABEL.matcher(s).matches())errors.add("label peut contenir des lettres, des chiffres, des espaces et . , ' & ( ) % + / -");
    if(s==null||s.codePointCount(0,s.length())>80)errors.add(Validation.shorterThan("label",80));if(s==null||s.isEmpty())errors.add(Validation.longerThan("label",1));if(s==null)errors.add(Validation.mustBeString("label"));
    return s;
  }
  /**
   * Empty body reports simulations and initialCapital only: ValidateNested skips a missing assumptions object.
   * When those numbers are valid and assumptions is still missing, Spring stays 400 (the documented Nest 500).
   */
  static Run simulation(Map<String,Object> m) {
    List<String> errors=new ArrayList<>();
    whitelist(m.keySet(),"",errors,"label","assumptions","simulations","seed","initialCapital","premiumCharged");
    Pricing.Assumptions assumptions=null;
    if(m.containsKey("assumptions")){Object raw=m.get("assumptions");if(!(raw instanceof Map<?,?> map))errors.add("la propriete imbrique assumptions doit etre un objet ou un tableau");else assumptions=pricingValue(map,errors);}
    double simulations=check(m.get("simulations"),"simulations","",1000,200000,0,true,errors);
    Double seed=m.containsKey("seed")&&m.get("seed")!=null?check(m.get("seed"),"seed","",1,Integer.MAX_VALUE,0,true,errors):null;
    double capital=check(m.get("initialCapital"),"initialCapital","",0,10_000_000_000d,3,true,errors);
    Double premium=m.containsKey("premiumCharged")&&m.get("premiumCharged")!=null?check(m.get("premiumCharged"),"premiumCharged","",1,100_000_000_000d,3,true,errors):null;
    String lab=m.containsKey("label")&&m.get("label")!=null?collectLabel(m.get("label"),errors):null;
    if(!errors.isEmpty())throw ApiException.validation(errors);
    if(assumptions==null)throw ApiException.validation(List.of("assumptions doit etre un objet"));
    double usedSeed=seed==null?new java.security.SecureRandom().nextInt(Integer.MAX_VALUE-1)+1:seed;
    return new Run(lab,new Simulation.Input(assumptions,simulations,usedSeed,capital,premium));
  }
  /** Same messages as {@link #label}, appended instead of thrown, so they join the other simulation errors. */
  private static String collectLabel(Object v,List<String> errors) {
    String s=v instanceof Number||v instanceof Boolean?v.toString():v instanceof String str?Validation.jsTrim(str):null;int mark=errors.size();
    if(s==null||!s.matches("^[\\p{L}\\p{N} .,'&()%+/-]+$"))errors.add("label peut contenir des lettres, des chiffres, des espaces et . , ' & ( ) % + / -");
    if(s==null||s.codePointCount(0,s.length())>80)errors.add(Validation.shorterThan("label",80));
    if(s==null||s.isEmpty())errors.add(Validation.longerThan("label",1));if(s==null)errors.add(Validation.mustBeString("label"));
    return errors.size()==mark?s:null;
  }

  /** NestJS DTO names; nested objects stay opaque so schemaShape matches legacy-NestJS-DTO-parity $ref collapse. */
  public static Map<String, io.swagger.v3.oas.models.media.Schema<?>> openApiSchemas() {
    Map<String, io.swagger.v3.oas.models.media.Schema<?>> s = new LinkedHashMap<>();
    var nested = new io.swagger.v3.oas.models.media.ObjectSchema();
    s.put("FrequencyAnalysisDto", com.pif.api.web.ApiDocs.object(List.of("frequency"),
        com.pif.api.web.ApiDocs.prop("frequency", nested)));
    var severityThresholds = new io.swagger.v3.oas.models.media.ArraySchema();
    severityThresholds.setDescription("Claim-cost thresholds in TND for P(X > threshold); at most 5.");
    s.put("SeverityAnalysisDto", com.pif.api.web.ApiDocs.object(List.of("severity"),
        com.pif.api.web.ApiDocs.prop("severity", new io.swagger.v3.oas.models.media.ObjectSchema()),
        com.pif.api.web.ApiDocs.prop("thresholds", severityThresholds)));
    var aggregateThresholds = new io.swagger.v3.oas.models.media.ArraySchema();
    aggregateThresholds.setDescription("Aggregate-loss thresholds in TND for P(S > threshold); at most 5.");
    s.put("AggregateAnalysisDto", com.pif.api.web.ApiDocs.object(List.of("frequency", "severity"),
        com.pif.api.web.ApiDocs.prop("frequency", new io.swagger.v3.oas.models.media.ObjectSchema()),
        com.pif.api.web.ApiDocs.prop("severity", new io.swagger.v3.oas.models.media.ObjectSchema()),
        com.pif.api.web.ApiDocs.prop("thresholds", aggregateThresholds)));
    var profit = new io.swagger.v3.oas.models.media.NumberSchema();
    profit.setMinimum(java.math.BigDecimal.ZERO);
    profit.setMaximum(java.math.BigDecimal.valueOf(0.3));
    profit.setDescription("Profit margin as a share of the gross premium, 0 to 0.3.");
    s.put("PricingDto", com.pif.api.web.ApiDocs.object(
        List.of("expenses", "frequency", "inflation", "profitMarginRate", "riskLoading", "severity"),
        com.pif.api.web.ApiDocs.prop("expenses", new io.swagger.v3.oas.models.media.ObjectSchema()),
        com.pif.api.web.ApiDocs.prop("frequency", new io.swagger.v3.oas.models.media.ObjectSchema()),
        com.pif.api.web.ApiDocs.prop("inflation", new io.swagger.v3.oas.models.media.ObjectSchema()),
        com.pif.api.web.ApiDocs.prop("profitMarginRate", profit),
        com.pif.api.web.ApiDocs.prop("riskLoading", new io.swagger.v3.oas.models.media.ObjectSchema()),
        com.pif.api.web.ApiDocs.prop("severity", new io.swagger.v3.oas.models.media.ObjectSchema())));
    var scenarioName = com.pif.api.web.ApiDocs.pattern("^[\\p{L}\\p{N} .,'&()%+/-]+$");
    scenarioName.setMinLength(1);
    scenarioName.setMaxLength(80);
    s.put("SaveScenarioDto", com.pif.api.web.ApiDocs.object(List.of("assumptions", "name"),
        com.pif.api.web.ApiDocs.prop("assumptions", new io.swagger.v3.oas.models.media.ObjectSchema()),
        com.pif.api.web.ApiDocs.prop("name", scenarioName)));
    io.swagger.v3.oas.models.media.Schema<?> assumptions = new io.swagger.v3.oas.models.media.Schema<>();
    assumptions.setDescription("Portfolio assumptions, as for pricing. The cover period is the simulation horizon.");
    var simulations = num(1000, 200_000, "Number of simulated periods, 1,000 to 200,000. Lognormal costs are further limited to 20 million individual claim draws per run.");
    var seed = num(1, 2_147_483_647, "Seed of the random stream, 1 to 2,147,483,647. When omitted, the server picks one and returns it.");
    var initialCapital = num(0, 10_000_000_000L, "Capital held at the start of the period in TND, 0 to 10,000,000,000.");
    var premiumCharged = num(1, 100_000_000_000L, "Gross premium actually charged in TND. When omitted, the model gross premium is used.");
    var simLabel = com.pif.api.web.ApiDocs.pattern("^[\\p{L}\\p{N} .,'&()%+/-]+$");
    simLabel.setMinLength(1);
    simLabel.setMaxLength(80);
    s.put("RunSimulationDto", com.pif.api.web.ApiDocs.object(List.of("assumptions", "initialCapital", "simulations"),
        com.pif.api.web.ApiDocs.prop("assumptions", assumptions),
        com.pif.api.web.ApiDocs.prop("initialCapital", initialCapital),
        com.pif.api.web.ApiDocs.prop("label", simLabel),
        com.pif.api.web.ApiDocs.prop("premiumCharged", premiumCharged),
        com.pif.api.web.ApiDocs.prop("seed", seed),
        com.pif.api.web.ApiDocs.prop("simulations", simulations)));
    s.put("AnalyzeReservingDto", com.pif.api.web.ApiDocs.object(List.of("assumptions", "data"),
        com.pif.api.web.ApiDocs.prop("assumptions", new io.swagger.v3.oas.models.media.ObjectSchema()),
        com.pif.api.web.ApiDocs.prop("data", new io.swagger.v3.oas.models.media.ObjectSchema())));
    var reservingLabel = com.pif.api.web.ApiDocs.pattern("^[\\p{L}\\p{N} .,'&()%+/\u2013-]+$");
    reservingLabel.setMinLength(1);
    reservingLabel.setMaxLength(80);
    s.put("SaveReservingRunDto", com.pif.api.web.ApiDocs.object(List.of("assumptions", "data", "label"),
        com.pif.api.web.ApiDocs.prop("assumptions", new io.swagger.v3.oas.models.media.ObjectSchema()),
        com.pif.api.web.ApiDocs.prop("data", new io.swagger.v3.oas.models.media.ObjectSchema()),
        com.pif.api.web.ApiDocs.prop("label", reservingLabel)));
    return s;
  }

  private static io.swagger.v3.oas.models.media.NumberSchema num(long min, long max, String description) {
    var n = new io.swagger.v3.oas.models.media.NumberSchema();
    n.setMinimum(java.math.BigDecimal.valueOf(min));
    n.setMaximum(java.math.BigDecimal.valueOf(max));
    n.setDescription(description);
    return n;
  }
}
