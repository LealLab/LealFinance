import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTestTransloco } from '../../../../testing/transloco';
import { ColorPicker } from './color-picker';

@Component({
  selector: 'app-color-picker-host',
  imports: [ColorPicker],
  template: `<app-color-picker
    [(open)]="open"
    [color]="color()"
    titleText="Color"
    (colorChange)="color.set($event)"
  />`,
})
class ColorPickerHost {
  readonly open = signal(true);
  readonly color = signal('#1F5C6B');
}

describe('ColorPicker', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ColorPickerHost, provideTestTransloco()],
      providers: [provideZonelessChangeDetection()],
    });
  });

  it('converts between hex and RGB while applying valid edits immediately', () => {
    const fixture = TestBed.createComponent(ColorPickerHost);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#color-picker-value') as HTMLInputElement;
    input.value = '#ff0000';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.componentInstance.color()).toBe('#FF0000');

    (
      fixture.nativeElement.querySelectorAll('button[aria-pressed]')[1] as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(input.value).toBe('rgb(255, 0, 0)');

    input.value = 'rgb(0, 128, 255)';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.componentInstance.color()).toBe('#0080FF');
  });

  it('keeps the last valid color when an edit is invalid', () => {
    const fixture = TestBed.createComponent(ColorPickerHost);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#color-picker-value') as HTMLInputElement;
    input.value = '#GG0000';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.componentInstance.color()).toBe('#1F5C6B');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('updates the color from the visual saturation and hue controls', () => {
    const fixture = TestBed.createComponent(ColorPickerHost);
    fixture.detectChanges();

    const bounds = { left: 0, top: 0, width: 100, height: 100 } as DOMRect;
    const saturation = fixture.nativeElement.querySelector('.color-saturation') as HTMLElement;
    const hue = fixture.nativeElement.querySelector('.color-hue') as HTMLElement;
    vi.spyOn(saturation, 'getBoundingClientRect').mockReturnValue(bounds);
    vi.spyOn(hue, 'getBoundingClientRect').mockReturnValue(bounds);

    hue.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 0 }));
    saturation.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 0 }));
    fixture.detectChanges();

    expect(fixture.componentInstance.color()).toBe('#FF0000');
  });

  it('remembers the selected format in local storage', () => {
    const fixture = TestBed.createComponent(ColorPickerHost);
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelectorAll('button[aria-pressed]')[1] as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    fixture.destroy();

    const nextFixture = TestBed.createComponent(ColorPickerHost);
    nextFixture.detectChanges();

    expect(nextFixture.nativeElement.querySelector('#color-picker-value').value).toBe(
      'rgb(31, 92, 107)',
    );
    expect(
      nextFixture.nativeElement
        .querySelectorAll('button[aria-pressed]')[1]
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
