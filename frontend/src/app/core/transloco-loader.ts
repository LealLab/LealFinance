import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Translation, TranslocoLoader } from '@jsverse/transloco';
import { Observable } from 'rxjs';

/**
 * Fetches translation files from /i18n/{lang}.json — served from
 * public/i18n/ (Angular 22's default static-assets directory, not the
 * legacy src/assets/).
 */
@Injectable({ providedIn: 'root' })
export class HttpTranslocoLoader implements TranslocoLoader {
  private readonly http = inject(HttpClient);

  getTranslation(langPath: string): Observable<Translation> {
    return this.http.get<Translation>(`/i18n/${langPath}.json`);
  }
}
