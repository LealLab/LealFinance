import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { IdentityApiService } from '../../core/identity-api.service';
import { CreatedInvitation, Invitation, User, UserRole } from '../../core/identity.models';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { PageHeader } from '../../shared/ui/page-header/page-header';

@Component({
  selector: 'app-users-admin',
  imports: [FormsModule, TranslocoDirective, Button, Card, PageHeader],
  templateUrl: './users-admin.html',
  styleUrl: './users-admin.scss',
})
export class UsersAdmin {
  private readonly api = inject(IdentityApiService);
  protected readonly users = signal<User[]>([]);
  protected readonly invitations = signal<Invitation[]>([]);
  protected readonly issued = signal<CreatedInvitation | undefined>(undefined);
  protected readonly inviteEmail = signal('');
  protected readonly inviteRole = signal<UserRole>('member');
  protected readonly busy = signal(false);
  protected readonly errorCode = signal<string | undefined>(undefined);

  constructor() {
    void this.reload();
  }

  protected async reload(): Promise<void> {
    this.errorCode.set(undefined);
    try {
      const [users, invitations] = await Promise.all([
        firstValueFrom(this.api.listUsers()),
        firstValueFrom(this.api.listInvitations()),
      ]);
      this.users.set(users);
      this.invitations.set(invitations);
    } catch (error) {
      this.setError(error);
    }
  }

  protected async saveUser(user: User): Promise<void> {
    try {
      const saved = await firstValueFrom(
        this.api.updateUser(user.id, {
          displayName: user.displayName,
          role: user.role,
          isActive: user.isActive,
        }),
      );
      this.users.update((rows) => rows.map((row) => (row.id === saved.id ? saved : row)));
    } catch (error) {
      this.setError(error);
      await this.reload();
    }
  }

  protected async createInvitation(): Promise<void> {
    if (!this.inviteEmail()) return;
    this.busy.set(true);
    try {
      const invitation = await firstValueFrom(
        this.api.createInvitation(this.inviteEmail(), this.inviteRole()),
      );
      this.issued.set(invitation);
      this.inviteEmail.set('');
      await this.reload();
    } catch (error) {
      this.setError(error);
    } finally {
      this.busy.set(false);
    }
  }

  protected async revoke(invitation: Invitation): Promise<void> {
    try {
      await firstValueFrom(this.api.revokeInvitation(invitation.id));
      await this.reload();
    } catch (error) {
      this.setError(error);
    }
  }

  protected registrationLink(invitation: CreatedInvitation): string {
    const query = new URLSearchParams({ email: invitation.email, token: invitation.token });
    return `${window.location.origin}/register?${query.toString()}`;
  }

  protected copyLink(invitation: CreatedInvitation): void {
    void navigator.clipboard?.writeText(this.registrationLink(invitation));
  }

  private setError(error: unknown): void {
    this.errorCode.set(
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'error.generic',
    );
  }
}
