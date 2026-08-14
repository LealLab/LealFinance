import { Component, input } from '@angular/core';

/**
 * The LealFinance brand mark, inlined rather than referenced via
 * `<img src="logo.svg">`. This matters for the second (unfilled) path,
 * which is drawn with `fill="currentColor"` so it stays visible against
 * both the light and dark surface tokens: an externally-referenced SVG
 * resource (via `<img>` or a CSS `background-image`) renders in its own
 * isolated document and does not inherit `color` from the embedding page,
 * so `currentColor` there would resolve to the SVG's own initial value
 * (black) - invisible again on dark backgrounds, defeating the point.
 * Inlining the markup, the same way `Icon` (../icon/icon.ts) inlines its
 * `stroke="currentColor"` paths, lets `currentColor` resolve against this
 * component's own computed `color`, which normal CSS (`text-*` utilities)
 * controls. `public/logo.svg` still exists as the standalone brand asset
 * (documented in the sidebar/command-palette spec) - this component keeps
 * its two paths in sync with that file by hand since there's no build step
 * that inlines external SVGs here.
 */
@Component({
  selector: 'app-logo',
  templateUrl: './logo.html',
  styleUrl: './logo.scss'
})
export class Logo {
  readonly size = input(28);
}
