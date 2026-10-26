import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiError } from '../../core/api-error';
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
    await TestBed.configureTestingModule({
      imports: [PasskeysSection, provideTestTransloco()],
      providers: [
        provideZonelessChangeDetection(),
        provideTestTranslocoLocale(),
        { provide: IdentityApiService, useValue: identityApi },
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
    fixture.componentInstance['createPasskey']();
    // Nothing happens until the password is confirmed.
    expect(identityApi.passkeyRegisterOptions).not.toHaveBeenCalled();
    expect(fixture.componentInstance['reauthOpen']()).toBe(true);
    await fixture.componentInstance['onPassword']('my-account-password');
    Object.defineProperty(window.navigator, 'credentials', {
      configurable: true,
      value: originalCredentials,
    });

    expect(identityApi.passkeyRegisterOptions).toHaveBeenCalledWith('my-account-password');
    expect(identityApi.registerPasskey).toHaveBeenCalledWith(
      'Office laptop',
      'Y2hhbGxlbmdl',
      expect.objectContaining({ id: 'credential', type: 'public-key' }),
      'my-account-password',
    );
    expect(fixture.componentInstance['reauthOpen']()).toBe(false);
    expect(identityApi.listPasskeys).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance['adding']()).toBe(false);
  });

  it('asks for the password before deleting a passkey, and sends it', async () => {
    const fixture = TestBed.createComponent(PasskeysSection);
    fixture.detectChanges();
    fixture.componentInstance['removePasskey'](passkey);

    expect(identityApi.deletePasskey).not.toHaveBeenCalled();
    expect(fixture.componentInstance['reauthOpen']()).toBe(true);
    expect(fixture.componentInstance['reauthTitleKey']()).toBe(
      'settings.passkeys.removeConfirm.title',
    );
    expect(fixture.componentInstance['reauthMessageKey']()).toBe(
      'settings.passkeys.removeConfirm.message',
    );

    await fixture.componentInstance['onPassword']('my-account-password');

    expect(identityApi.deletePasskey).toHaveBeenCalledWith('p1', 'my-account-password');
    expect(fixture.componentInstance['reauthOpen']()).toBe(false);
    expect(identityApi.listPasskeys).toHaveBeenCalledTimes(2);
  });

  it('keeps the dialog open and shows the error when the password is wrong', async () => {
    identityApi.deletePasskey.mockReturnValue(
      throwError(() => new ApiError(401, 'auth.invalid_credentials', {})),
    );
    const fixture = TestBed.createComponent(PasskeysSection);
    fixture.detectChanges();
    fixture.componentInstance['removePasskey'](passkey);

    await fixture.componentInstance['onPassword']('wrong');

    expect(fixture.componentInstance['reauthOpen']()).toBe(true);
    expect(fixture.componentInstance['reauthError']()).toBe('errors.auth.invalid_credentials');
    expect(fixture.componentInstance['errorCode']()).toBeUndefined();
    expect(identityApi.listPasskeys).toHaveBeenCalledTimes(1);

    identityApi.deletePasskey.mockReturnValue(
      throwError(() => new ApiError(401, 'auth.account_locked', {})),
    );
    await fixture.componentInstance['onPassword']('wrong again');
    expect(fixture.componentInstance['reauthError']()).toBe('errors.auth.account_locked');
  });

  it('closes the dialog and shows other errors on the section', async () => {
    identityApi.deletePasskey.mockReturnValue(
      throwError(() => new ApiError(404, 'webauthn.not_found', {})),
    );
    const fixture = TestBed.createComponent(PasskeysSection);
    fixture.detectChanges();
    fixture.componentInstance['removePasskey'](passkey);

    await fixture.componentInstance['onPassword']('my-account-password');

    expect(fixture.componentInstance['reauthOpen']()).toBe(false);
    expect(fixture.componentInstance['errorCode']()).toBe('webauthn.not_found');
  });

  it('does not ask for a password until a name is entered', () => {
    const fixture = TestBed.createComponent(PasskeysSection);
    fixture.detectChanges();
    fixture.componentInstance['startAdding']();

    fixture.componentInstance['createPasskey']();

    expect(fixture.componentInstance['reauthOpen']()).toBe(false);
  });

  it('explains when passkeys are unsupported', () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    const fixture = TestBed.createComponent(PasskeysSection);
    fixture.detectChanges();

    expect(identityApi.listPasskeys).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('conexão segura');
  });
});
