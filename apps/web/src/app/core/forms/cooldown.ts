import { DestroyRef, computed, inject, signal } from '@angular/core';

/** Client-side pacing for "send again" buttons (apps/web useCooldown); the API enforces its own limits regardless. */
export function createCooldown(seconds: number) {
  const remaining = signal(0);
  let timer: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  inject(DestroyRef).onDestroy(stop);

  const start = () => {
    stop();
    const until = Date.now() + seconds * 1000;
    const tick = () => {
      const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      remaining.set(left);
      if (left === 0) stop();
    };
    tick();
    timer = setInterval(tick, 1000);
  };

  return { remaining: remaining.asReadonly(), active: computed(() => remaining() > 0), start };
}
