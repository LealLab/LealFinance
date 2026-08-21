import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { AgentProviderRepository } from '../../data/agent-provider.repository';
import { AgentProviderStatus } from '../../domain/models/agent-provider';
import { Button } from '../../shared/ui/button/button';
import { Modal } from '../../shared/ui/modal/modal';

type LinkMode = 'api_key' | 'oauth';

/** t(providers.form.apiKeyTitle, providers.form.oauthTitle, providers.form.ollamaTitle, providers.form.saveError, providers.form.oauth.startError, providers.form.oauth.completeError, providers.form.oauth.pasteHint, providers.form.oauth.pasteHintOpenai) */

/**
 * Handles both link modes a provider can support: a plain api_key form
 * (also covers Ollama's base_url-only case), and the two-step OAuth paste
 * flow described in docs/ai-agents.md - there's no server-side session for
 * that handshake, so the verifier/state from `startOAuth` round-trip
 * through this component's own state, not a store.
 */
@Component({
  selector: 'app-provider-link-modal',
  imports: [ReactiveFormsModule, TranslocoDirective, Button, Modal],
  templateUrl: './provider-link-modal.html',
  styleUrl: './provider-link-modal.scss',
})
export class ProviderLinkModal {
  private readonly repository = inject(AgentProviderRepository);
  private readonly fb = inject(FormBuilder);

  readonly open = model.required<boolean>();
  readonly provider = input.required<AgentProviderStatus>();
  readonly linked = output<AgentProviderStatus>();

  protected readonly isOllama = computed(() => this.provider().provider === 'ollama');
  protected readonly supportsOAuth = computed(() => this.provider().authModes.includes('oauth'));
  protected readonly mode = signal<LinkMode>('api_key');
  protected readonly oauthStep = signal<'start' | 'paste'>('start');
  protected readonly saving = signal(false);
  protected readonly errorKey = signal<string | undefined>(undefined);

  protected readonly pasteHintKey = computed(() =>
    this.provider().provider === 'openai'
      ? 'providers.form.oauth.pasteHintOpenai'
      : 'providers.form.oauth.pasteHint',
  );

  protected readonly titleKey = computed(() =>
    this.isOllama()
      ? 'providers.form.ollamaTitle'
      : this.mode() === 'oauth'
        ? 'providers.form.oauthTitle'
        : 'providers.form.apiKeyTitle',
  );

  protected readonly apiKeyForm = this.fb.nonNullable.group({
    apiKey: ['', Validators.required],
    baseUrl: [''],
    model: [''],
  });

  private authorizeUrl = '';
  private verifier = '';
  private state = '';
  protected readonly oauthCode = signal('');

  constructor() {
    effect(() => {
      if (!this.open()) return;
      this.mode.set('api_key');
      this.oauthStep.set('start');
      this.oauthCode.set('');
      this.errorKey.set(undefined);
      this.apiKeyForm.reset({ apiKey: '', baseUrl: '', model: this.provider().model ?? '' });
      // Ollama has no api_key field (its template branch only shows
      // baseUrl); the reverse for every other provider - toggle which
      // control is actually required so the hidden one can't block submit.
      const ollama = this.isOllama();
      this.apiKeyForm.controls.apiKey.setValidators(ollama ? [] : [Validators.required]);
      this.apiKeyForm.controls.baseUrl.setValidators(ollama ? [Validators.required] : []);
      this.apiKeyForm.controls.apiKey.updateValueAndValidity();
      this.apiKeyForm.controls.baseUrl.updateValueAndValidity();
    });
  }

  protected setMode(mode: LinkMode): void {
    this.mode.set(mode);
    this.errorKey.set(undefined);
  }

  protected submitApiKey(): void {
    if (this.apiKeyForm.invalid) {
      this.apiKeyForm.markAllAsTouched();
      return;
    }
    const raw = this.apiKeyForm.getRawValue();
    this.saving.set(true);
    this.repository
      .link(this.provider().provider, {
        apiKey: this.isOllama() ? undefined : raw.apiKey,
        baseUrl: this.isOllama() ? raw.baseUrl : undefined,
        model: raw.model || undefined,
      })
      .subscribe({
        next: (status) => {
          this.saving.set(false);
          this.open.set(false);
          this.linked.emit(status);
        },
        error: () => {
          this.saving.set(false);
          this.errorKey.set('providers.form.saveError');
        },
      });
  }

  protected startOAuth(): void {
    this.saving.set(true);
    this.repository.startOAuth(this.provider().provider).subscribe({
      next: (start) => {
        this.saving.set(false);
        this.authorizeUrl = start.authorizeUrl;
        this.verifier = start.verifier;
        this.state = start.state;
        this.oauthStep.set('paste');
        window.open(start.authorizeUrl, '_blank', 'noopener');
      },
      error: () => {
        this.saving.set(false);
        this.errorKey.set('providers.form.oauth.startError');
      },
    });
  }

  protected reopenAuthorizeUrl(): void {
    if (this.authorizeUrl) window.open(this.authorizeUrl, '_blank', 'noopener');
  }

  protected completeOAuth(): void {
    const code = this.oauthCode().trim();
    if (!code) return;
    this.saving.set(true);
    this.repository
      .completeOAuth(this.provider().provider, { verifier: this.verifier, state: this.state, code })
      .subscribe({
        next: (status) => {
          this.saving.set(false);
          this.open.set(false);
          this.linked.emit(status);
        },
        error: () => {
          this.saving.set(false);
          this.errorKey.set('providers.form.oauth.completeError');
        },
      });
  }
}
