import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { IdentityApiService } from '../../core/identity-api.service';
import { UpdateStatus, User } from '../../core/identity.models';
import { SessionService } from '../../core/session.service';
import { provideTestTransloco } from '../../../testing/transloco';
import { UpdateBanner } from './update-banner';

const ADMIN: User = {
  id: 'u1',
  email: 'ada@example.com',
  displayName: 'Ada',
  role: 'admin',
  isActive: true,
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
});
