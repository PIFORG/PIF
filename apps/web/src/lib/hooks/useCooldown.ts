'use client';

import { useCallback, useEffect, useState } from 'react';

/** Client-side pacing for "send again" buttons; the API enforces its own limits regardless. */
export function useCooldown(seconds: number) {
  const [until, setUntil] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (until === null) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) setUntil(null);
    };
    tick();
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, [until]);

  const start = useCallback(() => setUntil(Date.now() + seconds * 1000), [seconds]);

  return { remaining, active: remaining > 0, start };
}
