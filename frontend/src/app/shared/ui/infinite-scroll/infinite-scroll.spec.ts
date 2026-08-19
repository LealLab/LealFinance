import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { InfiniteScroll } from './infinite-scroll';

@Component({
  selector: 'app-host',
  imports: [InfiniteScroll],
  template: `<div appInfiniteScroll (visible)="onVisible()"></div>`
})
class Host {
  visibleCount = 0;
  onVisible(): void {
    this.visibleCount++;
  }
}

describe('InfiniteScroll', () => {
  let observerCallback: IntersectionObserverCallback | undefined;
  let observeSpy: ReturnType<typeof vi.fn>;
  let disconnectSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    observeSpy = vi.fn();
    disconnectSpy = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          observerCallback = callback;
        }
        observe = observeSpy;
        disconnect = disconnectSpy;
        unobserve = vi.fn();
      }
    );

    TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideZonelessChangeDetection()]
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('observes its host element on init', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    expect(observeSpy).toHaveBeenCalledTimes(1);
  });

  it('emits visible when the host element intersects', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    observerCallback!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);

    expect(fixture.componentInstance.visibleCount).toBe(1);
  });

  it('does not emit when not intersecting', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    observerCallback!([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);

    expect(fixture.componentInstance.visibleCount).toBe(0);
  });

  it('disconnects the observer on destroy', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    fixture.destroy();

    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });
});
