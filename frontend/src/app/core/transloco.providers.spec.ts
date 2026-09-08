import { provideHttpClient } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import enUS from '../../../public/i18n/en-US.json';
import { provideAppTransloco } from './transloco.providers';

describe('provideAppTransloco', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideAppTransloco()],
    });
  });

  it('uses the generic message for an unmapped error code', () => {
    const transloco = TestBed.inject(TranslocoService);
    transloco.setTranslation(enUS, 'en-US');
    transloco.setActiveLang('en-US');
    const unmappedKey = ['errors', 'transaction', 'some_unmapped_code'].join('.');

    expect(transloco.translate(unmappedKey)).toBe(enUS.errors.error.generic);
    expect(transloco.translate(unmappedKey)).not.toBe(unmappedKey);
  });
});
