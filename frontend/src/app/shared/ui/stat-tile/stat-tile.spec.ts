import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { StatTile } from './stat-tile';

describe('StatTile', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatTile],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
  });

  function figureClasses(inputs: Record<string, unknown>): DOMTokenList {
    const fixture = TestBed.createComponent(StatTile);
    fixture.componentRef.setInput('label', 'Market value');
    fixture.componentRef.setInput('value', '$697.00');
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
    return (fixture.nativeElement.querySelector('.font-mono') as HTMLElement).classList;
  }

  it('keeps a prominent figure large until lg by default (dashboard)', () => {
    const classes = figureClasses({ prominent: true });
    expect(classes).toContain('sm:text-4xl');
    expect(classes).toContain('lg:text-2xl');
  });

  it('steps a prominent figure back down at sm when the row splits there', () => {
    // Regression: budgets/investments put three tiles side by side from sm up,
    // and the lg-sized figure wrapped mid-number ("697,0 / 0") between sm and lg.
    const classes = figureClasses({ prominent: true, prominentUntil: 'sm' });
    expect(classes).toContain('text-3xl');
    expect(classes).toContain('sm:text-2xl');
    expect(classes).not.toContain('sm:text-4xl');
  });
});
