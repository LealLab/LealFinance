import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { ICON_GROUPS, IconName } from '../icon/icon';
import { IconPicker } from './icon-picker';
import ptBR from '../../../../../public/i18n/pt-BR.json';

const PICKABLE_ICON_COUNT = Object.values(ICON_GROUPS).flat().length;

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

@Component({
  selector: 'app-inline-icon-picker-host',
  imports: [IconPicker],
  template: `<app-icon-picker [inline]="true" [selected]="selected()" (picked)="onPicked($event)" />`
})
class InlineIconPickerHost {
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

  it('renders every pickable icon, grouped into sections', () => {
    const fixture = TestBed.createComponent(IconPickerHost);
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('dialog button[aria-pressed]');
    expect(buttons.length).toBe(PICKABLE_ICON_COUNT);

    const headings = fixture.nativeElement.querySelectorAll('dialog h3');
    expect(headings.length).toBe(Object.keys(ICON_GROUPS).length);
  });

  it('excludes UI-chrome icons that are not part of any group', () => {
    const fixture = TestBed.createComponent(IconPickerHost);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('dialog button[aria-label="Seta para Baixo"]');
    expect(button).toBeNull();
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
    expect(buttons.length).toBe(PICKABLE_ICON_COUNT);
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

  it('renders inline without a dialog and still emits picked icons', () => {
    const fixture = TestBed.createComponent(InlineIconPickerHost);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('dialog')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('button[aria-pressed]').length).toBe(PICKABLE_ICON_COUNT);

    const button = fixture.nativeElement.querySelector('button[aria-label="Carteira"]') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.lastPicked()).toBe('wallet');
  });
});
