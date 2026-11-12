package com.pif.api.actuarial;

/** SimulationLimitError: answered as 422 SIMULATION_LIMIT. */
final class SimulationLimitException extends RuntimeException {
  SimulationLimitException(String message) {
    super(message, null, false, false);
  }
}
