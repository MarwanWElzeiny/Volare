# Volare Security Model

Volare uses practical layered protection. It does not make browser-rendered assets impossible to copy, and it is not DRM.

Raw public model URLs are downloadable. If a model is loaded from a path such as `/DEMO/models/Duck/glTF-Binary/Duck.glb`, that file is intentionally public and anyone with the URL can request it. Public demo mode is not protected.

## Supported Versions

| Version                     | Supported |
| --------------------------- | --------- |
| 0.1.x beta                  | Yes       |
| Older development snapshots | No        |

## Reporting a Vulnerability

Please do not create a public issue for security vulnerabilities.

Once the public repository exists, use GitHub Security Advisories for private vulnerability reports. Include:

- Affected Volare version or commit.
- Affected component, such as SDK, demo, VLB tooling, or protected delivery.
- Reproduction steps or a minimal proof of concept.
- Expected impact and affected scenarios.
- Mitigation ideas if known.

Do not submit real secrets, credentials, private keys, private models, proprietary assets, or private user data in a report.

Maintainers aim to acknowledge vulnerability reports within 7 days and provide an initial status update within 14 days. There is no guaranteed remediation deadline; timelines depend on severity, reproducibility, compatibility risk, and maintainer availability.

## Modes

### Public Demo Mode

Public demo mode keeps existing local and demo loading working:

```js
createVolareViewer({
  container: '#viewer',
  model: '/DEMO/models/Duck/glTF-Binary/Duck.glb'
});
```

This mode is useful for examples and local testing. It is not a protection boundary.

### Protected Delivery Mode

Protected delivery mode requires server-backed routes and assets stored outside the public static root:

- `POST /api/volare/license`
- `GET /api/volare/manifest/:assetId`
- `GET /api/volare/asset/:assetId`

The protected sample convention is:

```text
protected-assets/
  volare/
    demo-duck/
      asset.gltf
      manifest.json
```

The server does not statically serve `protected-assets/`; asset bytes are sent only through `/api/volare/asset/:assetId` after validation.

### Chunked Delivery Mode

Chunked delivery mode splits a protected asset into multiple chunks. No single network request transfers the complete model file. Each chunk is individually authenticated and hash-verified.

Routes:

- `POST /api/volare/license`
- `GET /api/volare/manifest/:assetId` (returns chunked signed manifest)
- `GET /api/volare/chunk/:assetId/:index`

The chunked sample convention is:

```text
protected-assets/
  volare/
    demo-chunked/
      manifest.json
      chunk-0000.bin
      chunk-0001.bin
      chunk-0002.bin
```

The client fetches all chunks, verifies each chunk's SHA-256, reassembles in order, verifies total SHA-256, then loads the assembled model via Blob URL.

Chunked delivery is layered protection against simple direct-URL downloads. It is not DRM and does not prevent a determined attacker from reassembling chunks from browser memory or network inspection.

## ACTIVE

- Env-based server secrets: `VOLARE_SECURITY_SECRET`, `VOLARE_LICENSE_SECRET`, `TURNSTILE_SECRET_KEY`, `VOLARE_ALLOWED_ORIGINS`.
- Development fallback signing key with a clear warning. Production requires configured secrets.
- Protected license route issuing short-lived JWT tokens scoped to asset ID, origin, request ID, and nonce.
- Protected manifest route validating origin, nonce/replay, token signature, token expiry, and asset scope.
- Signed manifest generation and HMAC-SHA256 verification.
- Protected asset route validating origin, nonce/replay, token signature, token expiry, asset scope, signed manifest, and SHA-256 file hash before sending bytes.
- Chunked protected asset delivery: model split into chunks, each served via authenticated chunk route with per-chunk SHA-256 verification.
- Client-side chunk reassembly with per-chunk and total SHA-256 validation before model loading.
- Asset SHA-256 hash verification for protected assets.
- Origin validation.
- Safer CORS with explicit production origins and localhost development allowance.
- Helmet/CSP configured for Three.js, glTF, blob model URLs, blob textures, and current CDN imports.
- Secure static serving with dotfiles denied, `/node_modules`, `/server`, `/security`, `/tests`, `/tools` blocked, and protected storage denied.
- Safe JSON error responses that do not expose absolute file paths.
- Per-IP rate limiting on all protected API routes via `express-rate-limit`: license (20/min), manifest (60/min), asset (30/min), chunk (300/min), Turnstile (10/min). Exceeding a limit returns HTTP 429 with `{ "success": false, "error": "rate_limited" }` and standard `RateLimit`/`Retry-After` headers.
- Browser-side security clients (`LicenseClient`, `ManifestClient`, `ProtectedAssetClient`) that enforce the request flow and surface typed errors for 401, 403, and 429 responses.
- `npm run security:audit`.
- `npm run test:security`.

## UTILITY ONLY

- `/api/security/validate` and `validateSecurityEnvelope` remain for compatibility tests and trusted tooling. The real protected delivery path is `/api/volare/*`.
- Public demo model loading remains available for local/demo use.

## NOT IMPLEMENTED

- Encrypted chunk delivery (AES-GCM session keys).
- Hardware-backed DRM.
- Watermarking.
- Guaranteed prevention of screen capture, network inspection, browser memory inspection, or extraction after the browser legitimately receives and renders the asset.

## Operational Notes

Production deployments should set:

- `NODE_ENV=production`
- `VOLARE_SECURITY_SECRET`
- `VOLARE_LICENSE_SECRET`
- `VOLARE_ALLOWED_ORIGINS=https://your-site.example`
- `TURNSTILE_SECRET_KEY` if Turnstile verification is used

Do not claim Volare makes assets unstealable. Protected delivery reduces casual downloading and gates access to authorized, short-lived requests, but any asset rendered in a client can potentially be captured after delivery.

## Protected Mode Initialization

Use protected mode only for assets stored outside the static web root (in `protected-assets/`):

```js
const viewer = await createVolareViewer({
  container: '#viewer',
  protectedAsset: {
    assetId: 'demo-duck',
    licenseEndpoint: '/api/volare/license',
    manifestEndpoint: '/api/volare/manifest/demo-duck',
    assetEndpoint: '/api/volare/asset/demo-duck'
  },
  ui: true
});
```

The SDK sends a fresh nonce for the license, manifest, and asset requests. Blob URLs created for protected loads are revoked after loading and again on viewer destruction.

## Chunked Mode Initialization

Chunked mode uses the same `protectedAsset` config. The server manifest tells the client whether delivery is chunked:

```js
const viewer = await createVolareViewer({
  container: '#viewer',
  protectedAsset: {
    assetId: 'demo-chunked',
    licenseEndpoint: '/api/volare/license',
    manifestEndpoint: '/api/volare/manifest/demo-chunked',
    chunkEndpoint: '/api/volare/chunk/demo-chunked'
  }
});
```

The SDK automatically detects `delivery: "chunked"` in the signed manifest and fetches chunks individually.

## How To Test The Security Path

Run the automated checks:

```bash
npm test
npm run security:audit
```

Manual smoke checks:

- Public demo route: `GET /DEMO/index.html` should return `200`.
- Portfolio demo route: `GET /DEMO/portfolio.html` should return `200`.
- Direct protected storage request: `GET /protected-assets/volare/demo-duck/asset.gltf` should return `404`.
- Missing license nonce: `POST /api/volare/license` without `X-Volare-Nonce` or body `nonce` should return `401` with `nonce_missing`.
- Bad origin: protected requests from an origin outside `VOLARE_ALLOWED_ORIGINS` should return `403` with `origin_not_allowed` in production mode.
- Replay nonce: reuse a nonce already accepted by a protected route; the second request should return `401` with `nonce_replay`.
- Bad manifest signature: call `/api/volare/asset/demo-duck` with an invalid `X-Volare-Manifest-Signature`; it should return `401` with `manifest_signature_invalid`.
- Bad asset hash: change a protected asset without updating its manifest hash in a controlled test environment; manifest/asset access should return `409` with `asset_hash_invalid`.
- Valid local protected flow: request a license with a fresh nonce, fetch the signed manifest with a new nonce and bearer token, then fetch the asset with a third nonce plus manifest signature and expiry. The asset route should return the protected model bytes.

Browser/network reality check:

- A public URL such as `/DEMO/models/Duck/glTF-Binary/Duck.glb` is still downloadable.
- A protected request that succeeds will still deliver bytes to an authorized browser session. Volare reduces casual direct linking and stale/replayed access; it does not make client-rendered assets impossible to capture.
