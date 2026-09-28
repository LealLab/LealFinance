import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Dropdown } from './dropdown';

@Component({
  selector: 'app-dropdown-host',
  imports: [Dropdown],
  template: `
    <app-dropdown [(open)]="open">
      <button dropdownTrigger type="button">Trigger</button>
      <button type="button" class="item">Item</button>
    </app-dropdown>
    <button type="button" class="outside">Outside</button>
  `,
})
class DropdownHost {
  readonly open = signal(false);
}

describe('Dropdown', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DropdownHost],
      providers: [provideZonelessChangeDetection()],
    });
  });

  function setup() {
    const fixture = TestBed.createComponent(DropdownHost);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      trigger: el.querySelector('[dropdownTrigger]') as HTMLButtonElement,
      outside: el.querySelector('.outside') as HTMLButtonElement,
      panel: () => el.querySelector('app-dropdown > div'),
    };
  }

  it('toggles the panel when the trigger is clicked', () => {
    const { fixture, trigger, panel } = setup();
    expect(panel()).toBeNull();

    trigger.click();
    fixture.detectChanges();
    expect(panel()).not.toBeNull();
    expect(trigger.getAttribute('aria-haspopup')).toBe('true');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    trigger.click();
    fixture.detectChanges();
    expect(panel()).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes when a click lands outside the host', () => {
    const { fixture, trigger, outside, panel } = setup();
    trigger.click();
    fixture.detectChanges();
    expect(panel()).not.toBeNull();

    outside.click();
    fixture.detectChanges();
    expect(panel()).toBeNull();
  });

  it('stays open when a click lands inside the panel', () => {
    const { fixture, trigger, panel } = setup();
    trigger.click();
    fixture.detectChanges();

    (panel()!.querySelector('.item') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(panel()).not.toBeNull();
  });

  it('closes on Escape and returns focus to the trigger', () => {
    const { fixture, trigger, panel } = setup();
    trigger.click();
    fixture.detectChanges();
    expect(panel()).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  describe('when the panel bottom is hidden', () => {
    const original = document.elementFromPoint;
    afterEach(() => {
      document.elementFromPoint = original;
      vi.restoreAllMocks();
    });

    function openWith(hit: Element | null, triggerTop: number) {
      const { fixture, trigger, panel } = setup();
      // Something other than the panel (e.g. a fixed bottom bar) sits on its bottom edge.
      document.elementFromPoint = () => hit;
      vi.spyOn(trigger.closest('app-dropdown')!, 'getBoundingClientRect').mockReturnValue(
        { top: triggerTop } as DOMRect,
      );
      trigger.click();
      fixture.detectChanges();
      return panel()!;
    }

    it('opens above the trigger when there is room', () => {
      const outside = document.createElement('div');
      expect(openWith(outside, 600).className).toContain('bottom-full');
    });

    it('stays below when there is no room above', () => {
      const outside = document.createElement('div');
      expect(openWith(outside, 0).className).not.toContain('bottom-full');
    });

    it('stays below when the room above is behind the header, above the scrolling <main>', () => {
      const main = document.createElement('main');
      document.body.appendChild(main);
      const { fixture, trigger, panel } = setup();
      main.appendChild(fixture.nativeElement);
      vi.spyOn(main, 'getBoundingClientRect').mockReturnValue({ top: 600 } as DOMRect);
      document.elementFromPoint = () => document.createElement('div');
      vi.spyOn(trigger.closest('app-dropdown')!, 'getBoundingClientRect').mockReturnValue({
        top: 600,
      } as DOMRect);
      trigger.click();
      fixture.detectChanges();
      expect(panel()!.className).not.toContain('bottom-full');
      main.remove();
    });
  });
});
