import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { ICON_NAMES, IconName } from '../icon/icon';
import { IconPicker } from './icon-picker';
import ptBR from '../../../../../public/i18n/pt-BR.json';

@Component({
  selector: 'app-icon-picker-host',
  imports: [IconPicker],
  template: `<app-icon-picker [(open)]="open" [selected]="selected()" (picked)="onPicked($event)" />`
})
class IconPickerHost {
  readonly open = signal(true);
  readonly selected = signal<IconName>('tag');
  readonly lastPicked = signal<IconName | undefined>(undefined);

  onPicked(name: IconName): void {
    this.lastPicked.set(name);
  }
}

describe('IconPicker', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        IconPickerHost,
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' }
        })
      ],
      providers: [provideZonelessChangeDetection()]
    });
  });

  it('renders every icon in the set', () => {
    const fixture = TestBed.createComponent(IconPickerHost);
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('dialog button[aria-pressed]');
    expect(buttons.length).toBe(ICON_NAMES.length);
  });

  it('narrows the grid when searching and restores it when the query clears', () => {
    const fixture = TestBed.createComponent(IconPickerHost);
    fixture.detectChanges();

    const search = fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    search.value = 'wallet';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    let buttons = fixture.nativeElement.querySelectorAll('dialog button[aria-pressed]');
    expect(buttons.length).toBe(1);

    search.value = '';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    buttons = fixture.nativeElement.querySelectorAll('dialog button[aria-pressed]');
    expect(buttons.length).toBe(ICON_NAMES.length);
  });

  it('emits the picked icon and closes when a grid button is clicked', () => {
    const fixture = TestBed.createComponent(IconPickerHost);
    fixture.detectChanges();

    const search = fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    search.value = 'wallet';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('dialog button[aria-pressed]') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.lastPicked()).toBe('wallet');
    expect(fixture.componentInstance.open()).toBe(false);
  });
});
