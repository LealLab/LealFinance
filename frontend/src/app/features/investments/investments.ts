import { Component } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';

@Component({
  selector: 'app-investments',
  imports: [TranslocoDirective, EmptyState, PageHeader],
  templateUrl: './investments.html',
  styleUrl: './investments.scss',
})
export class Investments {}
