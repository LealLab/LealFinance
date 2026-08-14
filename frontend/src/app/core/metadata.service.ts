import { inject, Injectable, signal } from '@angular/core';
import { forkJoin, Observable, tap } from 'rxjs';
import { IdentityApiService } from './identity-api.service';
import { CurrencyMetadata, PublicSettings } from './identity.models';

@Injectable({ providedIn: 'root' })
export class MetadataService {
  private readonly api = inject(IdentityApiService);
  readonly currencies = signal<CurrencyMetadata[]>([]);
  readonly settings = signal<PublicSettings | undefined>(undefined);

  hydrate(): Observable<unknown> {
    return forkJoin({
      currencies: this.api.currencies(),
      settings: this.api.publicSettings(),
    }).pipe(
      tap(({ currencies, settings }) => {
        this.currencies.set(currencies);
        this.settings.set(settings);
      }),
    );
  }
}
