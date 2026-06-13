/**
 * Self-hosted Web Push — zero dependencies.
 *
 * Implements:
 *  - RFC 8291  (Message Encryption for Web Push, aes128gcm)
 *  - RFC 8292  (VAPID — Voluntary Application Server Identification)
 *  - RFC 8188  (Encrypted Content-Encoding for HTTP)
 *
 * Uses only Node's built-in `crypto` and global `fetch`.
 * No third-party push service account is required — VAPID keys are
 * generated once and owned by this server.
 */

import {
  createECDH,
  createCipheriv,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign as cryptoSign,
} from 'crypto';

export interface VapidKeys {
  /** base64url — uncompressed P-256 point (65 bytes) */
  publicKey: string;
  /** base64url — 32-byte private scalar */
  privateKey: string;
  /** mailto: or https: contact */
  subject: string;
}

export interface WebPushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface WebPushResult {
  statusCode: number;
  /** true when subscription is dead and must be removed (404/410) */
  expired: boolean;
}

const b64u = (buf: Buffer): string => buf.toString('base64url');

/** Builds a JWK private key object from raw VAPID base64url keys */
function vapidPrivateKeyObject(vapid: VapidKeys) {
  const pub = Buffer.from(vapid.publicKey, 'base64url'); // 0x04 || x || y
  return createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: b64u(pub.subarray(1, 33)),
      y: b64u(pub.subarray(33, 65)),
      d: vapid.privateKey,
    },
    format: 'jwk',
  });
}

/** RFC 8292 — builds the `Authorization: vapid t=...,k=...` header value */
function buildVapidAuthHeader(endpoint: string, vapid: VapidKeys): string {
  const { origin } = new URL(endpoint);
  const header = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64u(
    Buffer.from(
      JSON.stringify({
        aud: origin,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, // 12h
        sub: vapid.subject,
      }),
    ),
  );
  const unsigned = `${header}.${payload}`;
  const signature = cryptoSign('sha256', Buffer.from(unsigned), {
    key: vapidPrivateKeyObject(vapid),
    dsaEncoding: 'ieee-p1363', // raw r||s (64 bytes) as JWT ES256 requires
  });
  return `vapid t=${unsigned}.${b64u(signature)}, k=${vapid.publicKey}`;
}

/** RFC 8291 — encrypts the payload with aes128gcm for the given subscription */
function encryptPayload(subscription: WebPushSubscription, payload: Buffer): Buffer {
  const uaPublic = Buffer.from(subscription.keys.p256dh, 'base64url'); // 65 bytes
  const authSecret = Buffer.from(subscription.keys.auth, 'base64url'); // 16 bytes

  // Ephemeral application-server ECDH keypair
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey(); // uncompressed, 65 bytes
  const ecdhSecret = ecdh.computeSecret(uaPublic);

  // IKM = HKDF(salt=auth_secret, IKM=ecdh_secret, info="WebPush: info"||0x00||ua_pub||as_pub, 32)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', ecdhSecret, authSecret, keyInfo, 32));

  const salt = randomBytes(16);
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  // Single record: payload || 0x02 (last-record delimiter)
  const plaintext = Buffer.concat([payload, Buffer.from([2])]);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  // RFC 8188 header: salt(16) || rs(4) || idlen(1) || keyid(=as_public, 65)
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096);
  return Buffer.concat([salt, recordSize, Buffer.from([asPublic.length]), asPublic, ciphertext]);
}

/**
 * Sends one push message. Never throws on HTTP-level failure —
 * returns the status code so callers can prune dead subscriptions.
 */
export async function sendWebPush(
  subscription: WebPushSubscription,
  payload: string,
  vapid: VapidKeys,
  ttlSeconds = 24 * 60 * 60,
): Promise<WebPushResult> {
  const body = encryptPayload(subscription, Buffer.from(payload, 'utf8'));

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(body.length),
      TTL: String(ttlSeconds),
      Urgency: 'high',
      Authorization: buildVapidAuthHeader(subscription.endpoint, vapid),
    },
    body: new Uint8Array(body),
  });

  // Drain body so the socket is released
  await res.arrayBuffer().catch(() => undefined);

  return {
    statusCode: res.status,
    expired: res.status === 404 || res.status === 410,
  };
}
