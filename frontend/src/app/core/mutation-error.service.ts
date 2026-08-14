import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class MutationErrorService {
  readonly translationKey = signal<string | undefined>(undefined);

  show(): void {
    this.translationKey.set('errors.error.generic');
  }

  clear(): void {
    this.translationKey.set(undefined);
  }
}
