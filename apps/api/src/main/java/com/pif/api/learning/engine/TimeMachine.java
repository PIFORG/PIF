package com.pif.api.learning.engine;

import com.pif.api.learning.engine.Simulator.CommandResult;
import com.pif.api.learning.engine.Simulator.Context;
import com.pif.api.learning.engine.Simulator.RecordedCommand;
import java.util.ArrayList;
import java.util.List;

/** Financial Time Machine replays (the engine part of LearningService.branch and createSession). */
public final class TimeMachine {

  private TimeMachine() {}

  /** One command applied while building a session; {@code step} is the simulated step before the command. */
  public record Applied(int seq, Command command, CommandResult result, int step) {}

  public record Played(SimState state, List<Applied> applied) {}

  /** Applies commands in order while the session is active. */
  public static Played play(Context ctx, List<Command> commands) {
    SimState state = Simulator.initialState(ctx);
    List<Applied> applied = new ArrayList<>();
    for (Command command : commands) {
      if (!"ACTIVE".equals(state.status)) break;
      int seq = state.lastCommandSeq + 1;
      int step = state.step;
      CommandResult result = Simulator.applyCommand(ctx, state, command, seq);
      applied.add(new Applied(seq, command, result, step));
      state = result.state();
    }
    return new Played(state, applied);
  }

  /**
   * Commands of a branch from decision {@code fromSeq}: the decisions before it, then for HOLD every remaining
   * period without trading and the finish.
   */
  public static List<Command> branchCommands(Context ctx, List<RecordedCommand> log, int fromSeq, String strategy) {
    List<Command> kept = new ArrayList<>();
    for (RecordedCommand c : log) {
      if (c.seq() < fromSeq) kept.add(c.command());
    }
    List<Command> commands = new ArrayList<>(kept);
    if ("HOLD".equals(strategy)) {
      SimState probe = Simulator.initialState(ctx);
      for (Command c : kept) probe = Simulator.applyCommand(ctx, probe, c, probe.lastCommandSeq + 1).state();
      while ("ACTIVE".equals(probe.status) && !Simulator.isMarketClosed(ctx, probe)) {
        probe = Simulator.applyCommand(ctx, probe, Command.of("ADVANCE"), probe.lastCommandSeq + 1).state();
        commands.add(Command.of("ADVANCE"));
      }
      if ("ACTIVE".equals(probe.status)) commands.add(Command.of("FINISH"));
    }
    return commands;
  }
}
