import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, finalize, map, Observable, of, shareReplay, switchMap, tap } from 'rxjs';
import { IdentityApiService } from './identity-api.service';
import { User } from './identity.models';
import { MetadataService } from './metadata.service';
import { PreferenceService } from './preference.service';

const SESSION_ERROR_CODES = new Set([
  'auth.unauthenticated',
  'auth.session_invalid',
  'auth.account_inactive',
]);

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly api = inject(IdentityApiService);
  private readonly preferences = inject(PreferenceService);
  private readonly metadata = inject(MetadataService);
  private readonly router = inject(Router);
  private readonly userState = signal<User | undefined>(undefined);
  private bootstrapRequest?: Observable<boolean>;

  readonly user = this.userState.asReadonly();

  ensureLoaded(): Observable<boolean> {
    this.bootstrapRequest ??= this.api.me().pipe(
      tap((user) => this.userState.set(user)),
      switchMap(() => this.preferences.hydrate()),
      switchMap(() => this.metadata.hydrate()),
      map(() => true),
      catchError(() => {
        this.clearSession();
        return of(false);
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.bootstrapRequest;
  }

  /** `secondFactor` is supplied on the retry after a login answered
   * auth.totp_required - see IdentityApiService.login. That code is
   * deliberately absent from SESSION_ERROR_CODES above: treating it as an
   * expired session would redirect the user away from the challenge they
   * are standing on. */
  login(
    email: string,
    password: string,
    secondFactor?: { code: string; trustDevice: boolean },
  ): Observable<User> {
    return this.api.login(email, password, secondFactor).pipe(
      tap((user) => this.userState.set(user)),
      switchMap((user) => this.preferences.hydrate().pipe(map(() => user))),
      tap(() => this.metadata.hydrate().subscribe()),
    );
  }

  register(input: {
    email: string;
    token?: string;
    password: string;
    displayName: string;
    baseCurrency: string;
    locale: string;
  }): Observable<User> {
    return this.api.register(input).pipe(
      tap((user) => this.userState.set(user)),
      switchMap((user) => this.preferences.hydrate().pipe(map(() => user))),
      tap(() => this.metadata.hydrate().subscribe()),
    );
  }

  logout(): void {
    this.api
      .logout()
      .pipe(finalize(() => this.expireAndRedirect()))
      .subscribe({ error: () => undefined });
  }

  handleApiError(status: number, code: string): void {
    if (status === 401 && SESSION_ERROR_CODES.has(code)) {
      this.expireAndRedirect();
    }
  }

  clearSession(): void {
    this.userState.set(undefined);
    this.bootstrapRequest = undefined;
    this.preferences.clear();
  }

  private expireAndRedirect(): void {
    const returnUrl = this.router.url.startsWith('/login') ? '/' : this.router.url;
    this.clearSession();
    void this.router.navigate(['/login'], { queryParams: { returnUrl } });
  }
}
