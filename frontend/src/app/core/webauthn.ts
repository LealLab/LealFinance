export type PublicKeyCredentialCreationOptionsJSON = Omit<
  PublicKeyCredentialCreationOptions,
  'challenge' | 'user' | 'excludeCredentials'
> & {
  challenge: string;
  user: Omit<PublicKeyCredentialUserEntity, 'id'> & { id: string };
  excludeCredentials?: (Omit<PublicKeyCredentialDescriptor, 'id'> & { id: string })[];
};

export type PublicKeyCredentialRequestOptionsJSON = Omit<
  PublicKeyCredentialRequestOptions,
  'challenge' | 'allowCredentials'
> & {
  challenge: string;
  allowCredentials?: (Omit<PublicKeyCredentialDescriptor, 'id'> & { id: string })[];
};

export interface PublicKeyCredentialJSON {
  id: string;
  rawId: string;
  type: string;
  response:
    | {
        clientDataJSON: string;
        attestationObject: string;
        transports: string[];
      }
    | {
        clientDataJSON: string;
        authenticatorData: string;
        signature: string;
        userHandle: string | null;
      };
  clientExtensionResults: AuthenticationExtensionsClientOutputs;
}

export function base64urlToBuffer(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = globalThis.atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

export function bufferToBase64url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.PublicKeyCredential &&
    window.isSecureContext
  );
}

export async function requestPasskeyRegistration(
  options: PublicKeyCredentialCreationOptionsJSON,
): Promise<PublicKeyCredentialJSON> {
  const publicKey: PublicKeyCredentialCreationOptions = {
    ...options,
    challenge: base64urlToBuffer(options.challenge),
    user: { ...options.user, id: base64urlToBuffer(options.user.id) },
    excludeCredentials: options.excludeCredentials?.map((credential) => ({
      ...credential,
      id: base64urlToBuffer(credential.id),
    })),
  };
  const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential;
  const resp = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: bufferToBase64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufferToBase64url(resp.clientDataJSON),
      attestationObject: bufferToBase64url(resp.attestationObject),
      transports: resp.getTransports?.() ?? [],
    },
    clientExtensionResults: cred.getClientExtensionResults(),
  };
}

export async function requestPasskeyAssertion(
  options: PublicKeyCredentialRequestOptionsJSON,
): Promise<PublicKeyCredentialJSON> {
  const publicKey: PublicKeyCredentialRequestOptions = {
    ...options,
    challenge: base64urlToBuffer(options.challenge),
    allowCredentials: options.allowCredentials?.map((credential) => ({
      ...credential,
      id: base64urlToBuffer(credential.id),
    })),
  };
  const cred = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential;
  const resp = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: bufferToBase64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufferToBase64url(resp.clientDataJSON),
      authenticatorData: bufferToBase64url(resp.authenticatorData),
      signature: bufferToBase64url(resp.signature),
      userHandle: resp.userHandle ? bufferToBase64url(resp.userHandle) : null,
    },
    clientExtensionResults: cred.getClientExtensionResults(),
  };
}

export function isPasskeyCancellation(err: unknown): boolean {
  return (
    typeof DOMException !== 'undefined' &&
    err instanceof DOMException &&
    (err.name === 'NotAllowedError' || err.name === 'AbortError')
  );
}
