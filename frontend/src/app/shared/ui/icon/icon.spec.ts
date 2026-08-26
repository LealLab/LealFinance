import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ICON_GROUPS, ICON_NAMES, Icon, IconName } from './icon';

describe('ICON_GROUPS', () => {
  it('only references real icon names, each in at most one group', () => {
    const validNames = new Set<IconName>(ICON_NAMES);
    const seen = new Set<IconName>();

    for (const names of Object.values(ICON_GROUPS)) {
      for (const name of names) {
        expect(validNames.has(name)).toBe(true);
        expect(seen.has(name)).toBe(false);
        seen.add(name);
      }
    }
  });
});

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
