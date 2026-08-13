import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { Modal } from './modal';
import ptBR from '../../../../../public/i18n/pt-BR.json';

@Component({
  selector: 'app-modal-host',
  imports: [Modal],
  template: `<app-modal [(open)]="open" titleText="Test modal">content</app-modal>`
})
class ModalHost {
  readonly open = signal(false);
}

describe('Modal', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        ModalHost,
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' }
        })
      ],
      providers: [provideZonelessChangeDetection()]
    });
  });

  it('opens the native dialog when the open model becomes true', () => {
    const fixture = TestBed.createComponent(ModalHost);
    fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(false);

    fixture.componentInstance.open.set(true);
    fixture.detectChanges();

    expect(dialog.open).toBe(true);
  });

  it('closes the dialog and flips the model back to false when the model is set false', () => {
    const fixture = TestBed.createComponent(ModalHost);
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);

    fixture.componentInstance.open.set(false);
    fixture.detectChanges();

    expect(dialog.open).toBe(false);
  });

  it('syncs the model back to false when the dialog closes itself (e.g. Escape)', () => {
    const fixture = TestBed.createComponent(ModalHost);
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;

    dialog.close();
    fixture.detectChanges();

    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('closes the dialog when the close button is clicked', () => {
    const fixture = TestBed.createComponent(ModalHost);
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    const closeButton = fixture.nativeElement.querySelector('button') as HTMLButtonElement;

    closeButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.open()).toBe(false);
  });
});
