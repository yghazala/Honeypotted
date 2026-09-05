const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, recommended for GCM

function getKey() {
  const keyB64 = process.env.SESSIONS_ENCRYPTION_KEY;
  if (!keyB64) {
    throw new Error('SESSIONS_ENCRYPTION_KEY is not set — generate one with `openssl rand -base64 32` and add it to .env');
  }
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) {
    throw new Error('SESSIONS_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256)');
  }
  return key;
}

// Encrypts a plaintext string, returning a JSON envelope { iv, authTag, data } as a string.
function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    data: encrypted.toString('base64'),
  });
}

// Decrypts a JSON envelope produced by encrypt(), returning the original plaintext string.
function decrypt(envelope) {
  const key = getKey();
  const { iv, authTag, data } = JSON.parse(envelope);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

// Distinguishes an encrypted envelope from legacy plaintext JSON (a bare array/object).
function isEncryptedEnvelope(raw) {
  try {
    const obj = JSON.parse(raw);
    return !!obj && typeof obj === 'object' && !Array.isArray(obj)
      && typeof obj.iv === 'string' && typeof obj.authTag === 'string' && typeof obj.data === 'string';
  } catch {
    return false;
  }
}

module.exports = { encrypt, decrypt, isEncryptedEnvelope };
