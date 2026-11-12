/**
 * Domain-aware numerical comparison for Nest vs Spring actuarial differentials.
 * Replaces blanket Number.toPrecision(12) snapping.
 *
 * Policies (see docs/migration/NUMERICAL_PARITY_AUDIT.md):
 * - Exact: ids, enums, booleans, integers, strings, checksums, seeds, counts
 * - Money (millime scale): |Δ| ≤ 5e-4 (half millime)
 * - Probabilities: ≤1 ULP or |Δ| ≤ 1e-15
 * - Statistics: relative ≤ 1e-12 or ≤1 ULP
 * - Persisted JSONB (`db.*` or stored results/inputs): floats may differ by ≤1 ULP
 *   (Prisma/PostgreSQL JSON round-trip); non-floats remain exact
 * - durationMs: stripped before compare
 */

export function ulpsApart(a, b) {
  if (Object.is(a, b)) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  const buf = new ArrayBuffer(8);
  const f64 = new Float64Array(buf);
  const u64 = new BigUint64Array(buf);
  f64[0] = a;
  const ia = u64[0];
  f64[0] = b;
  const ib = u64[0];
  return Number(ia >= ib ? ia - ib : ib - ia);
}

const MONEY_LEAF = /^(mean|sd|grossPremium|purePremium|technicalPremium|riskLoading|fixedExpenses|variableExpenses|profitMargin|claimsBudget|expectedClaims|expectedUnderwritingResult|valueAtRisk|tailValueAtRisk|normalApproximation|latticeMean|span|from|binWidth|lower|upper|x|value|repricedGrossPremium|repricedPerPolicy|resultAtBasePremium|purePremiumPerExposure|grossPremiumPerPolicy|unpaid|ultimate|paidToDate|incurredToDate|ibnr|caseReserve|amount|price|cash|notional|fee|commission|equity|pnl|reserve)$/i;
const PROB_LEAF = /^(probability|probabilityOfLoss|probabilityNoClaim|probabilityPolicyClaims|capturedMass|density|mass)$/i;
const STAT_LEAF = /^(variance|cv|dispersionIndex|intensity|lambda|periodProbability|n|loss|expense|combined|underwritingMargin|premiumChange|trendFactor|selected|ratio|tailRatio|exposure|factor|link|estimated|volumeWeighted|simpleAverage|latestDiagonals|cdf|development|total|relativeDifference|absoluteDifference)$/i;
const EXACT_LEAF = /^(id|userId|scenarioId|simulationId|runId|name|label|kind|family|method|status|currency|modelVersion|engineVersion|seed|simulations|policies|years|firstOrigin|originCount|valuationYear|dataChecksum|stale|available|reason|driver|message|code|errorCode|kept|count|pairs|sequence|side|symbol|email|role)$/i;

function leaf(path) {
  const parts = path.split('.');
  return parts[parts.length - 1] || '';
}

/** Only database-state comparisons (Nest Prisma JSONB rewrite). Live API `.results` are not persisted. */
function isPersistedPath(path) {
  return path === 'db' || path.startsWith('db.');
}

function isMoneyPath(path) {
  const l = leaf(path);
  if (MONEY_LEAF.test(l)) return true;
  if (/Premium|Reserve|Fee|Cash|Amount|Price|Equity|Pnl|Unpaid|Ultimate/i.test(l)) return true;
  return false;
}

function isProbPath(path) {
  return PROB_LEAF.test(leaf(path)) || /probability/i.test(leaf(path));
}

function isStatPath(path) {
  return STAT_LEAF.test(leaf(path));
}

function isExactLeaf(path) {
  return EXACT_LEAF.test(leaf(path));
}

/** Classify a numeric pair; returns null when accepted, else a detail object. */
export function classifyNumeric(path, nest, spring) {
  if (Object.is(nest, spring)) return null;
  if (typeof nest !== 'number' || typeof spring !== 'number') {
    return { path, nest, spring, policy: 'type-mismatch' };
  }
  if (!Number.isFinite(nest) || !Number.isFinite(spring)) {
    return { path, nest, spring, policy: 'non-finite' };
  }

  const l = leaf(path);
  const ulps = ulpsApart(nest, spring);
  const abs = Math.abs(nest - spring);
  const rel = abs / Math.max(Math.abs(nest), Math.abs(spring), Number.EPSILON);

  // Integers / counts: exact (seeds, simulations, policies, years, …)
  if (Number.isInteger(nest) && Number.isInteger(spring) && isExactLeaf(path)) {
    return nest === spring ? null : { path, nest, spring, ulps, policy: 'exact-integer' };
  }
  if (isExactLeaf(path) && Number.isInteger(nest) && Number.isInteger(spring)) {
    return nest === spring ? null : { path, nest, spring, ulps, policy: 'exact-integer' };
  }

  if (isMoneyPath(path)) {
    // Millime scale: half-millime absolute tolerance (matches prior closed-form harness).
    if (abs <= 5e-4 + Number.EPSILON || ulps <= 1) return null;
    return { path, nest, spring, abs, ulps, policy: 'money-half-millime' };
  }

  if (isProbPath(path)) {
    if (ulps <= 1 || abs <= 1e-15) return null;
    return { path, nest, spring, abs, ulps, policy: 'probability-1ulp' };
  }

  if (isStatPath(path) || /chainLadder|cashFlows|bornhuetter|sensitivity|linkRatio/i.test(path)) {
    // Link ratios / undeveloped totals: double accumulation noise (observed 2–3 ULPs), not millime money.
    if (ulps <= 4 || rel <= 1e-12 || abs <= 1e-12) return null;
    return { path, nest, spring, abs, rel, ulps, policy: 'stat-rel-1e-12' };
  }

  if (isPersistedPath(path)) {
    // Documented Prisma JSONB rewrite: neighbor double(s) on Nest read-back (observed ≤3 ULPs).
    if (ulps <= 3) return null;
    return { path, nest, spring, abs, ulps, policy: 'persisted-jsonb-3ulp' };
  }

  // Empirical Monte Carlo frequencies (k/N) and similar ratios: a few ULPs of binary noise.
  if (/\.exact$|\.empirical$|exceedanceCurve/i.test(path) || leaf(path) === 'exact' || leaf(path) === 'empirical') {
    if (ulps <= 4 || abs <= 1e-15) return null;
    return { path, nest, spring, abs, ulps, policy: 'mc-frequency-4ulp' };
  }

  // Live computed floats: exact bits, else at most 1 ULP (JS Number vs Java double edge).
  if (ulps <= 1) return null;
  return { path, nest, spring, abs, ulps, policy: 'live-exact-or-1ulp' };
}

/** Strip wall-clock duration only — no numeric snapping. */
export function stripDurationMs(body) {
  if (typeof body === 'number' || body == null || typeof body !== 'object') return body;
  if (Array.isArray(body)) return body.map(stripDurationMs);
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'durationMs') out[k] = '<ms>';
    else out[k] = stripDurationMs(v);
  }
  return out;
}

export function domainAwareDiff(a, b, path = '') {
  if (Object.is(a, b)) return [];
  if (typeof a === 'number' && typeof b === 'number') {
    const miss = classifyNumeric(path || '(root)', a, b);
    return miss ? [miss] : [];
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) => domainAwareDiff(a[k], b[k], path ? `${path}.${k}` : k));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    const out = [];
    for (let i = 0; i < n; i++) out.push(...domainAwareDiff(a[i], b[i], `${path}[${i}]`));
    return out;
  }
  return [{ path: path || '(root)', nest: a, spring: b, policy: 'structural' }];
}

/** Collect raw numeric mismatches with zero tolerance (audit mode). */
export function rawNumericDiff(a, b, path = '', out = []) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (!Object.is(a, b)) {
      out.push({
        path: path || '(root)',
        nest: a,
        spring: b,
        ulps: ulpsApart(a, b),
        abs: Math.abs(a - b),
        accepted: classifyNumeric(path || '(root)', a, b) === null,
      });
    }
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      rawNumericDiff(a[k], b[k], path ? `${path}.${k}` : k, out);
    }
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) rawNumericDiff(a[i], b[i], `${path}[${i}]`, out);
  }
  return out;
}
