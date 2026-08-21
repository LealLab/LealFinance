import { Component, signal } from '@angular/core';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Chart as ChartJs } from 'chart.js';
import { Chart, ChartDataset } from './chart';

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  return new Proxy({ canvas } as unknown as CanvasRenderingContext2D, {
    get(target, property, receiver) {
      if (property === 'measureText') return () => ({ width: 0 });
      if (property in target) return Reflect.get(target, property, receiver);
      return () => undefined;
    }
  });
}

class NoopResizeObserver {
  observe(): void {
    return;
  }
  unobserve(): void {
    return;
  }
  disconnect(): void {
    return;
  }
}

@Component({
  imports: [Chart],
  template: '<app-chart kind="bar" [labels]="labels()" [datasets]="datasets()" />'
})
class Host {
  readonly labels = signal(['Jan']);
  readonly datasets = signal<ChartDataset[]>([
    { label: 'Income', data: [10], color: '#3e7d4c' }
  ]);
}

describe('Chart', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    vi.stubGlobal('ResizeObserver', NoopResizeObserver);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      return canvasContext(this) as CanvasRenderingContext2D;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('updates the Chart.js instance when async inputs change', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const canvas = fixture.nativeElement.querySelector('canvas') as HTMLCanvasElement;
    const chart = ChartJs.getChart(canvas);
    expect(chart?.data.datasets[0].data).toEqual([10]);

    fixture.componentInstance.datasets.set([
      { label: 'Income', data: [25], color: '#3e7d4c' }
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(ChartJs.getChart(canvas)?.data.datasets[0].data).toEqual([25]);
  });
});
