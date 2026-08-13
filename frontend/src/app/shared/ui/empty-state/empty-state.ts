import { Component, input } from '@angular/core';
import { IconName, Icon } from '../icon/icon';

/**
 * Shown wherever a list has nothing in it — no accounts yet, a filter
 * matched nothing, etc. An empty screen is an invitation to act, so this
 * always pairs a plain-language explanation with room for an action via
 * the projected content (a `<button appButton>` in most call sites).
 */
@Component({
  selector: 'app-empty-state',
  imports: [Icon],
  templateUrl: './empty-state.html',
  styleUrl: './empty-state.scss'
})
export class EmptyState {
  readonly icon = input<IconName>('archive');
  readonly title = input.required<string>();
  readonly description = input<string>();
}
