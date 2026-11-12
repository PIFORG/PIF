package com.pif.api.market;

import java.time.Instant;

/** A mid price in millimes at an instant. */
public record PricePoint(Instant at, double mid) {}
