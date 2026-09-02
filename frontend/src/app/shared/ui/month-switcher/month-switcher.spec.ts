import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../../testing/transloco';
import { MonthSwitcher } from './month-switcher';

describe('MonthSwitcher', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MonthSwitcher, provideTestTransloco('en-US')],
      providers: [provideTestTranslocoLocale('en-US'), provideZonelessChangeDetection()],
    }).compileComponents();
  });

  it('renders the localized month label', () => {
    const fixture = TestBed.createComponent(MonthSwitcher);
    fixture.componentRef.setInput('month', '2025-12');
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('December 2025');
  });

  it('advances December into January of the next year', async () => {
    const fixture = TestBed.createComponent(MonthSwitcher);
    fixture.componentRef.setInput('month', '2025-12');
    fixture.detectChanges();

    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    buttons[1].click();
    await fixture.whenStable();

    expect(fixture.componentInstance.month()).toBe('2026-01');
  });
});
