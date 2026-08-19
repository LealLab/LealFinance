import { Directive, ElementRef, inject, OnDestroy, OnInit, output } from '@angular/core';

/**
 * Emits `(visible)` once whenever the host element enters the viewport -
 * intended for a sentinel `<div>` placed after a paginated list, so the
 * consuming component can load the next page. No debouncing/throttling:
 * the consumer's own "already loading" / "exhausted" guards are what stop
 * repeat fetches, not this directive.
 */
@Directive({
  selector: '[appInfiniteScroll]'
})
export class InfiniteScroll implements OnInit, OnDestroy {
  private readonly element = inject(ElementRef<HTMLElement>);
  readonly visible = output<void>();

  private observer?: IntersectionObserver;

  ngOnInit(): void {
    this.observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) this.visible.emit();
    });
    this.observer.observe(this.element.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
