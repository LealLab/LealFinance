import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { ConfirmService } from '../../core/confirm.service';
import { IdentityApiService } from '../../core/identity-api.service';
import { CreatedInvitation, Invitation, User, UserRole } from '../../core/identity.models';
import { SessionService } from '../../core/session.service';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { PageHeader } from '../../shared/ui/page-header/page-header';

/**
 * The literal keys passed to `confirmService.confirm(...)` below are real
 * string literals, but the call itself isn't to the `t` marker function,
 * so transloco-keys-manager's extractor never sees them - same "dynamic
 * markings" situation as categories.ts:
 * t(admin.users.roleChange.title, admin.users.roleChange.promote, admin.users.roleChange.demote)
 */
@Component({
  selector: 'app-users-admin',
  imports: [FormsModule, TranslocoDirective, Button, Card, PageHeader],
  templateUrl: './users-admin.html',
  styleUrl: './users-admin.scss',
})
export class UsersAdmin {
  private readonly api = inject(IdentityApiService);
  private readonly session = inject(SessionService);
  private readonly confirmService = inject(ConfirmService);
  protected readonly users = signal<User[]>([]);
  protected readonly invitations = signal<Invitation[]>([]);
  protected readonly issued = signal<CreatedInvitation | undefined>(undefined);
  protected readonly inviteEmail = signal('');
  protected readonly inviteRole = signal<UserRole>('member');
  protected readonly busy = signal(false);
  protected readonly errorCode = signal<string | undefined>(undefined);

  // Snapshot of each user's persisted role, since [(ngModel)]="user.role"
  // mutates the row in place and leaves nothing to diff a save against.
  private readonly savedRoles = signal(new Map<string, UserRole>());

  private readonly activeAdminCount = computed(
    () => this.users().filter((user) => user.role === 'admin' && user.isActive).length,
  );

  constructor() {
    void this.reload();
  }

  protected isSelf(user: User): boolean {
    return user.id === this.session.user()?.id;
  }

  protected isPeerAdmin(user: User): boolean {
    return user.role === 'admin' && !this.isSelf(user);
  }

  protected isLastAdmin(user: User): boolean {
    return (
      this.isSelf(user) && user.role === 'admin' && user.isActive && this.activeAdminCount() === 1
    );
  }

  protected privilegeLocked(user: User): boolean {
    return this.isPeerAdmin(user) || this.isLastAdmin(user);
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
      this.savedRoles.set(new Map(users.map((user) => [user.id, user.role])));
    } catch (error) {
      this.setError(error);
    }
  }

  protected async saveUser(user: User): Promise<void> {
    const savedRole = this.savedRoles().get(user.id);
    if (savedRole && user.role !== savedRole) {
      const confirmed = await this.confirmService.confirm(
        'admin.users.roleChange.title',
        user.role === 'admin' ? 'admin.users.roleChange.promote' : 'admin.users.roleChange.demote',
        'danger',
        { name: user.displayName || user.email },
      );
      if (!confirmed) {
        user.role = savedRole;
        return;
      }
    }

    try {
      const saved = await firstValueFrom(
        this.api.updateUser(user.id, {
          displayName: user.displayName,
          role: user.role,
          isActive: user.isActive,
        }),
      );
      this.users.update((rows) => rows.map((row) => (row.id === saved.id ? saved : row)));
      this.savedRoles.update((roles) => new Map(roles).set(saved.id, saved.role));
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
