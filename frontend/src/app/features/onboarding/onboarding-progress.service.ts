import { computed, effect, inject, Injectable, linkedSignal } from '@angular/core';
import { SessionService } from '../../core/session.service';

const STORAGE_KEY = 'lealfinance.onboarding.progress';

export interface OnboardingProgress {
  step: number;
  createdAccountId: string | null;
  dismissed: boolean;
}

/** Persists the interruptible guided-setup marker per signed-in user. */
@Injectable({ providedIn: 'root' })
export class OnboardingProgressService {
  private readonly session = inject(SessionService);
  private readonly userId = computed(() => this.session.user()?.id);
  private readonly state = linkedSignal({
    source: this.userId,
    computation: (userId) => this.readInitial(userId),
  });

  readonly progress = this.state.asReadonly();
  readonly step = computed(() => this.state().step);
  readonly createdAccountId = computed(() => this.state().createdAccountId);
  readonly dismissed = computed(() => this.state().dismissed);

  constructor() {
    effect(() => this.persist(this.userId(), this.state()));
  }

  setStep(step: number): void {
    this.state.update((current) => ({
      ...current,
      step: Math.max(1, Math.min(5, Math.round(step))),
    }));
  }

  setCreatedAccountId(createdAccountId: string | null): void {
    this.state.update((current) => ({ ...current, createdAccountId }));
  }

  dismiss(): void {
    this.state.update((current) => ({ ...current, dismissed: true }));
  }

  private readInitial(userId: string | undefined): OnboardingProgress {
    const fallback: OnboardingProgress = { step: 1, createdAccountId: null, dismissed: false };
    if (!userId) return fallback;
    try {
      const raw = localStorage.getItem(`${STORAGE_KEY}.${userId}`);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<OnboardingProgress>;
      if (
        typeof parsed.step !== 'number' ||
        !Number.isFinite(parsed.step) ||
        typeof parsed.dismissed !== 'boolean' ||
        (parsed.createdAccountId !== null && typeof parsed.createdAccountId !== 'string')
      ) {
        return fallback;
      }
      return {
        step: Math.max(1, Math.min(5, Math.round(parsed.step))),
        createdAccountId: parsed.createdAccountId,
        dismissed: parsed.dismissed,
      };
    } catch {
      return fallback;
    }
  }

  private persist(userId: string | undefined, progress: OnboardingProgress): void {
    if (!userId) return;
    try {
      localStorage.setItem(`${STORAGE_KEY}.${userId}`, JSON.stringify(progress));
    } catch {
      // Storage unavailable - progress still applies for the current session.
    }
  }
}
