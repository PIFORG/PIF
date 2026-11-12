package com.pif.api.finance;

/** A statistical sample contains an observation that is not a finite number. */
public final class InvalidSampleException extends IllegalArgumentException {

  public InvalidSampleException(int size) {
    super("The sample of " + size + " observations contains a value that is not a finite number.");
  }
}
