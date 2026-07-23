/**
 * vlb-to-manifest.mjs - convert a verified encrypted VLB v2 package into a
 * protected-delivery asset directory compatible with Volare server routes.
 *
 * The VLB is decrypted locally. The output is plaintext on disk, suitable for
 * server-controlled delivery via the protected asset pipeline. This is NOT
 * browser-side decryption — the server controls access through JWTs, nonces,
 * origin checks, manifests, and rate limits.
 *
 * Usage:
 *   node tools/vlb-to-manifest.mjs \
 *     --input path/to/model.vlb \
 *     --asset-id demo-secure-model \
 *     --output protected-assets/volare/demo-secure-model \
 *     --passphrase "local-test-passphrase"
 *
 * Passphrase can also be supplied via VLB_PASSPHRASE.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { createDecipheriv, createHash, pbkdf2Sync } from 'crypto';
import { resolve, basename, extname, sep } from 'path';
import { parseArgs } from 'util';

const VLB_MAGIC = Buffer.from([0x56, 0x4C, 0x42, 0x00]);
const VLB_HEADER_SIZE = 64;
const ENCRYPTED_FLAG = 1;
const KEY_LEN = 32;
const AUTH_TAG_LEN = 16;
const DEFAULT_CHUNK_SIZE = 1_048_576;
const ASSET_ID_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

function usage() {
  console.log(`
vlb-to-manifest: Convert an encrypted VLB v2 package into a protected-delivery
asset directory compatible with Volare server routes.

  node tools/vlb-to-manifest.mjs \\
    --input <path>       Encrypted .vlb input file
    --asset-id <id>      Asset identifier (lowercase alphanumeric + hyphens, 3-64 chars)
    --output <dir>       Output directory for manifest + asset files
    [--passphrase <p>]   Decryption passphrase (or set VLB_PASSPHRASE)
    [--chunk-size <n>]   Enable chunked output with this byte size (default: single file)
    [--filename <name>]  Override output filename (default: asset.bin)
    [--mime-type <type>] Content type (default: application/octet-stream)
    [--overwrite]        Allow overwriting existing output directory
    [--help]

The passphrase is never printed. Decrypted output is written only to the
specified output directory. The output is plaintext — access is controlled
by the Volare server, not by encryption at rest.
`);
}

function parseCliArgs() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input:      { type: 'string', short: 'i' },
      'asset-id': { type: 'string' },
      output:     { type: 'string', short: 'o' },
      passphrase: { type: 'string', short: 'p' },
      'chunk-size': { type: 'string' },
      filename:   { type: 'string' },
      'mime-type': { type: 'string' },
      overwrite:  { type: 'boolean', default: false },
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
      'Re-encrypt with the current create-vlb tool.'
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

function validateAssetId(assetId) {
  if (!assetId || typeof assetId !== 'string') {
    throw new Error('Asset ID is required.');
  }
  if (assetId.length < 3 || assetId.length > 64) {
    throw new Error(`Asset ID must be 3-64 characters, got ${assetId.length}.`);
  }
  if (!ASSET_ID_RE.test(assetId)) {
    throw new Error(
      'Asset ID must contain only lowercase letters, digits, and hyphens. ' +
      'Must start and end with a letter or digit.'
    );
  }
  if (assetId.includes('..') || assetId.includes('/') || assetId.includes('\\')) {
    throw new Error('Asset ID contains path traversal sequences.');
  }
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function validateOutputFilename(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Filename is required.');
  }
  if (basename(name) !== name || name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new Error('Filename must be a plain file name without path traversal.');
  }
  const safeName = sanitizeFilename(name);
  if (!safeName || safeName !== name) {
    throw new Error('Filename may contain only letters, digits, dots, underscores, and hyphens.');
  }
  return safeName;
}

function resolveInside(parentDir, childName) {
  const parent = resolve(parentDir);
  const child = resolve(parent, childName);
  if (child !== parent && !child.startsWith(parent + sep)) {
    throw new Error('Resolved output path escapes the output directory.');
  }
  return child;
}

function inferFormat(filename, contentType) {
  const ext = extname(filename).replace(/^\./, '').toLowerCase();
  if (ext) return ext;
  if (contentType === 'model/gltf+json') return 'gltf';
  if (contentType === 'model/gltf-binary') return 'glb';
  return 'bin';
}

function padIndex(i) {
  return String(i).padStart(4, '0');
}

function writeSingleFileOutput(outputDir, plaintext, filename, contentType, assetId) {
  const safeName = validateOutputFilename(filename);
  const filePath = resolveInside(outputDir, safeName);
  writeFileSync(filePath, plaintext);

  const manifest = {
    assetId,
    file: safeName,
    contentType,
    sha256: sha256Hex(plaintext)
  };
  writeFileSync(resolveInside(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`  file:         ${safeName}`);
  console.log(`  sha256:       ${manifest.sha256}`);
  console.log(`  size:         ${plaintext.length.toLocaleString()} bytes`);
  return manifest;
}

function writeChunkedOutput(outputDir, plaintext, chunkSize, contentType, assetId, filename) {
  const totalSha256 = sha256Hex(plaintext);
  const format = inferFormat(filename, contentType);
  const chunks = [];
  let offset = 0;
  let index = 0;

  while (offset < plaintext.length) {
    const end = Math.min(offset + chunkSize, plaintext.length);
    const chunkData = plaintext.subarray(offset, end);
    const chunkFile = `chunk-${padIndex(index)}.bin`;

    writeFileSync(resolveInside(outputDir, chunkFile), chunkData);
    chunks.push({
      index,
      file: chunkFile,
      size: chunkData.length,
      sha256: sha256Hex(chunkData)
    });

    offset = end;
    index++;
  }

  const manifest = {
    assetId,
    version: 1,
    format,
    contentType,
    delivery: 'chunked',
    chunks,
    totalSize: plaintext.length,
    totalSha256
  };
  writeFileSync(resolveInside(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`  delivery:     chunked`);
  console.log(`  chunks:       ${chunks.length}`);
  console.log(`  chunk size:   ${chunkSize.toLocaleString()} bytes`);
  console.log(`  total size:   ${plaintext.length.toLocaleString()} bytes`);
  console.log(`  totalSha256:  ${totalSha256}`);
  return manifest;
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
  if (!args['asset-id']) {
    console.error('Error: --asset-id is required.');
    usage();
    process.exit(1);
  }
  if (!args.output) {
    console.error('Error: --output is required.');
    usage();
    process.exit(1);
  }

  const assetId = args['asset-id'];
  try {
    validateAssetId(assetId);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  const passphrase = args.passphrase || process.env.VLB_PASSPHRASE;
  if (!passphrase) {
    console.error('Error: Passphrase required. Use --passphrase or set VLB_PASSPHRASE.');
    process.exit(1);
  }

  const outputDir = resolve(args.output);
  if (existsSync(outputDir) && !args.overwrite) {
    console.error(`Error: Output directory already exists: ${outputDir}`);
    console.error('Use --overwrite to replace it.');
    process.exit(1);
  }

  const chunkSize = args['chunk-size'] ? parseInt(args['chunk-size'], 10) : null;
  if (chunkSize !== null && (!Number.isInteger(chunkSize) || chunkSize < 1024)) {
    console.error('Error: --chunk-size must be an integer >= 1024.');
    process.exit(1);
  }

  const filename = args.filename || 'asset.bin';
  const contentType = args['mime-type'] || 'application/octet-stream';
  try {
    validateOutputFilename(filename);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  const inputPath = resolve(args.input);
  let file;
  try {
    file = readFileSync(inputPath);
  } catch (err) {
    console.error(`Error: Cannot read input file: ${inputPath}\n  ${err.message}`);
    process.exit(1);
  }

  let created = false;
  try {
    console.log(`Input:          ${inputPath}`);
    console.log(`Asset ID:       ${assetId}`);
    console.log(`Output:         ${outputDir}`);

    const parsed = parseEncryptedVlb(file);
    const plaintext = decrypt(parsed.ciphertextWithTag, parsed.metadata, passphrase);

    const sha256 = sha256Hex(plaintext);
    if (sha256 !== parsed.metadata.sha256) {
      throw new Error(`SHA-256 mismatch: expected ${parsed.metadata.sha256}, got ${sha256}.`);
    }
    if (parsed.metadata.originalSize !== undefined && plaintext.length !== parsed.metadata.originalSize) {
      throw new Error(
        `Size mismatch: expected ${parsed.metadata.originalSize} bytes, got ${plaintext.length} bytes.`
      );
    }

    if (existsSync(outputDir) && args.overwrite) {
      rmSync(outputDir, { recursive: true, force: true });
    }
    mkdirSync(outputDir, { recursive: true });
    created = true;

    if (chunkSize) {
      writeChunkedOutput(outputDir, plaintext, chunkSize, contentType, assetId, filename);
    } else {
      writeSingleFileOutput(outputDir, plaintext, filename, contentType, assetId);
    }

    console.log('Done.');
  } catch (err) {
    console.error(`Error: ${err.message}`);
    if (created) {
      try { rmSync(outputDir, { recursive: true, force: true }); } catch {}
    }
    process.exit(1);
  }
}

main();
