/**
 * create-vlb.mjs — local developer tool for wrapping a model in an encrypted VLB package.
 *
 * SECURITY NOTE:
 * This tool provides layered protection via AES-256-GCM encryption, PBKDF2 key
 * derivation, and SHA-256 integrity verification. It raises extraction difficulty
 * for packaged assets. Browser assets served via the protected delivery pipeline
 * can still be extracted by determined users with devtools access. This is
 * controlled delivery and deterrence — not an absolute barrier.
 *
 * Usage:
 *   node tools/create-vlb.mjs --input <path> --output <path> [--passphrase <phrase>]
 *
 * Passphrase can also be supplied via VLB_PASSPHRASE environment variable.
 * Never commit output .vlb files or passphrases to source control.
 *
 * Output format (VLB v2 — encrypted):
 *   [0..3]   Magic:     0x56 0x4C 0x42 0x00  ('VLB\0')
 *   [4..7]   Version:   2  (uint32 LE)
 *   [8..11]  Flags:     1  (bit 0 = encrypted)
 *   [12..63] Reserved:  zeros
 *   [64..]   ENCR chunk:
 *              [0..3]   chunk type: 'ENCR'
 *              [4..7]   metadata JSON length (uint32 LE)
 *              [8..N]   metadata JSON (UTF-8)
 *              [N+1..]  AES-256-GCM ciphertext (includes 16-byte auth tag at end)
 *
 * Metadata JSON fields:
 *   aad         true — signals authenticated-metadata profile
 *   algorithm   "aes-256-gcm"
 *   kdf         "pbkdf2"
 *   iterations  600000
 *   hash        "sha512"
 *   saltB64     base64-encoded 32-byte random salt
 *   ivB64       base64-encoded 12-byte random IV/nonce
 *   sha256      hex SHA-256 of plaintext before encryption
 *   originalSize  plaintext byte length
 *   created     ISO 8601 timestamp
 *   tagB64      base64-encoded 16-byte GCM auth tag (excluded from AAD)
 *
 * AAD: all fields except tagB64 are authenticated as AES-GCM AAD,
 *   serialized with JSON.stringify in fixed property order.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { createHash, randomBytes, pbkdf2Sync, createCipheriv } from 'crypto';
import { resolve, extname, basename, dirname } from 'path';
import { parseArgs } from 'util';

const VLB_MAGIC = Buffer.from([0x56, 0x4C, 0x42, 0x00]);
const VLB_HEADER_SIZE = 64;
const KDF_ITERATIONS = 600_000;
const KDF_HASH = 'sha512';
const KEY_LEN = 32;
const SALT_LEN = 32;
const IV_LEN = 12;

function parseCliArgs() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input:      { type: 'string', short: 'i' },
      output:     { type: 'string', short: 'o' },
      passphrase: { type: 'string', short: 'p' },
      help:       { type: 'boolean', short: 'h', default: false }
    },
    strict: true
  });
  return values;
}

function usage() {
  console.log(`
create-vlb: Wrap a model file in an AES-256-GCM encrypted VLB package.

  node tools/create-vlb.mjs --input <path> --output <path> [--passphrase <phrase>]

Options:
  --input,      -i  Input model file path (e.g. public/Model/Duck/glTF-Binary/Duck.glb)
  --output,     -o  Output .vlb file path (e.g. tmp/Duck.vlb)
  --passphrase, -p  Encryption passphrase (or set VLB_PASSPHRASE env var)
  --help,       -h  Show this message

Security:
  Key is derived from the passphrase using PBKDF2 (SHA-512, ${KDF_ITERATIONS} iterations).
  Encryption uses AES-256-GCM with a random 12-byte IV and 16-byte auth tag.
  Security-relevant metadata is authenticated as GCM AAD.
  Passphrase minimum: 12 characters (20+ recommended).
  The passphrase is never written to the output file.
  Do not commit .vlb output files or passphrases to source control.
`);
}

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function buildHeader(version, flags) {
  const header = Buffer.alloc(VLB_HEADER_SIZE, 0);
  VLB_MAGIC.copy(header, 0);
  header.writeUInt32LE(version, 4);
  header.writeUInt32LE(flags, 8);
  return header;
}

function buildEncrChunk(metaJson, ciphertextWithTag) {
  const metaBuf = Buffer.from(metaJson, 'utf8');
  const chunkType = Buffer.from('ENCR');
  const metaLen = Buffer.alloc(4);
  metaLen.writeUInt32LE(metaBuf.length, 0);
  return Buffer.concat([chunkType, metaLen, metaBuf, ciphertextWithTag]);
}

function encrypt(plaintext, passphrase) {
  const salt = randomBytes(SALT_LEN);
  const iv   = randomBytes(IV_LEN);

  const sha256      = sha256Hex(plaintext);
  const originalSize = plaintext.length;
  const created     = new Date().toISOString();

  const key = pbkdf2Sync(passphrase, salt, KDF_ITERATIONS, KEY_LEN, KDF_HASH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  // Authenticate metadata alongside ciphertext. Fixed property order is mandatory —
  // verify-vlb.mjs must reconstruct the same JSON bytes in the same order.
  const aadFields = {
    aad:          true,
    algorithm:    'aes-256-gcm',
    kdf:          'pbkdf2',
    iterations:   KDF_ITERATIONS,
    hash:         KDF_HASH,
    saltB64:      salt.toString('base64'),
    ivB64:        iv.toString('base64'),
    sha256,
    originalSize,
    created
  };
  cipher.setAAD(Buffer.from(JSON.stringify(aadFields), 'utf8'));

  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ciphertextWithTag = Buffer.concat([encrypted, tag]);

  const meta = {
    ...aadFields,
    tagB64: tag.toString('base64')
  };

  return { meta, ciphertextWithTag };
}

function main() {
  const args = parseCliArgs();

  if (args.help) {
    usage();
    process.exit(0);
  }

  if (!args.input) {
    console.error('Error: --input is required.');
    usage();
    process.exit(1);
  }
  if (!args.output) {
    console.error('Error: --output is required.');
    usage();
    process.exit(1);
  }

  const passphrase = args.passphrase || process.env.VLB_PASSPHRASE;
  if (!passphrase) {
    console.error('Error: Passphrase required. Use --passphrase or set VLB_PASSPHRASE environment variable.');
    process.exit(1);
  }
  if (passphrase.length < 12) {
    console.error('Error: Passphrase must be at least 12 characters.');
    process.exit(1);
  }
  if (passphrase.length < 20) {
    console.warn('Warning: Consider using a longer passphrase (20+ characters) for stronger protection.');
  }

  const inputPath  = resolve(args.input);
  const outputPath = resolve(args.output);

  let plaintext;
  try {
    plaintext = readFileSync(inputPath);
  } catch (err) {
    console.error(`Error: Cannot read input file: ${inputPath}\n  ${err.message}`);
    process.exit(1);
  }

  console.log(`Input:        ${inputPath}`);
  console.log(`Input size:   ${plaintext.length.toLocaleString()} bytes`);
  console.log(`Output:       ${outputPath}`);
  console.log(`KDF:          PBKDF2-SHA512, ${KDF_ITERATIONS.toLocaleString()} iterations`);
  console.log(`Cipher:       AES-256-GCM`);

  const { meta, ciphertextWithTag } = encrypt(plaintext, passphrase);
  const metaJson = JSON.stringify(meta);

  const header = buildHeader(2, 1);
  const chunk  = buildEncrChunk(metaJson, ciphertextWithTag);
  const output = Buffer.concat([header, chunk]);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, output);

  console.log(`Output size:  ${output.length.toLocaleString()} bytes`);
  console.log(`SHA-256:      ${meta.sha256}`);
  console.log('Done. Do not commit the output .vlb file or the passphrase to source control.');
}

main();
