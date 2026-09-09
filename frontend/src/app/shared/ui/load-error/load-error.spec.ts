import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../../testing/transloco';
import { LoadError } from './load-error';

describe('LoadError', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoadError, provideTestTransloco('en-US')],
      providers: [provideTestTranslocoLocale('en-US'), provideZonelessChangeDetection()],
    }).compileComponents();
  });

  it('renders its message and emits retry on button click', () => {
    const fixture = TestBed.createComponent(LoadError);
    fixture.componentRef.setInput('messageKey', 'common.loadError');
    let emitted = 0;
    fixture.componentInstance.retry.subscribe(() => emitted++);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      TestBed.inject(TranslocoService).translate('common.loadError'),
    );

    element.querySelector('button')?.click();
    expect(emitted).toBe(1);
  });

  it('shows the retrying label while retrying', () => {
    const fixture = TestBed.createComponent(LoadError);
    fixture.componentRef.setInput('retrying', true);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('button')?.textContent).toContain(
      TestBed.inject(TranslocoService).translate('common.retrying'),
    );
  });
});
