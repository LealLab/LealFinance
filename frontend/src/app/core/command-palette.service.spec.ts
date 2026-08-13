import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CommandPaletteService } from './command-palette.service';

describe('CommandPaletteService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('starts closed', () => {
    const service = TestBed.inject(CommandPaletteService);

    expect(service.isOpen()).toBe(false);
  });

  it('show opens it and hide closes it', () => {
    const service = TestBed.inject(CommandPaletteService);

    service.show();
    expect(service.isOpen()).toBe(true);

    service.hide();
    expect(service.isOpen()).toBe(false);
  });

  it('toggle flips the current state', () => {
    const service = TestBed.inject(CommandPaletteService);

    service.toggle();
    expect(service.isOpen()).toBe(true);

    service.toggle();
    expect(service.isOpen()).toBe(false);
  });
});
