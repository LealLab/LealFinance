import { signal, WritableSignal } from '@angular/core';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { User } from '../core/identity.models';
import { MetadataService } from '../core/metadata.service';
import { SessionService } from '../core/session.service';
import { provideTestTransloco } from '../../testing/transloco';
import { Sidebar } from './sidebar';

describe('Sidebar', () => {
  let sessionUser: WritableSignal<User | undefined>;

  beforeEach(async () => {
    sessionUser = signal<User | undefined>(undefined);
    await TestBed.configureTestingModule({
      imports: [
        Sidebar,
        provideTestTransloco(),
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: SessionService, useValue: { user: sessionUser.asReadonly() } },
      ],
    }).compileComponents();
  });

  it('shows providers in Administration only for enabled admins', () => {
    sessionUser.set({
      id: 'admin-id',
      email: 'admin@example.com',
      displayName: 'Admin',
      role: 'admin',
      isActive: true,
      aiChatEnabled: false,
      createdAt: '',
    });
    TestBed.inject(MetadataService).settings.set({
      defaultCurrency: 'BRL',
      defaultLocale: 'pt-BR',
      agentsEnabled: true,
    });

    const fixture = TestBed.createComponent(Sidebar);
    fixture.detectChanges();

    const links = [...fixture.nativeElement.querySelectorAll('a')].map((link) =>
      (link as HTMLAnchorElement).getAttribute('href'),
    );
    expect(links).toContain('/chat');
    expect(links).toContain('/admin/providers');
  });

  it('hides provider management from members', () => {
    sessionUser.set({
      id: 'member-id',
      email: 'member@example.com',
      displayName: 'Member',
      role: 'member',
      isActive: true,
      aiChatEnabled: false,
      createdAt: '',
    });
    TestBed.inject(MetadataService).settings.set({
      defaultCurrency: 'BRL',
      defaultLocale: 'pt-BR',
      agentsEnabled: true,
    });

    const fixture = TestBed.createComponent(Sidebar);
    fixture.detectChanges();

    const links = [...fixture.nativeElement.querySelectorAll('a')].map((link) =>
      (link as HTMLAnchorElement).getAttribute('href'),
    );
    expect(links).not.toContain('/admin/providers');
    expect(links).not.toContain('/admin/users');
  });
});
