/**
 * AES-GCM symmetric encryption for connector secrets at the Next API layer.
 * Uses VAULT_MASTER_KEY (PBKDF2 SHA-256, 200k iters) so the backend Python
 * vault and the frontend route can both encrypt/decrypt the same payloads.
 */

const TEXT_ENCODER = new TextEncoder()
const TEXT_DECODER = new TextDecoder()
const SALT = TEXT_ENCODER.encode('tender-agent-vault-v1')
const ITERATIONS = 200_000

async function deriveKey(): Promise<CryptoKey> {
  const master = process.env.VAULT_MASTER_KEY
  if (!master) throw new Error('VAULT_MASTER_KEY not set')
  const baseKey = await crypto.subtle.importKey(
    'raw',
    TEXT_ENCODER.encode(master),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: SALT, iterations: ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

function bufToB64(buf: ArrayBuffer | Uint8Array): string {
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ''
  arr.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin)
}

function b64ToBuf(s: string): ArrayBuffer {
  const bin = atob(s)
  const buf = new ArrayBuffer(bin.length)
  const arr = new Uint8Array(buf)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return buf
}

export async function encryptString(plain: string): Promise<string> {
  const key = await deriveKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    TEXT_ENCODER.encode(plain),
  )
  return `${bufToB64(iv)}.${bufToB64(cipher)}`
}

export async function decryptString(blob: string): Promise<string> {
  const [ivB64, cipherB64] = blob.split('.')
  if (!ivB64 || !cipherB64) throw new Error('bad ciphertext')
  const key = await deriveKey()
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBuf(ivB64) },
    key,
    b64ToBuf(cipherB64),
  )
  return TEXT_DECODER.decode(plain)
}
