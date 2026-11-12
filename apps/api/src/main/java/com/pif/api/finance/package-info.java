/**
 * PIF financial core: framework-free, deterministic building blocks shared by every service that
 * moves simulated money; a port of apps/api/src/finance. Amounts are integer thousandths carried in
 * {@code double}, computed with the same operations in the same order as the TypeScript
 * {@code number} code so both implementations produce bit-identical results (verified by
 * FinanceGoldenMasterTest against contract/generate-finance-fixtures.mjs). No Spring, persistence or
 * HTTP dependency.
 */
package com.pif.api.finance;
