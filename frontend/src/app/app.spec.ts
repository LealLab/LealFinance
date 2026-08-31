import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { App } from './app';
import { provideTestTransloco } from '../testing/transloco';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        App,
        provideTestTransloco(['pt-BR', 'ar', 'he-IL'])
      ],
      providers: [provideZonelessChangeDetection(), provideRouter([])]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('keeps document language and direction in sync with Transloco', () => {
    const fixture = TestBed.createComponent(App);
    const transloco = TestBed.inject(TranslocoService);
    fixture.detectChanges();

    expect(document.documentElement.lang).toBe('pt-BR');
    expect(document.documentElement.dir).toBe('ltr');

    transloco.setActiveLang('ar');
    fixture.detectChanges();
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');

    transloco.setActiveLang('he-IL');
    fixture.detectChanges();
    expect(document.documentElement.lang).toBe('he-IL');
    expect(document.documentElement.dir).toBe('rtl');
  });
});
