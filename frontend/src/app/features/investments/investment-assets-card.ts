import { Component, computed, input, output } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { InvestmentAsset, InvestmentPosition } from '../../domain/models/investment';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Badge } from '../../shared/ui/badge/badge';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Icon } from '../../shared/ui/icon/icon';

/** t(investments.assets.title, investments.assets.empty.title, investments.assets.empty.description) */

/**
 * The wallet detail page's list of every registered asset - not just the
 * ones with an open position. Positions are derived server-side from the
 * transaction ledger (see api/v1/investments.py::_position_read), so an
 * asset with no transactions yet never appears there; this card is where
 * the user actually sees "did my asset save?" for a symbol they just added.
 */
@Component({
  selector: 'app-investment-assets-card',
  imports: [TranslocoDirective, MoneyPipe, Badge, Button, Card, EmptyState, Icon],
  templateUrl: './investment-assets-card.html',
})
export class InvestmentAssetsCard {
  readonly assets = input.required<InvestmentAsset[]>();
  readonly positions = input.required<InvestmentPosition[]>();

  readonly create = output<void>();
  readonly edit = output<InvestmentAsset>();
  readonly archiveToggle = output<InvestmentAsset>();

  /** Active assets first, each newest-added last within its group. */
  protected readonly sortedAssets = computed(() =>
    [...this.assets()].sort((a, b) => Number(a.archived) - Number(b.archived)),
  );

  protected positionFor(asset: InvestmentAsset): InvestmentPosition | undefined {
    return this.positions().find((position) => position.asset.id === asset.id);
  }
}
