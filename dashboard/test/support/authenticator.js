// A software passkey for the tests: an ES256 key pair that answers WebAuthn
// registration and sign-in challenges the way a browser and device would.
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { encodeCBOR } from '@levischuck/tiny-cbor';

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sha256 = (data) => createHash('sha256').update(data).digest();

export function authenticator({ origin, rpID = new URL(origin).hostname, userVerified = true } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credentialId = randomBytes(16);
  let counter = 0;
  const flags = (attested) => 0x01 | (userVerified ? 0x04 : 0) | (attested ? 0x40 : 0);
  const clientData = (type, challenge, from) => Buffer.from(JSON.stringify({ type, challenge, origin: from, crossOrigin: false }));
  const head = (attested) => {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(++counter);
    return Buffer.concat([sha256(rpID), Buffer.from([flags(attested)]), count]);
  };

  return {
    id: b64(credentialId),
    /** The response to the options of /api/auth/enroll/options. */
    create(options, { from = origin } = {}) {
      const cose = encodeCBOR(new Map([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))], [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))]]));
      const length = Buffer.alloc(2);
      length.writeUInt16BE(credentialId.length);
      const authData = Buffer.concat([head(true), Buffer.alloc(16), length, credentialId, Buffer.from(cose)]);
      const attestationObject = encodeCBOR(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', new Uint8Array(authData)]]));
      return {
        id: b64(credentialId), rawId: b64(credentialId), type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {},
        response: { clientDataJSON: b64(clientData('webauthn.create', options.challenge, from)), attestationObject: b64(attestationObject), transports: ['internal'] },
      };
    },
    /** The response to the options of /api/auth/login/options. */
    get(options, { from = origin } = {}) {
      const authData = head(false);
      const json = clientData('webauthn.get', options.challenge, from);
      const signature = createSign('SHA256').update(Buffer.concat([authData, sha256(json)])).sign(privateKey);
      return {
        id: b64(credentialId), rawId: b64(credentialId), type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {},
        response: { clientDataJSON: b64(json), authenticatorData: b64(authData), signature: b64(signature) },
      };
    },
  };
}
