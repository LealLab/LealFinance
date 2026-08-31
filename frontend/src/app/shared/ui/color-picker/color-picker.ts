import { Component, computed, effect, input, model, output, signal } from '@angular/core';
import { Modal } from '../modal/modal';

type ColorFormat = 'hex' | 'rgb';

const STORAGE_KEY = 'lealfinance.colorFormat';
const DEFAULT_COLOR = '#000000';

function normalizeHex(value: string): string | null {
  const match = value.trim().match(/^#?([\da-f]{3}|[\da-f]{6})$/i);
  if (!match) return null;

  const digits =
    match[1].length === 3
      ? match[1]
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : match[1];
  return `#${digits.toUpperCase()}`;
}

function hexToRgb(value: string): [number, number, number] {
  const hex = normalizeHex(value) ?? DEFAULT_COLOR;
  const number = Number.parseInt(hex.slice(1), 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function rgbToHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

function parseRgb(value: string): string | null {
  const match = value.trim().match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  if (!match) return null;

  const channels = match.slice(1).map(Number);
  return channels.every((channel) => channel <= 255)
    ? rgbToHex(...(channels as [number, number, number]))
    : null;
}

function rgbToHsv(red: number, green: number, blue: number): [number, number, number] {
  red /= 255;
  green /= 255;
  blue /= 255;
  const max = Math.max(red, green, blue);
  const delta = max - Math.min(red, green, blue);
  let hue = 0;

  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }

  return [hue < 0 ? hue + 360 : hue, max ? (delta / max) * 100 : 0, max * 100];
}

function hsvToHex(hue: number, saturation: number, value: number): string {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const s = saturation / 100;
  const v = value / 100;
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((normalizedHue / 60) % 2) - 1));
  const match = v - chroma;
  let channels: [number, number, number];

  if (normalizedHue < 60) channels = [chroma, x, 0];
  else if (normalizedHue < 120) channels = [x, chroma, 0];
  else if (normalizedHue < 180) channels = [0, chroma, x];
  else if (normalizedHue < 240) channels = [0, x, chroma];
  else if (normalizedHue < 300) channels = [x, 0, chroma];
  else channels = [chroma, 0, x];

  return rgbToHex(
    Math.round((channels[0] + match) * 255),
    Math.round((channels[1] + match) * 255),
    Math.round((channels[2] + match) * 255)
  );
}

@Component({
  selector: 'app-color-picker',
  imports: [Modal],
  templateUrl: './color-picker.html',
  styleUrl: './color-picker.scss',
})
export class ColorPicker {
  readonly open = model(false);
  readonly color = input.required<string>();
  readonly titleText = input.required<string>();
  readonly colorChange = output<string>();

  protected readonly format = signal<ColorFormat>(this.readFormat());
  protected readonly value = signal('');
  protected readonly invalid = signal(false);
  protected readonly hue = signal(0);
  protected readonly saturation = signal(100);
  protected readonly brightness = signal(100);
  protected readonly huePercent = computed(() => (this.hue() / 360) * 100);
  protected readonly hueColor = computed(() => hsvToHex(this.hue(), 100, 100));
  private saturationDragging = false;
  private hueDragging = false;

  constructor() {
    effect(() => {
      if (this.open()) {
        this.value.set(this.formatValue(this.color()));
        this.syncVisualPicker(this.color());
      }
    });
  }

  protected setFormat(format: ColorFormat): void {
    this.format.set(format);
    this.persistFormat(format);
    this.invalid.set(false);
    this.value.set(this.formatValue(this.color()));
  }

  protected onValueInput(value: string): void {
    this.value.set(value);
    const color = this.format() === 'hex' ? normalizeHex(value) : parseRgb(value);
    this.invalid.set(color === null);
    if (color) this.colorChange.emit(color);
  }

  protected onSaturationPointerDown(event: PointerEvent): void {
    this.saturationDragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.updateSaturation(event);
  }

  protected onSaturationPointerMove(event: PointerEvent): void {
    if (this.saturationDragging) this.updateSaturation(event);
  }

  protected onSaturationPointerUp(): void {
    this.saturationDragging = false;
  }

  protected onSaturationKeydown(event: KeyboardEvent): void {
    const step = event.shiftKey ? 10 : 1;
    if (event.key === 'ArrowLeft') this.saturation.set(Math.max(0, this.saturation() - step));
    else if (event.key === 'ArrowRight') this.saturation.set(Math.min(100, this.saturation() + step));
    else if (event.key === 'ArrowUp') this.brightness.set(Math.min(100, this.brightness() + step));
    else if (event.key === 'ArrowDown') this.brightness.set(Math.max(0, this.brightness() - step));
    else return;
    event.preventDefault();
    this.emitVisualColor();
  }

  protected onHuePointerDown(event: PointerEvent): void {
    this.hueDragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.updateHue(event);
  }

  protected onHuePointerMove(event: PointerEvent): void {
    if (this.hueDragging) this.updateHue(event);
  }

  protected onHuePointerUp(): void {
    this.hueDragging = false;
  }

  protected onHueKeydown(event: KeyboardEvent): void {
    const step = event.shiftKey ? 10 : 1;
    if (event.key === 'ArrowLeft') this.hue.set(Math.max(0, this.hue() - step));
    else if (event.key === 'ArrowRight') this.hue.set(Math.min(360, this.hue() + step));
    else return;
    event.preventDefault();
    this.emitVisualColor();
  }

  private formatValue(color: string): string {
    if (this.format() === 'hex') return normalizeHex(color) ?? DEFAULT_COLOR;
    const [red, green, blue] = hexToRgb(color);
    return `rgb(${red}, ${green}, ${blue})`;
  }

  private syncVisualPicker(color: string): void {
    const [red, green, blue] = hexToRgb(color);
    const [hue, saturation, brightness] = rgbToHsv(red, green, blue);
    this.hue.set(hue);
    this.saturation.set(saturation);
    this.brightness.set(brightness);
  }

  private updateSaturation(event: PointerEvent): void {
    const element = event.currentTarget as HTMLElement;
    const bounds = element.getBoundingClientRect();
    this.saturation.set(Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)));
    this.brightness.set(Math.max(0, Math.min(100, (1 - (event.clientY - bounds.top) / bounds.height) * 100)));
    this.emitVisualColor();
  }

  private updateHue(event: PointerEvent): void {
    const element = event.currentTarget as HTMLElement;
    const bounds = element.getBoundingClientRect();
    this.hue.set(Math.max(0, Math.min(360, ((event.clientX - bounds.left) / bounds.width) * 360)));
    this.emitVisualColor();
  }

  private emitVisualColor(): void {
    this.invalid.set(false);
    this.colorChange.emit(hsvToHex(this.hue(), this.saturation(), this.brightness()));
  }

  private readFormat(): ColorFormat {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === 'rgb' ? 'rgb' : 'hex';
    } catch {
      return 'hex';
    }
  }

  private persistFormat(format: ColorFormat): void {
    try {
      localStorage.setItem(STORAGE_KEY, format);
    } catch {
      // Storage unavailable - the preference still applies for this session.
    }
  }
}
