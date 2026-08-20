import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { IdentityApiService } from '../../core/identity-api.service';
import { User, Invitation, CreatedInvitation } from '../../core/identity.models';
import { UsersAdmin } from './users-admin';
import ptBR from '../../../../public/i18n/pt-BR.json';

const USERS: User[] = [
  {
    id: 'u1',
    email: 'ada@example.com',
    displayName: 'Ada',
    role: 'admin',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z'
  }
];

const INVITATIONS: Invitation[] = [
  {
    id: 'inv1',
    email: 'grace@example.com',
    role: 'member',
    expiresAt: '2026-02-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z'
  }
];

describe('UsersAdmin', () => {
  let api: {
    listUsers: ReturnType<typeof vi.fn>;
    listInvitations: ReturnType<typeof vi.fn>;
    updateUser: ReturnType<typeof vi.fn>;
    createInvitation: ReturnType<typeof vi.fn>;
    revokeInvitation: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    api = {
      listUsers: vi.fn().mockReturnValue(of(USERS)),
      listInvitations: vi.fn().mockReturnValue(of(INVITATIONS)),
      updateUser: vi.fn(),
      createInvitation: vi.fn(),
      revokeInvitation: vi.fn().mockReturnValue(of(undefined))
    };
    await TestBed.configureTestingModule({
      imports: [
        UsersAdmin,
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' }
        })
      ],
      providers: [
        provideZonelessChangeDetection(),
        { provide: IdentityApiService, useValue: api }
      ]
    }).compileComponents();
  });

  it('loads and renders the seeded users and invitations on init', async () => {
    const fixture = TestBed.createComponent(UsersAdmin);
    fixture.detectChanges();
    // The constructor's `reload()` is fire-and-forget (a plain Promise, not
    // routed through Angular's scheduler), so whenStable() alone doesn't
    // reliably wait for it - await it directly instead.
    await fixture.componentInstance['reload']();
    fixture.detectChanges();

    expect(api.listUsers).toHaveBeenCalled();
    expect(api.listInvitations).toHaveBeenCalled();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('ada@example.com');
    expect(text).toContain('grace@example.com');
  });

  it('creates an invitation, shows the one-time token, and reloads the list', async () => {
    const issued: CreatedInvitation = { ...INVITATIONS[0], id: 'inv2', token: 'secret-token' };
    api.createInvitation.mockReturnValue(of(issued));
    const fixture = TestBed.createComponent(UsersAdmin);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.componentInstance['inviteEmail'].set('new@example.com');
    await fixture.componentInstance['createInvitation']();
    fixture.detectChanges();

    expect(api.createInvitation).toHaveBeenCalledWith('new@example.com', 'member');
    expect(fixture.componentInstance['inviteEmail']()).toBe('');
    expect(fixture.componentInstance['issued']()).toEqual(issued);
    expect((fixture.nativeElement.textContent as string)).toContain('secret-token');
    expect(api.listUsers).toHaveBeenCalledTimes(2);
  });

  it('revokes an invitation and reloads the list', async () => {
    const fixture = TestBed.createComponent(UsersAdmin);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    await fixture.componentInstance['revoke'](INVITATIONS[0]);

    expect(api.revokeInvitation).toHaveBeenCalledWith('inv1');
    expect(api.listInvitations).toHaveBeenCalledTimes(2);
  });

  it('shows the translated backend error code when creating an invitation fails', async () => {
    api.createInvitation.mockReturnValue(throwError(() => ({ code: 'invitation.already_pending' })));
    const fixture = TestBed.createComponent(UsersAdmin);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.componentInstance['inviteEmail'].set('new@example.com');
    await fixture.componentInstance['createInvitation']();
    fixture.detectChanges();

    expect(fixture.componentInstance['errorCode']()).toBe('invitation.already_pending');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
  });
});
