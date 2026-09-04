import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ConfirmService } from '../../core/confirm.service';
import { IdentityApiService } from '../../core/identity-api.service';
import { Passkey } from '../../core/identity.models';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';
import { PasskeysSection } from './passkeys-section';

describe('PasskeysSection', () => {
  const passkey: Passkey = {
    id: 'p1',
    name: 'Personal laptop',
    createdAt: '2026-09-01T12:00:00Z',
  };
  let identityApi: {
    listPasskeys: ReturnType<typeof vi.fn>;
    passkeyRegisterOptions: ReturnType<typeof vi.fn>;
    registerPasskey: ReturnType<typeof vi.fn>;
    deletePasskey: ReturnType<typeof vi.fn>;
  };
  let confirm: { confirm: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    Object.defineProperty(window, 'PublicKeyCredential', {
      configurable: true,
      value: class PublicKeyCredential {},
    });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    identityApi = {
      listPasskeys: vi.fn().mockReturnValue(of([passkey])),
      passkeyRegisterOptions: vi.fn().mockReturnValue(
        of({
          challenge: 'Y2hhbGxlbmdl',
          rp: { name: 'LealFinance' },
          user: { id: 'user', name: 'user@example.com', displayName: 'User' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        }),
      ),
      registerPasskey: vi.fn().mockReturnValue(of(passkey)),
      deletePasskey: vi.fn().mockReturnValue(of(undefined)),
    };
    confirm = { confirm: vi.fn().mockResolvedValue(true) };
    await TestBed.configureTestingModule({
      imports: [PasskeysSection, provideTestTransloco()],
      providers: [
        provideZonelessChangeDetection(),
        provideTestTranslocoLocale(),
        { provide: IdentityApiService, useValue: identityApi },
        { provide: ConfirmService, useValue: confirm },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    Object.defineProperty(window, 'PublicKeyCredential', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
  });

  it('loads and renders enrolled passkeys', () => {
    const fixture = TestBed.createComponent(PasskeysSection);
    fixture.detectChanges();

    expect(identityApi.listPasskeys).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Personal laptop');
    expect(fixture.nativeElement.textContent).toContain('Adicionada');
  });

  it('creates a passkey and reloads the list', async () => {
    const fixture = TestBed.createComponent(PasskeysSection);
    fixture.detectChanges();
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const originalCredentials = navigator.credentials;
    const create = vi.fn().mockResolvedValue({
      id: 'credential',
      rawId: bytes,
      type: 'public-key',
      response: {
        clientDataJSON: bytes,
        attestationObject: bytes,
        getTransports: () => [],
      },
      getClientExtensionResults: () => ({}),
    });
    Object.defineProperty(window.navigator, 'credentials', {
      configurable: true,
      value: {
        create,
      },
    });
    fixture.componentInstance['startAdding']();
    fixture.componentInstance['newName'].set(' Office laptop ');
    await fixture.componentInstance['createPasskey']();
    Object.defineProperty(window.navigator, 'credentials', {
      configurable: true,
      value: originalCredentials,
    });

    expect(identityApi.passkeyRegisterOptions).toHaveBeenCalled();
    expect(identityApi.registerPasskey).toHaveBeenCalledWith(
      'Office laptop',
      'Y2hhbGxlbmdl',
      expect.objectContaining({ id: 'credential', type: 'public-key' }),
    );
    expect(identityApi.listPasskeys).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance['adding']()).toBe(false);
  });

  it('confirms before deleting a passkey', async () => {
    const fixture = TestBed.createComponent(PasskeysSection);
    fixture.detectChanges();
    await fixture.componentInstance['removePasskey'](passkey);

    expect(confirm.confirm).toHaveBeenCalledWith(
      'settings.passkeys.removeConfirm.title',
      'settings.passkeys.removeConfirm.message',
      'danger',
    );
    expect(identityApi.deletePasskey).toHaveBeenCalledWith('p1');
  });

  it('explains when passkeys are unsupported', () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    const fixture = TestBed.createComponent(PasskeysSection);
    fixture.detectChanges();

    expect(identityApi.listPasskeys).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('conexão segura');
  });
});
