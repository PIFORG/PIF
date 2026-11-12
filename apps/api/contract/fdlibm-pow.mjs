// fdlibm's e_pow.c as ported in java.lang.FdLibm.Pow (StrictMath.pow), transcribed to JavaScript.
//
// V8 computes Math.pow and ** with the platform C library's pow (std::pow), which differs between operating systems
// and from fdlibm in the last bit for a few percent of arguments. The actuarial golden fixtures are generated a second
// time with Math.pow replaced by this function, so the Java port (StrictMath.pow) can be checked bit for bit; the
// native-pow fixtures measure the residual difference.
const view = new DataView(new ArrayBuffer(8));
const hi = (x) => (view.setFloat64(0, x), view.getInt32(0));
const lo = (x) => (view.setFloat64(0, x), view.getInt32(4));
const withHi = (x, h) => (view.setFloat64(0, x), view.setInt32(0, h), view.getFloat64(0));
const withLo = (x, l) => (view.setFloat64(0, x), view.setInt32(4, l), view.getFloat64(0));
const EXP_SIGNIF_BITS = 0x7fffffff;
const INFINITY = Infinity;

/** z·2ⁿ rounded once: the first factor keeps z (in [0.5, 2)) normal so that only the last product rounds. */
function scalb(z, n) {
  if (n < -1000) return z * 2 ** -1000 * 2 ** (n + 1000);
  return z * 2 ** n;
}

export function fdlibmPow(x, y) {
  let z, r, s, t, u, v, w;
  let i, j, k, n;

  if (y === 0.0) return 1.0;
  if (Number.isNaN(x) || Number.isNaN(y)) return x + y;

  const yAbs = Math.abs(y);
  let xAbs = Math.abs(x);
  if (y === 2.0) {
    return x * x;
  } else if (y === 0.5) {
    if (x >= -Number.MAX_VALUE) return Math.sqrt(x + 0.0);
  } else if (yAbs === 1.0) {
    return y === 1.0 ? x : 1.0 / x;
  } else if (yAbs === INFINITY) {
    if (xAbs === 1.0) return y - y;
    else if (xAbs > 1.0) return y >= 0 ? y : 0.0;
    else return y < 0 ? -y : 0.0;
  }

  const hx = hi(x);
  let ix = hx & EXP_SIGNIF_BITS;

  let yIsInt = 0;
  if (hx < 0) {
    if (yAbs >= 2 ** 53) yIsInt = 2;
    else if (yAbs >= 1.0) {
      const yLong = Math.trunc(yAbs);
      if (yLong === yAbs) yIsInt = 2 - (yLong % 2);
    }
  }

  if (xAbs === 0.0 || xAbs === INFINITY || xAbs === 1.0) {
    z = xAbs;
    if (y < 0.0) z = 1.0 / z;
    if (hx < 0) {
      if (((ix - 0x3ff00000) | yIsInt) === 0) {
        z = (z - z) / (z - z);
      } else if (yIsInt === 1) z = -1.0 * z;
    }
    return z;
  }

  n = (hx >> 31) + 1;
  if ((n | yIsInt) === 0) return (x - x) / (x - x);

  s = 1.0;
  if ((n | (yIsInt - 1)) === 0) s = -1.0;

  let pH, pL, t1, t2;
  if (yAbs > 2147485695.9999995) {
    const INV_LN2 = 1.4426950408889634;
    const INV_LN2_H = 1.4426950216293335;
    const INV_LN2_L = 1.9259629911266175e-8;
    if (xAbs < 0.9999995231628418) return y < 0.0 ? s * INFINITY : s * 0.0;
    if (xAbs > 1.0000009536743162) return y > 0.0 ? s * INFINITY : s * 0.0;
    t = xAbs - 1.0;
    w = t * t * (0.5 - t * (0.3333333333333333333333 - t * 0.25));
    u = INV_LN2_H * t;
    v = t * INV_LN2_L - w * INV_LN2;
    t1 = u + v;
    t1 = withLo(t1, 0);
    t2 = v - (t1 - u);
  } else {
    const CP = 0.9617966939259756;
    const CP_H = 0.9617967009544373;
    const CP_L = -7.028461650952758e-9;
    let zH, zL, ss, s2, sH, sL, tH, tL;
    n = 0;
    if (ix < 0x00100000) {
      xAbs *= 2 ** 53;
      n -= 53;
      ix = hi(xAbs);
    }
    n += (ix >> 20) - 0x3ff;
    j = ix & 0x000fffff;
    ix = j | 0x3ff00000;
    if (j <= 0x3988e) k = 0;
    else if (j < 0xbb67a) k = 1;
    else {
      k = 0;
      n += 1;
      ix -= 0x00100000;
    }
    xAbs = withHi(xAbs, ix);

    const BP = [1.0, 1.5];
    const DP_H = [0.0, 0.5849624872207642];
    const DP_L = [0.0, 1.350039202129749e-8];
    const L1 = 0.5999999999999946;
    const L2 = 0.4285714285785502;
    const L3 = 0.33333332981837743;
    const L4 = 0.272728123808534;
    const L5 = 0.23066074577556175;
    const L6 = 0.20697501780033842;
    u = xAbs - BP[k];
    v = 1.0 / (xAbs + BP[k]);
    ss = u * v;
    sH = ss;
    sH = withLo(sH, 0);
    tH = 0.0;
    tH = withHi(tH, ((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18));
    tL = xAbs - (tH - BP[k]);
    sL = v * (u - sH * tH - sH * tL);
    s2 = ss * ss;
    r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
    r += sL * (sH + ss);
    s2 = sH * sH;
    tH = 3.0 + s2 + r;
    tH = withLo(tH, 0);
    tL = r - (tH - 3.0 - s2);
    u = sH * tH;
    v = sL * tH + tL * ss;
    pH = u + v;
    pH = withLo(pH, 0);
    pL = v - (pH - u);
    zH = CP_H * pH;
    zL = CP_L * pH + pL * CP + DP_L[k];
    t = n;
    t1 = zH + zL + DP_H[k] + t;
    t1 = withLo(t1, 0);
    t2 = zL - (t1 - t - DP_H[k] - zH);
  }

  let y1 = y;
  y1 = withLo(y1, 0);
  pL = (y - y1) * t1 + y * t2;
  pH = y1 * t1;
  z = pL + pH;
  j = hi(z);
  i = lo(z);
  if (j >= 0x40900000) {
    if (((j - 0x40900000) | i) !== 0) return s * INFINITY;
    else {
      const OVT = 8.0085662595372944372e-17;
      if (pL + OVT > z - pH) return s * INFINITY;
    }
  } else if ((j & EXP_SIGNIF_BITS) >= 0x4090cc00) {
    if (((j - 0xc090cc00) | i) !== 0) return s * 0.0;
    else if (pL <= z - pH) return s * 0.0;
  }
  const P1 = 0.16666666666666602;
  const P2 = -0.0027777777777015593;
  const P3 = 6.613756321437934e-5;
  const P4 = -1.6533902205465252e-6;
  const P5 = 4.1381367970572385e-8;
  const LG2 = 0.6931471805599453;
  const LG2_H = 0.6931471824645996;
  const LG2_L = -1.904654299957768e-9;
  i = j & EXP_SIGNIF_BITS;
  k = (i >> 20) - 0x3ff;
  n = 0;
  if (i > 0x3fe00000) {
    n = j + (0x00100000 >> (k + 1));
    k = ((n & EXP_SIGNIF_BITS) >> 20) - 0x3ff;
    t = 0.0;
    t = withHi(t, n & ~(0x000fffff >> k));
    n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
    if (j < 0) n = -n;
    pH -= t;
  }
  t = pL + pH;
  t = withLo(t, 0);
  u = t * LG2_H;
  v = (pL - (t - pH)) * LG2 + t * LG2_L;
  z = u + v;
  w = v - (z - u);
  t = z * z;
  t1 = z - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  r = (z * t1) / (t1 - 2.0) - (w + z * w);
  z = 1.0 - (r - z);
  j = hi(z);
  j += n << 20;
  if (j >> 20 <= 0) z = scalb(z, n);
  else {
    let zHi = hi(z);
    zHi += n << 20;
    z = withHi(z, zHi);
  }
  return s * z;
}
