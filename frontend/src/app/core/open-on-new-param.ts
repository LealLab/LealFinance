import { effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

/**
 * Wires a feature's create-form opener to the `?new=1` query param that
 * `command-palette.ts`'s quick-create actions navigate with. Call from a
 * component's constructor (an injection context).
 *
 * The param is stripped right after firing `open()` - without that, a user
 * already sitting on e.g. `/accounts?new=1` who triggers the same palette
 * action again navigates to an identical URL, Angular treats it as a no-op,
 * and the action does nothing the second time.
 */
export function openOnNewParam(open: () => void): void {
  const route = inject(ActivatedRoute);
  const router = inject(Router);
  const queryParamMap = toSignal(route.queryParamMap, {
    initialValue: route.snapshot.queryParamMap
  });

  effect(() => {
    if (!queryParamMap().has('new')) return;
    open();
    router.navigate([], {
      relativeTo: route,
      queryParams: { new: null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  });
}
