import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Icon } from './icon';

describe('Icon', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Icon],
      providers: [provideZonelessChangeDetection()]
    });
  });

  it('resolves a typed icon name to its standalone SVG mask', () => {
    const fixture = TestBed.createComponent(Icon);
    fixture.componentRef.setInput('name', 'alertTriangle');
    fixture.detectChanges();

    const icon = fixture.nativeElement.querySelector('.icon') as HTMLSpanElement;
    expect(icon.style.getPropertyValue('--icon-url')).toBe("url('/icons/alert-triangle.svg')");
    expect(fixture.nativeElement.querySelector('svg')).toBeNull();
  });

  it('applies the requested dimensions while remaining color-inheriting', () => {
    const fixture = TestBed.createComponent(Icon);
    fixture.componentRef.setInput('name', 'home');
    fixture.componentRef.setInput('size', 32);
    fixture.nativeElement.style.color = 'rgb(12, 34, 56)';
    fixture.detectChanges();

    const icon = fixture.nativeElement.querySelector('.icon') as HTMLSpanElement;
    expect(icon.style.width).toBe('32px');
    expect(icon.style.height).toBe('32px');
    expect(getComputedStyle(icon).backgroundColor).toBe('rgb(12, 34, 56)');
  });
});
