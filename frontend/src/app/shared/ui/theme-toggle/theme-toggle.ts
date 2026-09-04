import { Component, inject } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { PreferenceService } from '../../../core/preference.service';
import { ThemeService } from '../../../core/theme.service';
import { Button } from '../button/button';
import { Icon } from '../icon/icon';

/**
 * Light/dark toggle button. Reads `ThemeService` directly (so it reflects
 * mid-flight changes immediately) but writes through `PreferenceService`,
 * which also works while logged out - see preference.service.ts.
 */
@Component({
  selector: 'app-theme-toggle',
  imports: [TranslocoDirective, Icon, Button],
  templateUrl: './theme-toggle.html',
})
export class ThemeToggle {
  protected readonly theme = inject(ThemeService);
  private readonly preferences = inject(PreferenceService);

  protected toggle(): void {
    this.preferences.setTheme(this.theme.current() === 'dark' ? 'light' : 'dark');
  }
}
