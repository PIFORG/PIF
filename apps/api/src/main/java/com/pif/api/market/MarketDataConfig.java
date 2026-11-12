package com.pif.api.market;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * apps/api/src/market-data/market-data.module.ts: the system clock and the deterministic simulated provider. No paid
 * or live feed exists; every price is fictional and labelled with {@link SimulatedMarketProvider#SIMULATED_PROVENANCE}.
 */
@Configuration
public class MarketDataConfig {

  @Bean
  public Clock marketClock() {
    return Clock.systemUTC();
  }

  @Bean
  public SimulatedMarketProvider marketDataProvider() {
    return new SimulatedMarketProvider();
  }
}
