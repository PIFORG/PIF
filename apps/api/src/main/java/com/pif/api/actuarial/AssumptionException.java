package com.pif.api.actuarial;

/** FrequencyAssumptionError, SeverityAssumptionError and PricingAssumptionError: answered as 422 INVALID_ASSUMPTIONS. */
final class AssumptionException extends RuntimeException {
  AssumptionException(String message) {
    super(message, null, false, false);
  }
}
