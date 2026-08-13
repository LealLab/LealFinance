import { Component, computed, input } from '@angular/core';

const ICON_FILES = {
  home: 'home.svg',
  wallet: 'wallet.svg',
  swap: 'swap.svg',
  tag: 'tag.svg',
  target: 'target.svg',
  chart: 'chart.svg',
  settings: 'settings.svg',
  sun: 'sun.svg',
  moon: 'moon.svg',
  globe: 'globe.svg',
  menu: 'menu.svg',
  close: 'close.svg',
  plus: 'plus.svg',
  trash: 'trash.svg',
  pencil: 'pencil.svg',
  chevronDown: 'chevron-down.svg',
  chevronRight: 'chevron-right.svg',
  check: 'check.svg',
  alertTriangle: 'alert-triangle.svg',
  repeat: 'repeat.svg',
  archive: 'archive.svg',
  arrowUpRight: 'arrow-up-right.svg',
  arrowDownLeft: 'arrow-down-left.svg',
  refresh: 'refresh.svg',
  search: 'search.svg',
  eye: 'eye.svg',
  eyeOff: 'eye-off.svg',
  command: 'command.svg',
  cornerDownLeft: 'corner-down-left.svg',
  zap: 'zap.svg',
  grip: 'grip.svg',
  bank: 'bank.svg'
} as const;

export type IconName = keyof typeof ICON_FILES;

/**
 * Renders the app's standalone SVG assets as CSS masks. The mask inherits
 * `currentColor`, so existing text-color utilities and dynamic institution
 * colors continue to theme icons without duplicating SVG markup in Angular.
 */
@Component({
  selector: 'app-icon',
  templateUrl: './icon.html',
  styleUrl: './icon.scss'
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(20);

  protected readonly iconUrl = computed(() => `url('/icons/${ICON_FILES[this.name()]}')`);
}
