import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PasswordConfirm } from './password-confirm';
import { provideTestTransloco } from '../../../../testing/transloco';

describe('PasswordConfirm', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PasswordConfirm, provideTestTransloco()],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
  });

  function setup(open = true) {
    const fixture = TestBed.createComponent(PasswordConfirm);
    fixture.componentRef.setInput('open', open);
    const confirmed: string[] = [];
    fixture.componentInstance.confirmed.subscribe((value) => confirmed.push(value));
    fixture.detectChanges();
    return { fixture, confirmed };
  }

  function type(fixture: ReturnType<typeof setup>['fixture'], value: string) {
    const input = fixture.nativeElement.querySelector('#password-confirm-input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('emits the typed password and does nothing while it is empty', () => {
    const { fixture, confirmed } = setup();
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;

    form.dispatchEvent(new Event('submit'));
    expect(confirmed).toEqual([]);

    type(fixture, 'hunter2 hunter2');
    form.dispatchEvent(new Event('submit'));
    expect(confirmed).toEqual(['hunter2 hunter2']);
  });

  it('keeps the confirm button disabled until a password is typed, and while busy', () => {
    const { fixture } = setup();
    const submit = () =>
      fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit().disabled).toBe(true);

    type(fixture, 'secret-password');
    expect(submit().disabled).toBe(false);

    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();
    expect(submit().disabled).toBe(true);
  });

  it('shows the error it is given as an alert', () => {
    const { fixture } = setup();
    fixture.componentRef.setInput('errorKey', 'errors.auth.invalid_credentials');
    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector('[role="alert"]') as HTMLElement;
    expect(alert).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('#password-confirm-input').getAttribute('aria-invalid'),
    ).toBe('true');
  });

  it('forgets the typed password when the dialog closes', () => {
    const { fixture } = setup();
    type(fixture, 'secret-password');

    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#password-confirm-input') as HTMLInputElement;
    expect(input.value).toBe('');
  });
});
