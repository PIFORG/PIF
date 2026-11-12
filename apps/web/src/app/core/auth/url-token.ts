import { Injector, afterNextRender, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

/**
 * Hands the `?token=` of an e-mail link to the page, then removes it from the address bar, history and
 * router state without consuming it (the API call happens only when the user confirms). Call in an
 * injection context.
 */
export function takeUrlToken(onToken: (token: string) => void): void {
  const router = inject(Router);
  const injector = inject(Injector);
  inject(ActivatedRoute)
    .queryParamMap.pipe(takeUntilDestroyed())
    .subscribe((params) => {
      const raw = params.get('token');
      if (!raw) return;
      onToken(raw);
      afterNextRender(
        () => {
          const url = router.parseUrl(router.url);
          const rest = { ...url.queryParams };
          delete rest['token'];
          url.queryParams = rest;
          void router.navigateByUrl(url, { replaceUrl: true });
        },
        { injector },
      );
    });
}
