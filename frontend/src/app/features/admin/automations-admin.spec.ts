import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { IdentityApiService } from '../../core/identity-api.service';
import { JobHealth } from '../../core/identity.models';
import { provideTestTransloco } from '../../../testing/transloco';
import { AutomationsAdmin } from './automations-admin';

const JOBS: JobHealth[] = [
  {
    name: 'app.workers.tasks.recurring.post_recurring_transactions',
    state: 'stale',
    status: 'success',
    startedAt: '2026-09-08T08:00:00Z',
    finishedAt: '2026-09-08T08:01:00Z',
    processed: 12,
    failed: 0,
    intervalSeconds: 3600,
  },
  {
    name: 'app.workers.tasks.imports.process_pending',
    state: 'failed',
    status: 'failed',
    startedAt: '2026-09-08T07:00:00Z',
    finishedAt: '2026-09-08T07:01:00Z',
    processed: 2,
    failed: 1,
    errorType: 'RuntimeError',
    intervalSeconds: 3600,
  },
  {
    name: 'app.workers.tasks.reports.refresh',
    state: 'never_run',
    status: null,
    processed: 0,
    failed: 0,
    intervalSeconds: 86400,
  },
];

describe('AutomationsAdmin', () => {
  let api: {
    listJobs: ReturnType<typeof vi.fn>;
    runJob: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    api = {
      listJobs: vi.fn().mockReturnValue(of(JOBS)),
      runJob: vi.fn().mockReturnValue(of(undefined)),
    };
    await TestBed.configureTestingModule({
      imports: [AutomationsAdmin, provideTestTransloco('en-US')],
      providers: [
        provideZonelessChangeDetection(),
        { provide: IdentityApiService, useValue: api },
      ],
    }).compileComponents();
  });

  async function render() {
    const fixture = TestBed.createComponent(AutomationsAdmin);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('renders one row per job and highlights jobs needing attention', async () => {
    const fixture = await render();
    const cards = fixture.nativeElement.querySelectorAll('app-card');
    const text = fixture.nativeElement.textContent as string;

    expect(cards).toHaveLength(3);
    expect(text).toContain('post_recurring_transactions');
    expect(text).toContain('This job is overdue');
    expect(text).toContain('The last run failed');
    expect(text).toContain('RuntimeError');
    expect(fixture.nativeElement.querySelector('.text-warning')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.text-negative')).toBeTruthy();
  });

  it('shows the never-run label', async () => {
    const fixture = await render();

    expect(fixture.nativeElement.textContent).toContain('Never run');
  });

  it('runs the selected job and disables its button while awaiting', async () => {
    vi.useFakeTimers();
    try {
      const fixture = await render();
      const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
      const button = Array.from(buttons).find(
        (candidate) => candidate.textContent?.includes('Run now'),
      ) as HTMLButtonElement;

      button.click();
      fixture.detectChanges();

      expect(api.runJob).toHaveBeenCalledWith(JOBS[0].name);
      expect(button.disabled).toBe(true);
      await vi.advanceTimersByTimeAsync(1500);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a load error and retries instead of rendering an empty list', async () => {
    api.listJobs.mockReturnValueOnce(throwError(() => new Error('offline')));
    const fixture = await render();

    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not load the automation status.',
    );
    api.listJobs.mockReturnValue(of(JOBS));
    const retry = fixture.nativeElement.querySelector('[role="alert"] button') as HTMLButtonElement;
    retry.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.listJobs).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.querySelectorAll('app-card')).toHaveLength(3);
  });
});
