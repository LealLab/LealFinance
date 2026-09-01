import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { firstValueFrom, Observable, of } from 'rxjs';
import { User } from './identity.models';
import { SessionService } from './session.service';
import { aiChatGuard } from './auth.guards';

describe('aiChatGuard', () => {
  let sessionUser: WritableSignal<User | undefined>;

  beforeEach(async () => {
    sessionUser = signal<User | undefined>(undefined);
    await TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: SessionService,
          useValue: {
            ensureLoaded: () => of(true),
            user: sessionUser.asReadonly(),
          },
        },
      ],
    }).compileComponents();
  });

  function result(): Observable<boolean | UrlTree> {
    return TestBed.runInInjectionContext(() =>
      aiChatGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    ) as Observable<boolean | UrlTree>;
  }

  it('allows an administrator even when the stored flag is disabled', async () => {
    sessionUser.set({
      id: 'admin-id',
      email: 'admin@example.com',
      displayName: 'Admin',
      role: 'admin',
      isActive: true,
      aiChatEnabled: false,
      createdAt: '',
    });

    await expect(firstValueFrom(result())).resolves.toBe(true);
  });

  it('denies a member when the stored flag is disabled', async () => {
    sessionUser.set({
      id: 'member-id',
      email: 'member@example.com',
      displayName: 'Member',
      role: 'member',
      isActive: true,
      aiChatEnabled: false,
      createdAt: '',
    });

    await expect(firstValueFrom(result())).resolves.toBeInstanceOf(UrlTree);
  });
});
