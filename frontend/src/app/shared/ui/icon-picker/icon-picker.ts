import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { Icon, ICON_GROUPS, IconGroup, IconName } from '../icon/icon';
import { Modal } from '../modal/modal';

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

interface IconSection {
  readonly group: IconGroup;
  readonly names: readonly IconName[];
}

const GROUPS = Object.entries(ICON_GROUPS) as [IconGroup, readonly IconName[]][];

/**
 * Modal grid over `ICON_GROUPS`, grouped into sections and filterable by a
 * search box, for any form field that currently stores an `IconName`
 * (category icon, institution icon, ...). Reuses `Modal` rather than being one itself, so it
 * stacks correctly when opened from a form that's already inside one - the
 * native `<dialog>` top layer and Escape-closes-topmost behavior handle the
 * nesting without extra code.
 *
 * Usage: `<app-icon-picker [(open)]="iconPickerOpen" [selected]="icon()" (picked)="form.controls.icon.setValue($event)" />`
 */
@Component({
  selector: 'app-icon-picker',
  imports: [Icon, Modal, TranslocoDirective],
  templateUrl: './icon-picker.html',
})
export class IconPicker {
  private readonly transloco = inject(TranslocoService);

  readonly open = model(false);
  readonly selected = input.required<IconName>();
  readonly picked = output<IconName>();

  protected readonly query = signal('');

  constructor() {
    effect(() => {
      if (this.open()) this.query.set('');
    });
  }

  protected readonly filtered = computed<IconSection[]>(() => {
    const needle = normalize(this.query());
    if (!needle) return GROUPS.map(([group, names]) => ({ group, names }));

    return GROUPS.map(([group, names]) => {
      const groupLabel = this.transloco.translate(`icons.groups.${group}`);
      if (normalize(groupLabel).includes(needle)) return { group, names };

      return {
        group,
        names: names.filter((name) => {
          const label = this.transloco.translate(`icons.names.${name}`);
          return normalize(name).includes(needle) || normalize(label).includes(needle);
        })
      };
    }).filter((section) => section.names.length > 0);
  });

  protected pick(name: IconName): void {
    this.picked.emit(name);
    this.open.set(false);
  }
}
