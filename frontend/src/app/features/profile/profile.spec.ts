import { signal, WritableSignal } from '@angular/core';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { ApiError } from '../../core/api-error';
import { IdentityApiService } from '../../core/identity-api.service';
import { User } from '../../core/identity.models';
import { SessionService } from '../../core/session.service';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';
import { Profile } from './profile';

const USER: User = {
  id: 'user-1',
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  role: 'member',
  isActive: true,
  aiChatEnabled: false,
  createdAt: '',
};

describe('Profile', () => {
  let sessionUser: WritableSignal<User | undefined>;
  let session: {
    user: ReturnType<WritableSignal<User | undefined>['asReadonly']>;
    updateProfile: ReturnType<typeof vi.fn>;
    changePassword: ReturnType<typeof vi.fn>;
  };
  let identityApi: { totpStatus: ReturnType<typeof vi.fn>; listPasskeys: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    sessionUser = signal<User | undefined>(USER);
    session = {
      user: sessionUser.asReadonly(),
      updateProfile: vi.fn().mockReturnValue(of(USER)),
      changePassword: vi.fn().mockReturnValue(of(undefined)),
    };
    identityApi = {
      totpStatus: vi.fn().mockReturnValue(of({ enabled: false, backupCodesRemaining: 0 })),
      listPasskeys: vi.fn().mockReturnValue(of([])),
    };
    await TestBed.configureTestingModule({
      imports: [Profile, provideTestTransloco()],
      providers: [
        provideZonelessChangeDetection(),
        provideTestTranslocoLocale(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            fragment: new BehaviorSubject<string | null>(null).asObservable(),
            snapshot: { fragment: null },
          },
        },
        { provide: SessionService, useValue: session },
        { provide: IdentityApiService, useValue: identityApi },
      ],
    }).compileComponents();
  });

  it('renders initials and both profile security sections', () => {
    const fixture = TestBed.createComponent(Profile);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('AL');
    expect(fixture.nativeElement.querySelector('#profile-two-factor')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#profile-passkeys')).not.toBeNull();
  });

  it('requires the current password only when changing email and updates the session', async () => {
    const fixture = TestBed.createComponent(Profile);
    fixture.detectChanges();
    fixture.componentInstance['profileForm'].patchValue({ email: 'new@example.com' });

    await fixture.componentInstance['saveProfile']();
    expect(session.updateProfile).not.toHaveBeenCalled();

    fixture.componentInstance['profileForm'].patchValue({ currentPassword: 'old-password' });
    await fixture.componentInstance['saveProfile']();

    expect(session.updateProfile).toHaveBeenCalledWith({
      displayName: 'Ada Lovelace',
      email: 'new@example.com',
      currentPassword: 'old-password',
    });
    expect(fixture.componentInstance['profileSaved']()).toBe(true);
  });

  it('shows failed profile edits', async () => {
    session.updateProfile.mockReturnValue(
      throwError(() => new ApiError(401, 'auth.invalid_credentials', {})),
    );
    const fixture = TestBed.createComponent(Profile);
    fixture.detectChanges();

    fixture.componentInstance['profileForm'].patchValue({ displayName: 'New Name' });
    await fixture.componentInstance['saveProfile']();
    fixture.detectChanges();

    expect(fixture.componentInstance['profileErrorCode']()).toBe('auth.invalid_credentials');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('blocks short password changes before calling the API', async () => {
    const fixture = TestBed.createComponent(Profile);
    fixture.detectChanges();
    fixture.componentInstance['passwordForm'].setValue({
      currentPassword: 'old-password',
      newPassword: 'too-short',
    });

    await fixture.componentInstance['changePassword']();

    expect(session.changePassword).not.toHaveBeenCalled();
    expect(fixture.componentInstance['passwordForm'].invalid).toBe(true);
  });
});
