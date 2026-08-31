import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ConfirmService } from '../../core/confirm.service';
import { IdentityApiService } from '../../core/identity-api.service';
import { User, Invitation, CreatedInvitation } from '../../core/identity.models';
import { SessionService } from '../../core/session.service';
import { UsersAdmin } from './users-admin';
import { provideTestTransloco } from '../../../testing/transloco';

const USERS: User[] = [
  {
    id: 'u1',
    email: 'ada@example.com',
    displayName: 'Ada',
    role: 'admin',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'u2',
    email: 'grace@example.com',
    displayName: 'Grace',
    role: 'member',
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
        provideTestTransloco()
      ],
      providers: [
        provideZonelessChangeDetection(),
        { provide: IdentityApiService, useValue: api },
        // The signed-in admin is USERS[0] (Ada) - the sole active admin in
        // the default fixture, so her own row locks as the last admin.
        { provide: SessionService, useValue: { user: signal(USERS[0]) } }
      ]
    }).compileComponents();
  });

  function findUserRow(el: HTMLElement, email: string): HTMLElement {
    // `.p-3` narrows to the per-user row div - `<app-card>`'s own host
    // element also carries `rounded-md` (see shared/ui/card/card.ts) and
    // wraps everything, so a bare `.rounded-md` match picks that ancestor
    // instead of the row.
    const row = Array.from(el.querySelectorAll<HTMLElement>('div.rounded-md.p-3')).find(
      (div) => div.querySelector('select') && div.textContent?.includes(email)
    );
    if (!row) throw new Error(`No user row found for ${email}`);
    return row;
  }

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
    expect(fixture.componentInstance['issued']()?.token).toBe('secret-token');
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

  it('confirms before promoting a member and reverts the row if declined', async () => {
    const fixture = TestBed.createComponent(UsersAdmin);
    fixture.detectChanges();
    await fixture.componentInstance['reload']();
    fixture.detectChanges();

    const member = fixture.componentInstance['users']().find((u: User) => u.id === 'u2')!;
    member.role = 'admin';

    const savePromise = fixture.componentInstance['saveUser'](member);
    await fixture.whenStable();

    const confirmService = TestBed.inject(ConfirmService);
    const request = confirmService.request();
    expect(request?.titleKey).toBe('admin.users.roleChange.title');
    expect(request?.messageKey).toBe('admin.users.roleChange.promote');

    confirmService.respond(false);
    await savePromise;

    expect(member.role).toBe('member');
    expect(api.updateUser).not.toHaveBeenCalled();
  });

  it('saves the new role once the confirmation is accepted', async () => {
    const fixture = TestBed.createComponent(UsersAdmin);
    fixture.detectChanges();
    await fixture.componentInstance['reload']();
    fixture.detectChanges();

    const member = fixture.componentInstance['users']().find((u: User) => u.id === 'u2')!;
    member.role = 'admin';
    api.updateUser.mockReturnValue(of({ ...member, role: 'admin' }));

    const savePromise = fixture.componentInstance['saveUser'](member);
    await fixture.whenStable();

    TestBed.inject(ConfirmService).respond(true);
    await savePromise;

    expect(api.updateUser).toHaveBeenCalledWith(
      'u2',
      expect.objectContaining({ role: 'admin' })
    );
  });

  it('does not prompt when saving without a role change', async () => {
    const fixture = TestBed.createComponent(UsersAdmin);
    fixture.detectChanges();
    await fixture.componentInstance['reload']();
    fixture.detectChanges();

    const member = fixture.componentInstance['users']().find((u: User) => u.id === 'u2')!;
    member.displayName = 'Grace H.';
    api.updateUser.mockReturnValue(of(member));

    await fixture.componentInstance['saveUser'](member);

    expect(TestBed.inject(ConfirmService).request()).toBeNull();
    expect(api.updateUser).toHaveBeenCalled();
  });

  it('locks the role and active controls for a peer admin', async () => {
    const peerAdmin: User = { ...USERS[1], id: 'u3', email: 'grace-admin@example.com', role: 'admin' };
    api.listUsers.mockReturnValue(of([...USERS, peerAdmin]));

    const fixture = TestBed.createComponent(UsersAdmin);
    fixture.detectChanges();
    await fixture.componentInstance['reload']();
    fixture.detectChanges();
    // NgModel defers applying [disabled] to a microtask
    // (`resolvedPromise.then(...)` in its `_updateDisabled`), so the DOM
    // property isn't set until that microtask flushes.
    await Promise.resolve();
    fixture.detectChanges();

    const row = findUserRow(fixture.nativeElement, peerAdmin.email);
    expect(row.querySelector('select')!.disabled).toBe(true);
    expect((row.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBe(true);
  });
});
