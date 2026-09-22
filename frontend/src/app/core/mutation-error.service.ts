import { Injectable, signal } from '@angular/core';
import { ApiError } from './api-error';

@Injectable({ providedIn: 'root' })
export class MutationErrorService {
  readonly translationKey = signal<string | undefined>(undefined);

  show(error?: unknown): void {
    this.translationKey.set(
      error instanceof ApiError ? `errors.${error.code}` : 'errors.error.generic',
    );
  }

  clear(): void {
    this.translationKey.set(undefined);
  }
}
