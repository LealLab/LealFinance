import { Component, input } from '@angular/core';

/**
 * Small line-icon set, hand-drawn as path/circle data on a 24x24 grid
 * rather than pulled from an icon font or component library — this app has
 * no icon dependency yet and the set stays small (nav + a handful of
 * actions), so inlining keeps it dependency-free and themeable for free via
 * `currentColor`.
 *
 * Add new icons by extending ICONS below; unknown names render nothing.
 */
export type IconName = keyof typeof ICONS;

interface IconShape {
  paths?: string[];
  circles?: { cx: number; cy: number; r: number }[];
  lines?: { x1: number; y1: number; x2: number; y2: number }[];
}

const ICONS = {
  home: {
    paths: ['M4 11.5 12 4l8 7.5', 'M6 10v9.5a.5.5 0 0 0 .5.5H10v-5.5h4V20h3.5a.5.5 0 0 0 .5-.5V10']
  },
  wallet: {
    paths: [
      'M4 7.5A1.5 1.5 0 0 1 5.5 6h12A1.5 1.5 0 0 1 19 7.5V9H5.5A1.5 1.5 0 0 1 4 7.5Z',
      'M4 7.5V17a1.5 1.5 0 0 0 1.5 1.5H19A1.5 1.5 0 0 0 20.5 17V10.5A1.5 1.5 0 0 0 19 9H16a1.75 1.75 0 0 0 0 3.5h4.5'
    ]
  },
  swap: {
    paths: ['M4 8h13M17 8l-3-3M17 8l-3 3', 'M20 16H7M7 16l3-3M7 16l3 3']
  },
  tag: {
    paths: [
      'M11.5 4H6.5a1.5 1.5 0 0 0-1.5 1.5v5l9.5 9.5a1.5 1.5 0 0 0 2.12 0l4.38-4.38a1.5 1.5 0 0 0 0-2.12L11.5 4Z'
    ],
    circles: [{ cx: 9, cy: 9, r: 1.25 }]
  },
  target: {
    circles: [
      { cx: 12, cy: 12, r: 8 },
      { cx: 12, cy: 12, r: 4.25 },
      { cx: 12, cy: 12, r: 0.75 }
    ]
  },
  chart: {
    paths: ['M4 20V10', 'M11 20V4', 'M18 20v-7']
  },
  settings: {
    paths: [
      'm10.3 3.3.4-1a.9.9 0 0 1 .84-.55h1.9a.9.9 0 0 1 .85.56l.4 1a1 1 0 0 0 1.28.55l1.03-.4a.9.9 0 0 1 1 .21l1.35 1.34a.9.9 0 0 1 .2 1l-.4 1.03a1 1 0 0 0 .56 1.28l1 .4a.9.9 0 0 1 .56.85v1.9a.9.9 0 0 1-.56.85l-1 .4a1 1 0 0 0-.56 1.28l.4 1.04a.9.9 0 0 1-.2 1l-1.35 1.33a.9.9 0 0 1-1 .21l-1.03-.4a1 1 0 0 0-1.28.55l-.4 1.03a.9.9 0 0 1-.85.56h-1.9a.9.9 0 0 1-.84-.56l-.4-1.03a1 1 0 0 0-1.29-.55l-1.03.4a.9.9 0 0 1-1-.21L5.62 16a.9.9 0 0 1-.2-1l.4-1.04a1 1 0 0 0-.56-1.28l-1-.4A.9.9 0 0 1 3.7 11.4v-1.9a.9.9 0 0 1 .56-.85l1-.4a1 1 0 0 0 .56-1.28l-.4-1.03a.9.9 0 0 1 .2-1L6.98 3.6a.9.9 0 0 1 1-.21l1.03.4a1 1 0 0 0 1.29-.55Z'
    ],
    circles: [{ cx: 12, cy: 12, r: 3 }]
  },
  sun: {
    circles: [{ cx: 12, cy: 12, r: 4 }],
    lines: [
      { x1: 12, y1: 2.5, x2: 12, y2: 4.5 },
      { x1: 12, y1: 19.5, x2: 12, y2: 21.5 },
      { x1: 4.2, y1: 4.2, x2: 5.6, y2: 5.6 },
      { x1: 18.4, y1: 18.4, x2: 19.8, y2: 19.8 },
      { x1: 2.5, y1: 12, x2: 4.5, y2: 12 },
      { x1: 19.5, y1: 12, x2: 21.5, y2: 12 },
      { x1: 4.2, y1: 19.8, x2: 5.6, y2: 18.4 },
      { x1: 18.4, y1: 5.6, x2: 19.8, y2: 4.2 }
    ]
  },
  moon: {
    paths: ['M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z']
  },
  globe: {
    circles: [{ cx: 12, cy: 12, r: 8 }],
    paths: ['M4 12h16', 'M12 4c2.4 2.3 3.6 5 3.6 8s-1.2 5.7-3.6 8c-2.4-2.3-3.6-5-3.6-8s1.2-5.7 3.6-8Z']
  },
  menu: {
    lines: [
      { x1: 4, y1: 6.5, x2: 20, y2: 6.5 },
      { x1: 4, y1: 12, x2: 20, y2: 12 },
      { x1: 4, y1: 17.5, x2: 20, y2: 17.5 }
    ]
  },
  close: {
    lines: [
      { x1: 6, y1: 6, x2: 18, y2: 18 },
      { x1: 18, y1: 6, x2: 6, y2: 18 }
    ]
  },
  plus: {
    lines: [
      { x1: 12, y1: 5, x2: 12, y2: 19 },
      { x1: 5, y1: 12, x2: 19, y2: 12 }
    ]
  },
  trash: {
    paths: ['M5 7h14', 'M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7', 'M7 7l.7 12a1.5 1.5 0 0 0 1.5 1.4h5.6a1.5 1.5 0 0 0 1.5-1.4L17 7']
  },
  pencil: {
    paths: [
      'm14.5 5 4.5 4.5-9.8 9.8-5 .5.5-5Z',
      'm13 6.5 4.5 4.5'
    ]
  },
  chevronDown: {
    paths: ['M6 9.5 12 15l6-5.5']
  },
  chevronRight: {
    paths: ['M9.5 6 15 12l-5.5 6']
  },
  check: {
    paths: ['M5 12.5 9.5 17 19 7']
  },
  alertTriangle: {
    paths: [
      'M12 4.5 21 19H3L12 4.5Z',
      'M12 10v4'
    ],
    circles: [{ cx: 12, cy: 16.7, r: 0.1 }]
  },
  repeat: {
    paths: ['M4 8h12l-3-3M4 8l3 3', 'M20 16H8l3 3M20 16l-3-3']
  },
  archive: {
    paths: ['M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v2H4Z', 'M5 8.5V18a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5', 'M10 13h4']
  },
  arrowUpRight: {
    paths: ['M8 16 16 8', 'M9.5 8H16v6.5']
  },
  arrowDownLeft: {
    paths: ['M16 8 8 16', 'M14.5 16H8V9.5']
  },
  refresh: {
    paths: ['M4.5 12a7.5 7.5 0 0 1 12.6-5.5M19.5 12a7.5 7.5 0 0 1-12.6 5.5', 'M17 3.5V7h-3.5', 'M7 20.5V17h3.5']
  },
  search: {
    circles: [{ cx: 11, cy: 11, r: 6.5 }],
    lines: [{ x1: 15.8, y1: 15.8, x2: 20, y2: 20 }]
  },
  eye: {
    paths: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z'],
    circles: [{ cx: 12, cy: 12, r: 2.5 }]
  },
  eyeOff: {
    paths: [
      'M6.4 6.4C3.9 8.1 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.7 0 3.2-.5 4.4-1.2',
      'M9.9 9.9a2.5 2.5 0 0 0 3.5 3.5',
      'M16.5 16.5c2.6-1.7 5-4.5 5-4.5s-3.5-6.5-9.5-6.5c-1 0-2 .2-2.9.5'
    ],
    lines: [{ x1: 3.5, y1: 3.5, x2: 20.5, y2: 20.5 }]
  },
  command: {
    circles: [
      { cx: 7, cy: 7, r: 2.25 },
      { cx: 17, cy: 7, r: 2.25 },
      { cx: 7, cy: 17, r: 2.25 },
      { cx: 17, cy: 17, r: 2.25 }
    ],
    lines: [
      { x1: 9.25, y1: 7, x2: 14.75, y2: 7 },
      { x1: 9.25, y1: 17, x2: 14.75, y2: 17 },
      { x1: 7, y1: 9.25, x2: 7, y2: 14.75 },
      { x1: 17, y1: 9.25, x2: 17, y2: 14.75 }
    ]
  },
  cornerDownLeft: {
    paths: ['M9 10 4 15l5 5', 'M20 4v7a4 4 0 0 1-4 4H4']
  },
  zap: {
    paths: ['M13 2 3 14h9l-1 8 10-12h-9l1-8Z']
  },
  grip: {
    circles: [
      { cx: 9, cy: 6, r: 1.25 },
      { cx: 15, cy: 6, r: 1.25 },
      { cx: 9, cy: 12, r: 1.25 },
      { cx: 15, cy: 12, r: 1.25 },
      { cx: 9, cy: 18, r: 1.25 },
      { cx: 15, cy: 18, r: 1.25 }
    ]
  },
  bank: {
    paths: ['M3.5 9.5 12 4.5l8.5 5'],
    lines: [
      { x1: 3, y1: 9.5, x2: 21, y2: 9.5 },
      { x1: 3, y1: 19.5, x2: 21, y2: 19.5 },
      { x1: 3, y1: 21, x2: 21, y2: 21 },
      { x1: 6, y1: 11.5, x2: 6, y2: 19.5 },
      { x1: 10.5, y1: 11.5, x2: 10.5, y2: 19.5 },
      { x1: 13.5, y1: 11.5, x2: 13.5, y2: 19.5 },
      { x1: 18, y1: 11.5, x2: 18, y2: 19.5 }
    ]
  }
} as const satisfies Record<string, IconShape>;

@Component({
  selector: 'app-icon',
  templateUrl: './icon.html',
  styleUrl: './icon.scss'
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(20);

  protected get shape(): IconShape {
    return ICONS[this.name()];
  }
}
