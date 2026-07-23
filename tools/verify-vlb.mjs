/**
 * verify-vlb.mjs - local verifier for encrypted VLB v2 packages.
 *
 * Usage:
 *   node tools/verify-vlb.mjs --input path/to/file.vlb --passphrase "local-test"
 *   node tools/verify-vlb.mjs --input path/to/file.vlb
 *
 * Passphrase can also be supplied via VLB_PASSPHRASE.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { createDecipheriv, createHash, pbkdf2Sync } from 'crypto';
import { dirname, resolve } from 'path';
import { parseArgs } from 'util';

const VLB_MAGIC = Buffer.from([0x56, 0x4C, 0x42, 0x00]);
const VLB_HEADER_SIZE = 64;
const ENCRYPTED_FLAG = 1;
const KEY_LEN = 32;
const AUTH_TAG_LEN = 16;

function usage() {
  console.log(`
verify-vlb: Verify an AES-256-GCM encrypted VLB v2 package.

  node tools/verify-vlb.mjs --input <path> [--passphrase <phrase>] [--output <path>]

Options:
  --input,      -i  Encrypted .vlb input file
  --passphrase, -p  Decryption passphrase, or set VLB_PASSPHRASE
  --output,     -o  Optional plaintext output path
  --help,       -h  Show this message

The passphrase is never printed. Decrypted output is written only when --output
is provided.
`);
}

function parseCliArgs() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input:      { type: 'string', short: 'i' },
      passphrase: { type: 'string', short: 'p' },
      output:     { type: 'string', short: 'o' },
      help:       { type: 'boolean', short: 'h', default: false }
    },
    strict: true
  });
  return values;
}

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function readUInt32LE(buf, offset, label) {
  if (offset + 4 > buf.length) {
    throw new Error(`Invalid VLB: truncated ${label}.`);
  }
  return buf.readUInt32LE(offset);
}

function parseEncryptedVlb(buf) {
  if (buf.length < VLB_HEADER_SIZE) {
    throw new Error('Invalid VLB: header is truncated.');
  }
  if (!buf.subarray(0, 4).equals(VLB_MAGIC)) {
    throw new Error('Invalid VLB: magic must be VLB\\0.');
  }

  const version = readUInt32LE(buf, 4, 'version');
  const flags = readUInt32LE(buf, 8, 'flags');

  if (version !== 2) {
    throw new Error(`Invalid VLB: expected version 2, got ${version}.`);
  }
  if ((flags & ENCRYPTED_FLAG) === 0) {
    throw new Error('Invalid VLB: encrypted flag is not set.');
  }

  let offset = VLB_HEADER_SIZE;
  if (offset + 8 > buf.length) {
    throw new Error('Invalid VLB: ENCR chunk header is truncated.');
  }

  const chunkType = buf.subarray(offset, offset + 4).toString('ascii');
  offset += 4;
  if (chunkType !== 'ENCR') {
    throw new Error(`Invalid VLB: expected ENCR chunk, got ${chunkType}.`);
  }

  const metaLength = readUInt32LE(buf, offset, 'metadata length');
  offset += 4;
  if (offset + metaLength > buf.length) {
    throw new Error('Invalid VLB: metadata JSON is truncated.');
  }

  let metadata;
  try {
    metadata = JSON.parse(buf.subarray(offset, offset + metaLength).toString('utf8'));
  } catch (err) {
    throw new Error(`Invalid VLB: metadata JSON could not be parsed: ${err.message}`);
  }
  offset += metaLength;

  const ciphertextWithTag = buf.subarray(offset);
  if (ciphertextWithTag.length < AUTH_TAG_LEN) {
    throw new Error('Invalid VLB: ciphertext/auth tag is truncated.');
  }

  return { version, flags, metadata, ciphertextWithTag };
}

function requireMetadata(meta) {
  if (!meta.aad) {
    throw new Error(
      'Invalid VLB: metadata was not authenticated (aad flag missing). ' +
      'This file was created with a pre-release tool. Re-encrypt with the current create-vlb tool.'
    );
  }
  if (meta.algorithm !== 'aes-256-gcm') {
    throw new Error(`Unsupported algorithm: ${meta.algorithm}`);
  }
  if (meta.kdf !== 'pbkdf2') {
    throw new Error(`Unsupported KDF: ${meta.kdf}`);
  }
  if (meta.hash !== 'sha512') {
    throw new Error(`Unsupported KDF hash: ${meta.hash}`);
  }
  if (!Number.isInteger(meta.iterations) || meta.iterations <= 0) {
    throw new Error('Invalid metadata: iterations must be a positive integer.');
  }
  for (const field of ['saltB64', 'ivB64', 'tagB64', 'sha256']) {
    if (typeof meta[field] !== 'string' || meta[field].length === 0) {
      throw new Error(`Invalid metadata: ${field} is required.`);
    }
  }
}

function decrypt(ciphertextWithTag, metadata, passphrase) {
  requireMetadata(metadata);

  const salt = Buffer.from(metadata.saltB64, 'base64');
  const iv = Buffer.from(metadata.ivB64, 'base64');
  const tag = Buffer.from(metadata.tagB64, 'base64');
  const appendedTag = ciphertextWithTag.subarray(ciphertextWithTag.length - AUTH_TAG_LEN);

  if (!tag.equals(appendedTag)) {
    throw new Error('Invalid VLB: metadata auth tag does not match appended auth tag.');
  }

  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - AUTH_TAG_LEN);
  const key = pbkdf2Sync(passphrase, salt, metadata.iterations, KEY_LEN, metadata.hash);
  const decipher = createDecipheriv(metadata.algorithm, key, iv);
  decipher.setAuthTag(tag);

  // Reconstruct AAD in identical property order to create-vlb.mjs.
  const aadFields = {
    aad:          true,
    algorithm:    metadata.algorithm,
    kdf:          metadata.kdf,
    iterations:   metadata.iterations,
    hash:         metadata.hash,
    saltB64:      metadata.saltB64,
    ivB64:        metadata.ivB64,
    sha256:       metadata.sha256,
    originalSize: metadata.originalSize,
    created:      metadata.created
  };
  decipher.setAAD(Buffer.from(JSON.stringify(aadFields), 'utf8'));

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function printResult({ valid, version, flags, metadata, sha256Match, sizeMatch, error }) {
  console.log(`valid: ${valid ? 'yes' : 'no'}`);
  if (version !== undefined) console.log(`version: ${version}`);
  if (flags !== undefined) console.log(`flags: ${flags}`);
  if (metadata) {
    console.log(`originalSize expected: ${metadata.originalSize ?? 'unknown'}`);
    console.log(`created: ${metadata.created ?? 'unknown'}`);
  }
  if (sha256Match !== undefined) {
    console.log(`sha256 match: ${sha256Match ? 'yes' : 'no'}`);
  }
  if (sizeMatch !== undefined) {
    console.log(`size match: ${sizeMatch ? 'yes' : 'no'}`);
  }
  if (error) {
    console.error(`error: ${error.message}`);
  }
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

  const passphrase = args.passphrase || process.env.VLB_PASSPHRASE;
  if (!passphrase) {
    console.error('Error: Passphrase required. Use --passphrase or set VLB_PASSPHRASE.');
    process.exit(1);
  }

  try {
    const inputPath = resolve(args.input);
    const file = readFileSync(inputPath);
    const parsed = parseEncryptedVlb(file);
    const plaintext = decrypt(parsed.ciphertextWithTag, parsed.metadata, passphrase);
    const sha256 = sha256Hex(plaintext);
    const sha256Match = sha256 === parsed.metadata.sha256;
    const sizeMatch =
      parsed.metadata.originalSize === undefined ||
      plaintext.length === parsed.metadata.originalSize;

    if (!sizeMatch) {
      console.error(
        `Size mismatch: expected ${parsed.metadata.originalSize} bytes, got ${plaintext.length} bytes.`
      );
    }

    printResult({
      valid: sha256Match && sizeMatch,
      version: parsed.version,
      flags: parsed.flags,
      metadata: parsed.metadata,
      sha256Match,
      sizeMatch
    });

    if (!sha256Match || !sizeMatch) {
      process.exit(1);
    }

    if (args.output) {
      const outputPath = resolve(args.output);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, plaintext);
      console.log(`output: ${outputPath}`);
    }
  } catch (err) {
    printResult({ valid: false, error: err });
    process.exit(1);
  }
}

main();
