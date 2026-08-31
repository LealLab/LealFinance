import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { MetadataService } from './metadata.service';
import { PreferenceService } from './preference.service';
import { SessionService } from './session.service';

export const authGuard: CanActivateFn = (_route, state) => {
  const session = inject(SessionService);
  const router = inject(Router);
  return session
    .ensureLoaded()
    .pipe(
      map(
        (ready) =>
          ready || router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } }),
      ),
    );
};

export const adminGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  return session
    .ensureLoaded()
    .pipe(
      map((ready) =>
        ready && session.user()?.role === 'admin' ? true : router.createUrlTree(['/']),
      ),
    );
};

/** Guards the Providers page - agentsGuard runs after authGuard's
 * canActivateChild (which resolves before a child route's own canActivate),
 * so metadata is already hydrated by the time this reads the signal. */
export const agentsGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const metadata = inject(MetadataService);
  const router = inject(Router);
  return session
    .ensureLoaded()
    .pipe(
      map((ready) =>
        ready && metadata.settings()?.agentsEnabled ? true : router.createUrlTree(['/']),
      ),
    );
};

/** Guards the Investments feature - only reachable once the user has
 * opted in via Settings. Unlike agentsGuard (an instance-wide flag from
 * metadata), this reads a per-user preference. */
export const investmentsGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const preferences = inject(PreferenceService);
  const router = inject(Router);
  return session
    .ensureLoaded()
    .pipe(
      map((ready) =>
        ready && preferences.preferences()?.investmentsEnabled ? true : router.createUrlTree(['/']),
      ),
    );
};

export const aiChatGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  return session.ensureLoaded().pipe(
    map((ready) =>
      ready && session.user()?.aiChatEnabled ? true : router.createUrlTree(['/']),
    ),
  );
};
