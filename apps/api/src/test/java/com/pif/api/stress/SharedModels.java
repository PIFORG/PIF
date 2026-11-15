package com.pif.api.stress;

/** One trained emulator shared by the test classes (training takes a few seconds and is deterministic). */
final class SharedModels {
  static final StressModelService INSTANCE = new StressModelService();

  private SharedModels() {}
}
