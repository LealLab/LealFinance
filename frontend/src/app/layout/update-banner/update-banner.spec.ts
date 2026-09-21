import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { IdentityApiService } from '../../core/identity-api.service';
import { UpdateStatus, User } from '../../core/identity.models';
import { SessionService } from '../../core/session.service';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';
import { UpdateBanner } from './update-banner';

const ADMIN: User = {
  id: 'u1',
  email: 'ada@example.com',
  displayName: 'Ada',
  role: 'admin',
  isActive: true,
  aiChatEnabled: false,
  createdAt: '2026-01-01T00:00:00Z',
};

const MEMBER: User = {
  ...ADMIN,
  id: 'u2',
  email: 'grace@example.com',
  role: 'member',
};

const UPDATE_STATUS: UpdateStatus = {
  currentVersion: 'v1.0.0',
  latestVersion: 'v1.2.0',
  updateAvailable: true,
  releaseUrl: 'https://github.com/LealLab/LealFinance/releases/tag/v1.2.0',
  releaseNotes:
    '## Features\n\n* feat: new thing by @ada in https://github.com/LealLab/LealFinance/pull/1\n',
  publishedAt: '2026-09-01T12:00:00Z',
};

describe('UpdateBanner', () => {
  let api: { updateStatus: ReturnType<typeof vi.fn> };

  function setup(user: User) {
    return TestBed.configureTestingModule({
      imports: [
        UpdateBanner,
        provideTestTransloco('en-US'),
      ],
      providers: [
        provideTestTranslocoLocale('en-US'),
        provideZonelessChangeDetection(),
        { provide: IdentityApiService, useValue: api },
        { provide: SessionService, useValue: { user: signal(user) } },
      ],
    }).compileComponents();
  }

  beforeEach(() => {
    localStorage.clear();
    api = { updateStatus: vi.fn().mockReturnValue(of(UPDATE_STATUS)) };
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renders the banner with the version message for an admin when an update is available', async () => {
    await setup(ADMIN);
    const fixture = TestBed.createComponent(UpdateBanner);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.updateStatus).toHaveBeenCalled();
    expect(fixture.componentInstance['latestVersion']()).toBe('v1.2.0');
  });

  it('never calls the endpoint and never renders the banner for a member', async () => {
    await setup(MEMBER);
    const fixture = TestBed.createComponent(UpdateBanner);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.updateStatus).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
  });

  it('dismissing the banner hides it and persists across a fresh component instance', async () => {
    await setup(ADMIN);
    const fixture = TestBed.createComponent(UpdateBanner);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="status"]')).not.toBeNull();

    fixture.componentInstance['dismiss']();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
    expect(localStorage.getItem('lealfinance.dismissedUpdateVersion')).toBe('v1.2.0');

    const secondFixture = TestBed.createComponent(UpdateBanner);
    secondFixture.detectChanges();
    await secondFixture.whenStable();
    secondFixture.detectChanges();

    expect(secondFixture.nativeElement.querySelector('[role="status"]')).toBeNull();
  });

  it('opens the update modal when requested', async () => {
    await setup(ADMIN);
    const fixture = TestBed.createComponent(UpdateBanner);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.componentInstance['openModal']();
    fixture.detectChanges();

    expect(fixture.componentInstance['modalOpen']()).toBe(true);
  });

  async function render(status: UpdateStatus = UPDATE_STATUS) {
    api.updateStatus.mockReturnValue(of(status));
    await setup(ADMIN);
    const fixture = TestBed.createComponent(UpdateBanner);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('recommends `task update` in the update modal instead of raw compose commands', async () => {
    const fixture = await render();
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('task update');
    expect(text).toContain('task install');
    expect(text).not.toContain('docker compose');
    expect(text).toContain('git pull --ff-only');
    expect(text).toContain('If Git reports an error, resolve it before continuing.');
  });

  it('copies a command to the clipboard and confirms it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const fixture = await render();

    const buttons = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    const copyButtons = buttons.filter((b) => b.textContent?.trim() === 'Copy');
    // task update + task install (update modal), task backup + task backup:verify.
    expect(copyButtons).toHaveLength(4);

    copyButtons[1].click();
    await Promise.resolve();
    fixture.detectChanges();

    expect(writeText).toHaveBeenCalledWith('task install');
    expect(fixture.componentInstance['copiedCommand']()).toBe('task install');
    expect(copyButtons[1].textContent?.trim()).toBe('Copied');
    expect(copyButtons[0].textContent?.trim()).toBe('Copy');
    // The copied state tints the button green while keeping the button's own classes.
    expect(copyButtons[1].classList).toContain('text-positive!');
    expect(copyButtons[1].classList).toContain('rounded');
    expect(copyButtons[0].classList).not.toContain('text-positive!');
  });

  it('opens the backup modal in-app without navigating anywhere', async () => {
    const fixture = await render();

    fixture.componentInstance['openBackupModal']();
    fixture.detectChanges();

    expect(fixture.componentInstance['backupModalOpen']()).toBe(true);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('task backup');
    expect(text).toContain('task backup:verify');
    // The only outbound link is the explicit docs button.
    const external = [...fixture.nativeElement.querySelectorAll('a[href]')].map(
      (a) => (a as HTMLAnchorElement).href,
    );
    expect(external).toContain(
      'https://github.com/LealLab/LealFinance/blob/main/docs/homelab-deploy.md#backups',
    );
  });

  it('shows release notes, the version and the date in the notes modal', async () => {
    const fixture = await render();

    fixture.componentInstance['openNotesModal']();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(fixture.componentInstance['notesModalOpen']()).toBe(true);
    expect(text).toContain('Release notes v1.2.0');
    expect(text).toContain('Sep 1, 2026');
    expect(fixture.nativeElement.querySelector('.md-content h2')?.textContent).toBe('Features');
  });

  it('opens links inside the release notes in a new tab', async () => {
    const fixture = await render();

    const link = fixture.nativeElement.querySelector('.md-content a') as HTMLAnchorElement;
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
  });

  it('colors known release-note sections and leaves other headings alone', async () => {
    const fixture = await render({
      ...UPDATE_STATUS,
      releaseNotes: "## Features\n\n* a\n\n## Bug Fixes\n\n* b\n\n## What's Changed\n\n* c\n",
    });

    const classes = [...fixture.nativeElement.querySelectorAll('.md-release h2')].map(
      (h) => (h as HTMLElement).className,
    );
    expect(classes).toEqual(['rn-features', 'rn-fixes', '']);
  });

  it('links to the full release on GitHub from the notes modal', async () => {
    const fixture = await render();

    const hrefs = [...fixture.nativeElement.querySelectorAll('a[href]')].map(
      (a) => (a as HTMLAnchorElement).href,
    );
    expect(hrefs).toContain('https://github.com/LealLab/LealFinance/releases/tag/v1.2.0');
  });

  it('shows a fallback when the release has no notes', async () => {
    const fixture = await render({ ...UPDATE_STATUS, releaseNotes: undefined });

    expect(fixture.nativeElement.querySelector('.md-content')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('No release notes were published');
  });
});
