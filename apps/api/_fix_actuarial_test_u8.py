from pathlib import Path

src = Path("src/test/java/com/pif/api/actuarial/ActuarialCoreTest.java")
raw = src.read_bytes()
text = raw.decode("utf-16-le") if len(raw) > 3 and raw[1] == 0 else raw.decode("utf-8")

# Replace broken Monte Carlo section with simulateLosses API
needle_start = "  @Test\n  void monteCarloProducesFiniteMean()"
idx = text.find(needle_start)
if idx < 0:
    raise SystemExit("monteCarlo method not found")
end = text.rfind("}")
replacement = """  @Test
  void monteCarloProducesFiniteMean() {
    Frequency.Model freq = Frequency.model(new Frequency.Assumptions("POISSON", 20.0, 1.0, null, 0.1));
    Severity.Model sev = Severity.model(new Severity.Assumptions("LOGNORMAL", 1000.0, 0.6));
    Simulation.Deadline deadline = () -> {};
    Simulation.Losses losses = Simulation.simulateLosses(freq, sev, 2000, 42.0, deadline);
    assertThat(losses.losses().length).isEqualTo(2000);
    assertThat(java.util.Arrays.stream(losses.losses()).average().orElse(0)).isPositive();
  }
}
"""
text = text[:idx] + replacement
src.write_bytes(text.encode("utf-8"))
print("fixed", src.stat().st_size)
