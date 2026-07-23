# VLB Format

VLB is Volare's local binary container format. This document describes the
container layouts currently understood by the local tooling.

## VLB v1

VLB v1 is a plaintext demo/public container. It provides structure only; it
does not provide encryption, access control, or asset protection.

Header:

- Magic: `VLB\0`
- Version: `uint32LE = 1`
- Flags: `uint32LE = 0`
- Header size: 64 bytes

Payload:

- Repeating chunks after the 64-byte header
- Each chunk begins with a 4-byte ASCII type
- Each chunk stores a `uint32LE` length
- The chunk data immediately follows the length field

Known chunk types:

- `MESH`
- `MATL`
- `LIGT`
- `CAMR`
- `ANIM`

## VLB v2

VLB v2 is the encrypted container profile used by local developer tooling.

Header:

- Magic: `VLB\0`
- Version: `uint32LE = 2`
- Flags: bit 0 indicates encrypted content
- Header size: 64 bytes

Payload:

- `ENCR` chunk
- Metadata JSON
- Ciphertext

Encryption profile:

- AES-256-GCM
- PBKDF2-SHA512 with 600,000 iterations
- Random 32-byte salt
- Random 12-byte IV
- 16-byte authentication tag
- SHA-256 plaintext integrity field

### ENCR chunk layout

```
[0..3]    Chunk type: 'ENCR' (ASCII)
[4..7]    Metadata JSON byte length (uint32 LE)
[8..N]    Metadata JSON (UTF-8)
[N+1..]   AES-256-GCM ciphertext with 16-byte auth tag appended
```

### Metadata JSON fields

| Field | Type | Description |
|-------|------|-------------|
| `aad` | `true` | Authenticated-metadata profile marker |
| `algorithm` | string | `"aes-256-gcm"` |
| `kdf` | string | `"pbkdf2"` |
| `iterations` | integer | PBKDF2 iteration count |
| `hash` | string | PBKDF2 hash (`"sha512"`) |
| `saltB64` | string | Base64 32-byte random salt |
| `ivB64` | string | Base64 12-byte random IV |
| `sha256` | string | Hex SHA-256 of plaintext before encryption |
| `originalSize` | integer | Plaintext byte length |
| `created` | string | ISO 8601 creation timestamp |
| `tagB64` | string | Base64 16-byte GCM auth tag (excluded from AAD) |

### Authenticated Additional Data (AAD)

All metadata fields **except `tagB64`** are authenticated as AES-GCM AAD.
The AAD is serialized as JSON using `JSON.stringify` in the fixed property
order listed above (aad, algorithm, kdf, iterations, hash, saltB64, ivB64,
sha256, originalSize, created). The property order is mandatory — verify-vlb
must reconstruct the exact same byte sequence.

`tagB64` is excluded from AAD because the authentication tag is produced by
the cipher and is not known until after encryption completes.

### Legacy format

VLB v2 files without `aad: true` in their metadata were produced by a
pre-release version of `create-vlb.mjs`. These files are not supported by
the current `verify-vlb.mjs`. Re-encrypt assets with the current tool.

## Security Notes

VLB v2 protects assets at rest. It is useful for local packaging and for
deployments that control when and how encrypted assets are delivered.

VLB v2 does not make browser-rendered assets impossible to extract. Once
decrypted into browser memory or GPU buffers, a determined user can still
inspect or extract data.

Browser-side VLB decryption is not implemented. The browser loader rejects
encrypted VLB files by design. Decrypted delivery is handled server-side
through the protected asset pipeline.

Passphrase and key management are the deployer's responsibility. Do not commit
passphrases, decrypted assets, or generated encrypted VLB files to source
control.

Backend-controlled delivery is future work.

## VLB-to-Manifest Pipeline

The `vlb-to-manifest` CLI converts a verified encrypted VLB v2 package into a
protected-delivery asset directory compatible with Volare server routes:

```bash
node tools/vlb-to-manifest.mjs \
  --input path/to/model.vlb \
  --asset-id demo-model \
  --output protected-assets/volare/demo-model \
  --passphrase "$VLB_PASSPHRASE"
```

The conversion decrypts locally. The output directory contains plaintext files
and a `manifest.json` that matches the existing server manifest schema. Access
is controlled by the server (JWTs, nonces, origin checks, rate limits), not by
encryption at rest.

Chunked output is available via `--chunk-size <bytes>`:

```bash
node tools/vlb-to-manifest.mjs \
  --input path/to/model.vlb \
  --asset-id demo-chunked \
  --output protected-assets/volare/demo-chunked \
  --passphrase "$VLB_PASSPHRASE" \
  --filename asset.glb \
  --chunk-size 1048576
```

See `docs/PROTECTED_ASSETS.md` for manifest format details.
