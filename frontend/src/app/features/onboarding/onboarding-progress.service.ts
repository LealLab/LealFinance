import { computed, effect, Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'lealfinance.onboarding.progress';

export interface OnboardingProgress {
  step: number;
  createdAccountId: string | null;
  dismissed: boolean;
}

/** Persists the interruptible guided-setup marker per browser. */
@Injectable({ providedIn: 'root' })
export class OnboardingProgressService {
  private readonly state = signal<OnboardingProgress>(this.readInitial());

  readonly progress = this.state.asReadonly();
  readonly step = computed(() => this.state().step);
  readonly createdAccountId = computed(() => this.state().createdAccountId);
  readonly dismissed = computed(() => this.state().dismissed);

  constructor() {
    effect(() => this.persist(this.state()));
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

  private readInitial(): OnboardingProgress {
    const fallback: OnboardingProgress = { step: 1, createdAccountId: null, dismissed: false };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
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

  private persist(progress: OnboardingProgress): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch {
      // Storage unavailable - progress still applies for the current session.
    }
  }
}
