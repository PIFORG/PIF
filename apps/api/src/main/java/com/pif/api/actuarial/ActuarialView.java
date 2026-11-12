package com.pif.api.actuarial;

import static com.pif.api.actuarial.Js.obj;
import com.pif.api.finance.Money;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;

/** Public API projections, preserving the original currency and probability conventions. */
final class ActuarialView {
  static final double[] QUANTILES = {.5, .75, .9, .95, .99, .995};
  static final double[] RISKS = {.9, .95, .99, .995};
  static double money(double x) { return Money.fromAmount(Money.toAmount(x)); }
  static Double money(Double x) { return x == null ? null : money(x.doubleValue()); }
  static double round(double x, int digits) { return new BigDecimal(x).setScale(digits, RoundingMode.HALF_UP).doubleValue(); }
  static Map<String,Object> provenance() { return obj("kind", "ESTIMATED", "basis", "Estimation modèle à partir d'hypothèses fictives saisies ; aucune donnée de sinistres observée.", "modelVersion", Presets.MODEL_VERSION, "currency", Presets.CURRENCY); }
  static Map<String,Object> frequency(Frequency.Model m) {
    var t = Frequency.countTable(m); double[] p = t.probabilities(); double max = Arrays.stream(p).max().orElse(0);
    int first=0,last=p.length-1; while(first<last && p[first]<max*1e-6) first++; while(last>first && p[last]<max*1e-6) last--;
    int width=Math.max(1,(int)Math.ceil((last-first+1)/60.0)); List<Double> bins=new ArrayList<>();
    for(int i=first;i<=last;i+=width) { double mass=0;for(int j=i;j<Math.min(i+width,last+1);j++)mass+=p[j];bins.add(round(mass,10)); }
    List<Object> qs=new ArrayList<>();for(double level:QUANTILES)qs.add(obj("level",level,"value",Frequency.countQuantile(t,level)));
    return obj("family",m.family,"policies",m.policies,"years",m.years,"exposure",round(m.exposure,4),
      "parameters",m.binomial()?obj("n",round(m.first,10),"periodProbability",round(m.second,10)):obj("lambda",round(m.first,10),"intensity",round(m.second,10)),
      "mean",round(m.mean,6),"variance",round(m.variance,6),"sd",round(Math.sqrt(m.variance),6),"dispersionIndex",m.mean>0?round(m.variance/m.mean,6):null,
      "probabilityNoClaim",StrictMath.exp(m.logPmf(0)),"probabilityPolicyClaims",round(m.binomial()?m.periodProbability():-StrictMath.expm1(-m.intensity()*m.years),10),
      "quantiles",qs,"probabilityAboveMean",Frequency.countExceedance(t,Math.floor(m.mean)),"distribution",obj("from",t.from()+first,"binWidth",width,"probabilities",bins));
  }
  static Map<String,Object> severity(Severity.Model m,List<Double> thresholds) {
    List<Object> curve=m.density()==null?null:new ArrayList<>(); double upper=m.quantile().applyAsDouble(.995);
    if(curve!=null)for(int i=0;i<101;i++){double x=upper*(i+.5)/101;curve.add(obj("x",money(x),"density",m.density().applyAsDouble(x)));}
    Map<String,Object> params=new LinkedHashMap<>();m.parameters().forEach((k,v)->params.put(k,round(v,10)));
    List<Object> qs=new ArrayList<>();for(double level:QUANTILES)qs.add(obj("level",level,"value",money(m.quantile().applyAsDouble(level))));
    return obj("family",m.family(),"mean",money(m.mean()),"variance",round(m.variance(),3),"sd",money(Math.sqrt(m.variance())),"cv",round(Math.sqrt(m.variance())/m.mean(),6),"parameters",params,"quantiles",qs,
      "tailRatio",round(upper/m.mean(),4),"exceedance",thresholds.stream().map(t->obj("threshold",money(t),"probability",1-m.cdf().applyAsDouble(t))).toList(),"curve",curve);
  }
  static Map<String,Object> aggregate(Frequency.Model f,Severity.Model s,List<Double> thresholds,Aggregate.Distribution dist) {
    var m=Aggregate.moments(f,s);var d=dist==null?Aggregate.distribution(f,s):dist;var l=d.lattice();
    List<Object> risk=new ArrayList<>();for(double level:RISKS)risk.add(obj("level",level,"valueAtRisk",d.available()?money(Aggregate.quantile(l,level)):null,"tailValueAtRisk",d.available()?money(Aggregate.tvar(l,level)):null,"normalApproximation",money(m.mean()+m.sd()*Special.normalQuantile(level))));
    Object histogram=null;if(d.available()){var h=Aggregate.histogram(l,60);histogram=obj("from",money(h.from()),"binWidth",money(h.binWidth()),"probabilities",Arrays.stream(h.probabilities()).map(v->round(v,10)).boxed().toList());}
    return obj("mean",money(m.mean()),"variance",round(m.variance(),3),"sd",money(m.sd()),"cv",m.mean()>0?round(m.sd()/m.mean(),6):null,
      "distribution",d.available()?obj("available",true,"method",l.method(),"span",money(l.span()),"capturedMass",l.capturedMass(),"latticeMean",money(Aggregate.mean(l))):obj("available",false,"reason",d.reason()),
      "risk",risk,"exceedance",thresholds.stream().map(t->obj("threshold",money(t),"probability",d.available()?Aggregate.exceedance(l,t):null)).toList(),"histogram",histogram);
  }
  static Map<String,Object> pricing(Pricing.Assumptions a) {
    var m=Pricing.build(a,true);var p=m.premium();double n=m.frequency().policies;List<String>warnings=new ArrayList<>();
    if(p.ratios().combined()>=1)warnings.add("Le ratio combiné attendu atteint 100 % ou plus : sinistres et frais absorbent toute la prime.");
    if(m.probabilityOfUnderwritingLoss()!=null&&m.probabilityOfUnderwritingLoss()>.5)warnings.add("Sous ces hypothèses, une perte de souscription est plus probable qu'improbable.");
    if("NONE".equals(a.riskLoadingMethod())&&a.profitMarginRate()==0)warnings.add("Sans chargement de risque ni marge, la prime ne couvre que les coûts attendus ; des pertes surviennent environ une fois sur deux.");
    if(!m.distribution().available())warnings.add("La distribution complète des pertes est indisponible pour cette taille de portefeuille ; probabilités et quantiles non affichés.");
    var totals=obj("purePremium",money(p.expectedClaims()),"riskLoading",money(p.riskLoading()),"fixedExpenses",money(p.fixedExpenses()),"technicalPremium",money(p.technicalPremium()),"variableExpenses",money(p.variableExpenses()),"profitMargin",money(p.profitMargin()),"grossPremium",money(p.grossPremium()),"expectedUnderwritingResult",money(p.expectedUnderwritingResult()),"claimsBudget",money(p.claimsBudget()));
    var per=obj("purePremium",money(p.expectedClaims()/n),"riskLoading",money(p.riskLoading()/n),"fixedExpenses",money(p.fixedExpenses()/n),"technicalPremium",money(p.technicalPremium()/n),"variableExpenses",money(p.variableExpenses()/n),"profitMargin",money(p.profitMargin()/n),"grossPremium",money(p.grossPremium()/n));
    return obj("provenance",provenance(),"assumptions",a.toJson(),"trendFactor",round(m.trend(),8),"frequency",frequency(m.frequency()),"severity",severity(m.severity(),List.of()),"aggregate",aggregate(m.frequency(),m.severity(),List.of(p.claimsBudget(),p.grossPremium()),m.distribution()),
      "premium",obj("totals",totals,"perPolicy",per,"purePremiumPerExposure",money(p.expectedClaims()/m.frequency().exposure),"ratios",obj("loss",round(p.ratios().loss(),6),"expense",round(p.ratios().expense(),6),"combined",round(p.ratios().combined(),6)),"underwritingMargin",p.grossPremium()>0?round(p.expectedUnderwritingResult()/p.grossPremium(),6):null),
      "probabilities",obj("underwritingLoss",m.probabilityOfUnderwritingLoss(),"claimsExceedPremium",m.probabilityClaimsExceedPremium()),
      "sensitivities",Pricing.sensitivities(a,p).stream().map(v->obj("driver",v.driver(),"label",v.label(),"repricedGrossPremium",money(v.repricedGrossPremium()),"repricedPerPolicy",money(v.repricedGrossPremium()/n),"premiumChange",round(v.premiumChange(),6),"resultAtBasePremium",money(v.resultAtBasePremium()))).toList(),"warnings",warnings);
  }
  static Object at(Map<String,Object> view,String...path) { Object value=view;for(String key:path)value=((Map<?,?>)value).get(key);return value; }
  static Map<String,Object> pricingHeadline(Map<String,Object> v) { return obj("grossPremium",at(v,"premium","totals","grossPremium"),"grossPremiumPerPolicy",at(v,"premium","perPolicy","grossPremium"),"expectedClaims",at(v,"premium","totals","purePremium"),"combinedRatio",at(v,"premium","ratios","combined"),"probabilityOfUnderwritingLoss",at(v,"probabilities","underwritingLoss")); }
  static Map<String,Object> interval(Simulation.Interval i) { return i==null?null:obj("lower",money(i.lower()),"upper",money(i.upper())); }
  static Map<String,Object> probability(Simulation.Probability p,Double exact) { return obj("simulated",p.estimate(),"interval",obj("lower",p.interval().lower(),"upper",p.interval().upper()),"exact",exact,"withinInterval",exact==null?null:exact>=p.interval().lower()&&exact<=p.interval().upper(),"count",p.count()); }
  static Map<String,Object> simulation(Simulation.Output o) {
    var t=o.thresholds();var s=o.statistics();var a=o.analytic();
    var risk=o.risk().stream().map(r->{var e=a.risk().stream().filter(v->v.level()==r.level()).findFirst().orElseThrow();return obj("level",r.level(),"valueAtRisk",money(r.valueAtRisk()),"valueAtRiskInterval",interval(r.valueAtRiskInterval()),"tailValueAtRisk",money(r.tailValueAtRisk()),"tailValueAtRiskInterval",interval(r.tailValueAtRiskInterval()),"exactValueAtRisk",money(e.valueAtRisk()),"exactTailValueAtRisk",money(e.tailValueAtRisk()),"exactWithinInterval",e.valueAtRisk()==null?null:e.valueAtRisk()>=r.valueAtRiskInterval().lower()&&e.valueAtRisk()<=r.valueAtRiskInterval().upper());}).toList();
    return obj("provenance",obj("kind","SIMULATED","basis","Simulation Monte-Carlo à partir d'hypothèses fictives saisies, graine "+(long)o.seed()+" ; relancer avec la même graine reproduit ces chiffres.","modelVersion",Simulation.ENGINE_VERSION,"currency",Presets.CURRENCY),"engineVersion",o.engineVersion(),"rng",o.rng(),"seed",o.seed(),"simulations",o.simulations(),
      "thresholds",obj("premiumCharged",money(t.premiumCharged()),"premiumSource",t.premiumSource(),"modelGrossPremium",money(t.modelGrossPremium()),"fixedExpenses",money(t.fixedExpenses()),"variableExpenses",money(t.variableExpenses()),"claimsBudget",money(t.claimsBudget()),"initialCapital",money(t.initialCapital()),"capitalThreshold",money(t.capitalThreshold())),
      "claimCount",obj("mean",round(o.claimCount().mean(),4),"analyticMean",round(o.claimCount().analyticMean(),4),"max",o.claimCount().max()),
      "statistics",obj("mean",money(s.mean()),"meanInterval",interval(s.meanInterval()),"sd",money(s.sd()),"median",money(s.median()),"min",money(s.min()),"max",money(s.max()),"skewness",s.skewness()==null?null:round(s.skewness(),4)),"risk",risk,
      "probabilities",obj("claimsExceedBudget",probability(o.claimsExceedBudget(),a.claimsExceedBudget()),"claimsExceedPremium",probability(o.claimsExceedPremium(),a.claimsExceedPremium()),"capitalInsufficient",probability(o.capitalInsufficient(),a.capitalInsufficient())),"expectedShortfall",money(o.expectedShortfall()),
      "analytic",obj("mean",money(a.mean()),"sd",money(a.sd()),"distribution",a.distributionMethod()==null?obj("available",false,"reason",a.distributionReason()):obj("available",true,"method",a.distributionMethod()),"meanWithinInterval",a.mean()>=s.meanInterval().lower()&&a.mean()<=s.meanInterval().upper()),
      "histogram",obj("from",money(o.histogram().from()),"binWidth",money(o.histogram().binWidth()),"counts",o.histogram().counts(),"above",o.histogram().above()),
      "exceedanceCurve",o.exceedanceCurve().stream().map(v->obj("threshold",money(v.threshold()),"simulated",v.simulated(),"exact",v.exact())).toList(),
      "convergence",o.convergence().stream().map(v->obj("simulations",v.simulations(),"mean",money(v.mean()),"lower",money(v.lower()),"upper",money(v.upper()),"probabilityClaimsExceedBudget",v.probabilityClaimsExceedBudget())).toList());
  }
  static Map<String,Object> simulationHeadline(Map<String,Object> v) {
    var risk=(List<?>)v.get("risk");Map<?,?>tail=risk.stream().map(x->(Map<?,?>)x).filter(x->((Number)x.get("level")).doubleValue()==.995).findFirst().orElse(Map.of());
    return obj("mean",at(v,"statistics","mean"),"valueAtRisk995",tail.get("valueAtRisk"),"tailValueAtRisk995",tail.get("tailValueAtRisk"),"probabilityClaimsExceedBudget",at(v,"probabilities","claimsExceedBudget","simulated"),"probabilityCapitalInsufficient",at(v,"probabilities","capitalInsufficient","simulated"),"premiumCharged",at(v,"thresholds","premiumCharged"),"initialCapital",at(v,"thresholds","initialCapital"));
  }
}
