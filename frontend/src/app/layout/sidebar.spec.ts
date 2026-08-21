import { signal, WritableSignal } from '@angular/core';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { User } from '../core/identity.models';
import { MetadataService } from '../core/metadata.service';
import { SessionService } from '../core/session.service';
import ptBR from '../../../public/i18n/pt-BR.json';
import { Sidebar } from './sidebar';

describe('Sidebar', () => {
  let sessionUser: WritableSignal<User | undefined>;

  beforeEach(async () => {
    sessionUser = signal<User | undefined>(undefined);
    await TestBed.configureTestingModule({
      imports: [
        Sidebar,
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' },
        }),
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
    expect(links).toContain('/admin/providers');
    expect(fixture.nativeElement.textContent).toContain('Administração');
  });

  it('hides provider management from members', () => {
    sessionUser.set({
      id: 'member-id',
      email: 'member@example.com',
      displayName: 'Member',
      role: 'member',
      isActive: true,
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
