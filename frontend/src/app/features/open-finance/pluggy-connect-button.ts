import { Component, inject, input, output, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { OpenFinanceRepository } from '../../data/open-finance.repository';
import { PluggyEnvironment } from '../../domain/models/open-finance';
import { Button } from '../../shared/ui/button/button';
import { Icon } from '../../shared/ui/icon/icon';

const PLUGGY_SCRIPT_URL = 'https://cdn.pluggy.ai/pluggy-connect.js';

interface PluggyItemData {
  item?: { id?: string };
}

interface PluggyConnectOptions {
  connectToken: string;
  includeSandbox: boolean;
  onSuccess: (itemData: PluggyItemData) => void;
  onError: (error: unknown) => void;
  onClose: () => void;
}

interface PluggyConnectWidget {
  init(): void;
}

type PluggyConnectConstructor = new (options: PluggyConnectOptions) => PluggyConnectWidget;

declare global {
  interface Window {
    PluggyConnect?: PluggyConnectConstructor;
  }
}

/** t(openFinance.actions.connect, openFinance.connect.loading, openFinance.connect.scriptError, openFinance.connect.error) */
@Component({
  selector: 'app-pluggy-connect-button',
  imports: [TranslocoDirective, Button, Icon],
  templateUrl: './pluggy-connect-button.html',
  styleUrl: './pluggy-connect-button.scss',
})
export class PluggyConnectButton {
  private readonly repository = inject(OpenFinanceRepository);

  readonly environment = input.required<PluggyEnvironment>();
  readonly connected = output<void>();

  protected readonly busy = signal(false);
  protected readonly errorKey = signal<string | undefined>(undefined);
  private scriptPromise?: Promise<void>;

  protected connect(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.errorKey.set(undefined);
    this.loadScript()
      .then(() => this.repository.createConnectToken().subscribe({
        next: (token) => this.openWidget(token.accessToken),
        error: () => this.fail('openFinance.connect.error'),
      }))
      .catch(() => this.fail('openFinance.connect.scriptError'));
  }

  private loadScript(): Promise<void> {
    if (this.scriptPromise) return this.scriptPromise;

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PLUGGY_SCRIPT_URL}"]`);
    if (existing && window.PluggyConnect) return Promise.resolve();

    this.scriptPromise = new Promise<void>((resolve, reject) => {
      const script = existing ?? document.createElement('script');
      const onLoad = () => (window.PluggyConnect ? resolve() : reject(new Error('Pluggy widget unavailable')));
      script.addEventListener('load', onLoad, { once: true });
      script.addEventListener('error', () => reject(new Error('Pluggy widget failed to load')), {
        once: true,
      });
      if (!existing) {
        script.src = PLUGGY_SCRIPT_URL;
        script.async = true;
        document.head.appendChild(script);
      }
    });
    return this.scriptPromise;
  }

  private openWidget(connectToken: string): void {
    if (!window.PluggyConnect) {
      this.fail('openFinance.connect.scriptError');
      return;
    }
    try {
      new window.PluggyConnect({
        connectToken,
        includeSandbox: this.environment() === 'sandbox',
        onSuccess: (itemData) => this.registerItem(itemData),
        onError: () => this.fail('openFinance.connect.error'),
        onClose: () => this.busy.set(false),
      }).init();
    } catch {
      this.fail('openFinance.connect.error');
    }
  }

  private registerItem(itemData: PluggyItemData): void {
    const externalId = itemData.item?.id;
    if (!externalId) {
      this.fail('openFinance.connect.error');
      return;
    }
    this.repository.registerItem(externalId).subscribe({
      next: () => {
        this.busy.set(false);
        this.connected.emit();
      },
      error: () => this.fail('openFinance.connect.error'),
    });
  }

  private fail(key: string): void {
    this.busy.set(false);
    this.errorKey.set(key);
  }
}
