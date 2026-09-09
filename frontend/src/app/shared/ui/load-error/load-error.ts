import { Component, input, output } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { Button } from '../button/button';

@Component({
  selector: 'app-load-error',
  imports: [TranslocoDirective, Button],
  templateUrl: './load-error.html',
  styleUrl: './load-error.scss',
})
export class LoadError {
  readonly messageKey = input('common.loadError');
  readonly retry = output<void>();
  readonly retrying = input(false);
}
