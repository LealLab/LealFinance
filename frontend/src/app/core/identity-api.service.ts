import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiClient } from './api-client';
import {
  CreatedInvitation,
  CurrencyMetadata,
  Invitation,
  Preferences,
  PublicSettings,
  User,
  UserRole,
} from './identity.models';

/**
 * Dynamic backend error translations used by auth and administration UI.
 * t(errors.error.generic, errors.auth.invalid_credentials, errors.auth.csrf_invalid, errors.auth.last_admin, errors.auth.account_inactive, errors.auth.admin_required, errors.invitation.not_found, errors.invitation.expired, errors.invitation.revoked, errors.invitation.already_accepted, errors.invitation.already_pending, errors.user.email_taken)
 */

interface UserWire {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

interface PreferencesWire {
  locale: string;
  theme: 'light' | 'dark';
  base_currency: string;
  display_currency: string;
  balances_hidden: boolean;
}

interface InvitationWire {
  id: string;
  email: string;
  role: UserRole;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  token?: string;
}

interface CurrencyWire {
  code: string;
  name: string;
  symbol: string;
  decimal_digits: number;
  is_active: boolean;
}

interface PublicSettingsWire {
  default_currency: string;
  default_locale: string;
  agents_enabled: boolean;
}

const mapUser = (value: UserWire): User => ({
  id: value.id,
  email: value.email,
  displayName: value.display_name,
  role: value.role,
  isActive: value.is_active,
  createdAt: value.created_at,
});

const mapPreferences = (value: PreferencesWire): Preferences => ({
  locale: value.locale,
  theme: value.theme,
  baseCurrency: value.base_currency,
  displayCurrency: value.display_currency,
  balancesHidden: value.balances_hidden,
});

const mapInvitation = (value: InvitationWire): Invitation => ({
  id: value.id,
  email: value.email,
  role: value.role,
  expiresAt: value.expires_at,
  acceptedAt: value.accepted_at ?? undefined,
  revokedAt: value.revoked_at ?? undefined,
  createdAt: value.created_at,
});

@Injectable({ providedIn: 'root' })
export class IdentityApiService {
  private readonly api = inject(ApiClient);

  me(): Observable<User> {
    return this.api.get<UserWire>('/auth/me').pipe(map(mapUser));
  }

  login(email: string, password: string): Observable<User> {
    return this.api.post<UserWire>('/auth/login', { email, password }).pipe(map(mapUser));
  }

  register(input: {
    email: string;
    token?: string;
    password: string;
    displayName: string;
    baseCurrency: string;
  }): Observable<User> {
    return this.api
      .post<UserWire>('/auth/register', {
        email: input.email,
        ...(input.token ? { token: input.token } : {}),
        password: input.password,
        display_name: input.displayName,
        base_currency: input.baseCurrency,
      })
      .pipe(map(mapUser));
  }

  /** Public probe: true while the instance has no users yet, meaning
   * POST /auth/register will accept a request with no invitation token. */
  setupStatus(): Observable<boolean> {
    return this.api
      .get<{ needs_setup: boolean }>('/auth/setup-status')
      .pipe(map((r) => r.needs_setup));
  }

  logout(): Observable<void> {
    return this.api.post<void>('/auth/logout', {});
  }

  getPreferences(): Observable<Preferences> {
    return this.api.get<PreferencesWire>('/auth/preferences').pipe(map(mapPreferences));
  }

  updatePreferences(changes: Partial<Preferences>): Observable<Preferences> {
    const body: Partial<PreferencesWire> = {};
    if (Object.hasOwn(changes, 'locale')) body.locale = changes.locale;
    if (Object.hasOwn(changes, 'theme')) body.theme = changes.theme;
    if (Object.hasOwn(changes, 'displayCurrency')) {
      body.display_currency = changes.displayCurrency;
    }
    if (Object.hasOwn(changes, 'balancesHidden')) {
      body.balances_hidden = changes.balancesHidden;
    }
    return this.api.patch<PreferencesWire>('/auth/preferences', body).pipe(map(mapPreferences));
  }

  listUsers(): Observable<User[]> {
    return this.api.get<UserWire[]>('/auth/users').pipe(map((rows) => rows.map(mapUser)));
  }

  updateUser(
    id: string,
    changes: Partial<Pick<User, 'displayName' | 'role' | 'isActive'>>,
  ): Observable<User> {
    const body: Record<string, unknown> = {};
    if (Object.hasOwn(changes, 'displayName')) body['display_name'] = changes.displayName;
    if (Object.hasOwn(changes, 'role')) body['role'] = changes.role;
    if (Object.hasOwn(changes, 'isActive')) body['is_active'] = changes.isActive;
    return this.api.patch<UserWire>(`/auth/users/${id}`, body).pipe(map(mapUser));
  }

  listInvitations(): Observable<Invitation[]> {
    return this.api
      .get<InvitationWire[]>('/auth/invitations')
      .pipe(map((rows) => rows.map(mapInvitation)));
  }

  createInvitation(email: string, role: UserRole): Observable<CreatedInvitation> {
    return this.api
      .post<InvitationWire>('/auth/invitations', { email, role })
      .pipe(map((row) => ({ ...mapInvitation(row), token: row.token ?? '' })));
  }

  revokeInvitation(id: string): Observable<void> {
    return this.api.delete<void>(`/auth/invitations/${id}`);
  }

  currencies(): Observable<CurrencyMetadata[]> {
    return this.api.get<CurrencyWire[]>('/meta/currencies').pipe(
      map((rows) =>
        rows.map((row) => ({
          code: row.code,
          name: row.name,
          symbol: row.symbol,
          decimalDigits: row.decimal_digits,
          isActive: row.is_active,
        })),
      ),
    );
  }

  publicSettings(): Observable<PublicSettings> {
    return this.api.get<PublicSettingsWire>('/meta/settings').pipe(
      map((row) => ({
        defaultCurrency: row.default_currency,
        defaultLocale: row.default_locale,
        agentsEnabled: row.agents_enabled,
      })),
    );
  }
}
