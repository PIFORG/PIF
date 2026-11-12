package com.pif.api.finance;

/** The execution would break a ledger invariant (LedgerError in TypeScript). Callers must check before booking. */
public final class LedgerException extends RuntimeException {

  public enum Code {
    INVALID_EXECUTION,
    INSUFFICIENT_CASH,
    INSUFFICIENT_POSITION
  }

  private final Code code;

  public LedgerException(Code code, String message) {
    super(message);
    this.code = code;
  }

  public Code code() {
    return code;
  }
}
