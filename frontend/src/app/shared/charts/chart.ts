import {
  afterNextRender,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  viewChild
} from '@angular/core';
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJs,
  ChartData,
  ChartOptions,
  DoughnutController,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip
} from 'chart.js';
import { ThemeService } from '../../core/theme.service';

ChartJs.register(
  BarController,
  LineController,
  DoughnutController,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip
);

export type ChartKind = 'bar' | 'line' | 'doughnut';

export interface ChartDataset {
  label: string;
  data: number[];
  /** Single color for a bar/line dataset. */
  color?: string;
  /** Per-segment colors for a doughnut dataset (one per data point). */
  colors?: string[];
}

/**
 * Thin Chart.js wrapper — the one place chart theming/lifecycle lives, per
 * the design decision to hand-roll chart components instead of adding
 * ECharts/Chart.js-with-a-wrapper-library (see the brainstorming spec).
 * Registers only the controllers/elements this app's three chart kinds
 * need, not `chart.js/auto`, which pulls in every chart type.
 *
 * Chart.js resolves colors into the canvas at config/update time, so a
 * theme toggle needs an explicit re-read of the CSS custom properties
 * (see `themeColors()`) and a manual `update()` — it doesn't pick up
 * `prefers-color-scheme`/`data-theme` changes on its own the way CSS does.
 */
@Component({
  selector: 'app-chart',
  templateUrl: './chart.html',
  styleUrl: './chart.scss'
})
export class Chart {
  private readonly theme = inject(ThemeService);
  private readonly destroyRef = inject(DestroyRef);

  readonly kind = input.required<ChartKind>();
  readonly labels = input.required<readonly string[]>();
  readonly datasets = input.required<readonly ChartDataset[]>();
  /** Formats a raw value for the tooltip/axis — usually a MoneyPipe-style formatter. */
  readonly formatValue = input<(value: number) => string>((value) => String(value));

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private instance: ChartJs | undefined;

  constructor() {
    afterNextRender(() => {
      this.instance = new ChartJs(this.canvas().nativeElement, {
        type: this.kind(),
        data: this.buildData(),
        options: this.buildOptions()
      });
    });

    // Re-theme on toggle: rebuild the color-dependent parts of the config
    // and let Chart.js re-render with them.
    effect(() => {
      this.theme.current();
      if (!this.instance) return;
      this.instance.data = this.buildData();
      this.instance.options = this.buildOptions();
      this.instance.update();
    });

    this.destroyRef.onDestroy(() => this.instance?.destroy());
  }

  private themeColors() {
    const styles = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
    return {
      grid: read('--border', '#dedcd6'),
      text: read('--content-muted', '#6b6a63'),
      tooltipBg: read('--surface-raised', '#ffffff'),
      tooltipText: read('--content-primary', '#17171a'),
      surface: read('--surface-raised', '#ffffff')
    };
  }

  private buildData(): ChartData {
    const kind = this.kind();
    const colors = this.themeColors();

    return {
      labels: [...this.labels()],
      datasets: this.datasets().map((dataset) => {
        if (kind === 'doughnut') {
          return {
            label: dataset.label,
            data: dataset.data,
            backgroundColor: dataset.colors ?? [dataset.color ?? colors.text],
            borderColor: colors.surface,
            borderWidth: 2
          };
        }
        if (kind === 'line') {
          return {
            label: dataset.label,
            data: dataset.data,
            borderColor: dataset.color,
            backgroundColor: dataset.color,
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: dataset.color,
            pointBorderColor: colors.surface,
            pointBorderWidth: 2,
            tension: 0.25,
            fill: false
          };
        }
        return {
          label: dataset.label,
          data: dataset.data,
          backgroundColor: dataset.color,
          borderRadius: 4,
          maxBarThickness: 24
        };
      })
    };
  }

  private buildOptions(): ChartOptions {
    const kind = this.kind();
    const colors = this.themeColors();
    const formatValue = this.formatValue();
    const showLegend = kind === 'doughnut' || this.datasets().length > 1;

    return {
      responsive: true,
      maintainAspectRatio: false,
      // Chart.js drives its own rAF loop for animation/resize — none of
      // that needs Angular change detection, so no zone/signal wiring here.
      animation: { duration: 200 },
      plugins: {
        legend: {
          display: showLegend,
          position: 'bottom',
          labels: { color: colors.text, usePointStyle: true, boxWidth: 8 }
        },
        tooltip: {
          backgroundColor: colors.tooltipBg,
          titleColor: colors.tooltipText,
          bodyColor: colors.tooltipText,
          borderColor: colors.grid,
          borderWidth: 1,
          padding: 8,
          callbacks: {
            // `context.parsed` is a plain number for doughnut/pie but a
            // {x, y} point for bar/line — its Chart.js type is a big union
            // keyed by chart kind, which a chart-kind-agnostic options
            // builder like this one can't narrow statically, hence the cast.
            label: (context) => {
              const parsed = context.parsed as unknown;
              const value = typeof parsed === 'number' ? parsed : ((parsed as { y?: number })?.y ?? 0);
              return `${context.dataset.label}: ${formatValue(value)}`;
            }
          }
        }
      },
      scales:
        kind === 'doughnut'
          ? undefined
          : {
              x: {
                grid: { display: false },
                border: { color: colors.grid },
                ticks: { color: colors.text }
              },
              y: {
                grid: { color: colors.grid },
                border: { display: false },
                ticks: { color: colors.text, callback: (value) => formatValue(Number(value)) }
              }
            }
    };
  }
}
