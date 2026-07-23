# Volare Protected Asset Delivery

## Overview

Volare supports three delivery modes for 3D model assets:

| Mode | Direct URL Visible | Static Serving | Auth Required |
|------|-------------------|----------------|---------------|
| **Public** | Yes | Yes | No |
| **Protected** | No (Blob URL) | No | Yes |
| **Chunked** | No (Blob URL) | No | Yes |

Public raw URLs are downloadable by anyone with the URL. Protected and chunked modes gate access through server-validated requests with short-lived tokens.

## Protected Mode (Single File)

Assets stored in `protected-assets/volare/{assetId}/`:

```text
protected-assets/volare/demo-duck/
  manifest.json
  asset.gltf
```

### Manifest (single file)

```json
{
  "assetId": "demo-duck",
  "file": "asset.gltf",
  "contentType": "model/gltf+json",
  "sha256": "b69c34f..."
}
```

### Client

```js
const viewer = await createVolareViewer({
  container: '#viewer',
  protectedAsset: {
    assetId: 'demo-duck'
  }
});
```

### Flow

1. `POST /api/volare/license` with nonce -> JWT token
2. `GET /api/volare/manifest/:assetId` with token + nonce -> signed manifest
3. `GET /api/volare/asset/:assetId` with token + nonce + manifest signature -> asset bytes
4. Client verifies SHA-256, creates Blob URL, loads model, revokes URL

## Chunked Mode

Assets split into chunks in `protected-assets/volare/{assetId}/`:

```text
protected-assets/volare/demo-chunked/
  manifest.json
  chunk-0000.bin
  chunk-0001.bin
  chunk-0002.bin
```

### Manifest (chunked)

```json
{
  "assetId": "demo-chunked",
  "version": 1,
  "format": "gltf",
  "contentType": "model/gltf+json",
  "delivery": "chunked",
  "chunks": [
    { "index": 0, "file": "chunk-0000.bin", "size": 65536, "sha256": "..." },
    { "index": 1, "file": "chunk-0001.bin", "size": 65536, "sha256": "..." },
    { "index": 2, "file": "chunk-0002.bin", "size": 31724, "sha256": "..." }
  ],
  "totalSize": 162796,
  "totalSha256": "b69c34f..."
}
```

### Client

```js
const viewer = await createVolareViewer({
  container: '#viewer',
  protectedAsset: {
    assetId: 'demo-chunked'
  }
});
```

The SDK detects `delivery: "chunked"` in the signed manifest and fetches chunks individually.

### Flow

1. `POST /api/volare/license` with nonce -> JWT token
2. `GET /api/volare/manifest/:assetId` with token + nonce -> signed chunked manifest
3. For each chunk: `GET /api/volare/chunk/:assetId/:index` with token + nonce -> chunk bytes
4. Client verifies each chunk SHA-256
5. Client assembles chunks in order
6. Client verifies total SHA-256
7. Client creates Blob URL, loads model with explicit format, revokes URL

## Local Workflow: VLB to Protected Delivery

The recommended workflow uses the VLB toolchain end-to-end:

### 1. Create encrypted VLB

```bash
node tools/create-vlb.mjs \
  --input ./assets/car.glb \
  --output ./tmp/car.vlb \
  --passphrase "$VLB_PASSPHRASE"
```

### 2. Verify the encrypted VLB

```bash
node tools/verify-vlb.mjs \
  --input ./tmp/car.vlb \
  --passphrase "$VLB_PASSPHRASE"
```

### 3. Convert to protected-delivery directory

Single file:

```bash
node tools/vlb-to-manifest.mjs \
  --input ./tmp/car.vlb \
  --asset-id demo-car \
  --output ./protected-assets/volare/demo-car \
  --passphrase "$VLB_PASSPHRASE" \
  --mime-type application/octet-stream \
  --filename asset.glb
```

Chunked:

```bash
node tools/vlb-to-manifest.mjs \
  --input ./tmp/car.vlb \
  --asset-id demo-car \
  --output ./protected-assets/volare/demo-car \
  --passphrase "$VLB_PASSPHRASE" \
  --filename asset.glb \
  --chunk-size 1048576
```

### 4. Serve through existing protected routes

Start the server and access the asset through the license/manifest/asset API
flow documented below.

### Security posture

The VLB-to-manifest conversion decrypts locally. The output directory contains
plaintext files on server storage. Access is controlled by the Volare server
through JWTs, nonces, origin checks, manifests, and rate limits. The browser
ultimately receives plaintext needed for rendering. This is layered access
control and deterrence, not an absolute barrier. Server-side
encrypted-at-rest delivery is future roadmap, not implemented.

## Rate Limiting

All protected API routes are rate-limited per IP using `express-rate-limit`.

| Route | Default limit |
|-------|---------------|
| `POST /api/volare/license` | 20 requests / minute |
| `GET /api/volare/manifest/:assetId` | 60 requests / minute |
| `GET /api/volare/asset/:assetId` | 30 requests / minute |
| `GET /api/volare/chunk/:assetId/:index` | 300 requests / minute |
| `POST /verify-turnstile` | 10 requests / minute |

When a limit is exceeded the server responds with HTTP 429:

```json
{ "success": false, "error": "rate_limited" }
```

Standard `RateLimit` and `Retry-After` headers are included. Static demo files and `/api/security/status` are not rate-limited.

Client-side handling: check for `status === 429` or `error === 'rate_limited'` and surface a user-facing message. Do not automatically retry authentication failures. A bounded retry is acceptable only for 429 responses.

## Browser Security Clients

Three composable browser-side clients are provided as ES modules from `SDK/Security/`.

### LicenseClient

Requests a short-lived JWT from `/api/volare/license`. Throws `LicenseError` (with `.code` and `.status`) on 401, 403, 429, or invalid response shape. Never logs the returned token.

```js
import { LicenseClient, LicenseError } from 'volare/security/LicenseClient';

const client = new LicenseClient({ baseUrl: '' });
try {
  const { token, expiresIn } = await client.requestLicense({ assetId, nonce });
} catch (err) {
  if (err instanceof LicenseError && err.status === 429) { /* rate limited */ }
}
```

### ManifestClient

Fetches and validates the signed manifest from `/api/volare/manifest/:assetId`. Throws `ManifestError` on failure. Does not verify the HMAC signature client-side — that is the server's responsibility.

```js
import { ManifestClient } from 'volare/security/ManifestClient';

const client = new ManifestClient({ baseUrl: '' });
const manifest = await client.fetchManifest({ assetId, token, nonce });
```

### ProtectedAssetClient

Orchestrates `LicenseClient` and `ManifestClient`. Exposes `requestLicense()`, `fetchManifest()`, `fetchAsset()`, and `fetchChunk()`. Supports `AbortSignal`. Does not retry on auth failures. Handles 429 by throwing `AssetError` with `code: 'rate_limited'`.

```js
import { ProtectedAssetClient } from 'volare/security/ProtectedAssetClient';

const client = new ProtectedAssetClient({ baseUrl: '' });
const { token } = await client.requestLicense({ assetId, nonce: crypto.randomUUID() });
const manifest = await client.fetchManifest({ assetId, token, nonce: crypto.randomUUID() });
const bytes = await client.fetchAsset({ assetId, token, nonce: crypto.randomUUID(), manifest });
```

These clients enforce request flow and surface typed errors. They are not a DRM boundary. Tokens must not be logged or persisted. The server remains the authority for permissions and asset scope. Browser extraction remains possible after the model is rendered.

## Limitations

- Public raw URLs remain downloadable by design.
- Protected and chunked modes block direct static access and require valid tokens.
- Chunked mode removes a single obvious complete-model URL from the browser Network tab.
- A determined attacker can still capture the assembled model from browser memory, intercept all chunk responses, or extract rendered geometry from GPU state.
- Do not claim Volare makes assets impossible to extract.
- Encrypted chunk delivery (AES-GCM) is not yet implemented.

## Endpoint Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/volare/license` | POST | Issue short-lived JWT token |
| `/api/volare/manifest/:assetId` | GET | Signed manifest (single or chunked) |
| `/api/volare/asset/:assetId` | GET | Stream protected single-file asset |
| `/api/volare/chunk/:assetId/:index` | GET | Stream individual protected chunk |
