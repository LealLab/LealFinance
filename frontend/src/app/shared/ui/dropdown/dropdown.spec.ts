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
      panel: () => el.querySelector('[role="menu"]'),
    };
  }

  it('toggles the panel when the trigger is clicked', () => {
    const { fixture, trigger, panel } = setup();
    expect(panel()).toBeNull();

    trigger.click();
    fixture.detectChanges();
    expect(panel()).not.toBeNull();

    trigger.click();
    fixture.detectChanges();
    expect(panel()).toBeNull();
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
});
