# Volare Security Testing Guide

## Automated Tests

```bash
npm test
npm run security:audit
npm run validate
```

The test suite covers:

- Signed manifest verification and tamper detection
- Asset SHA-256 hash verification
- JWT license token validation and expiry
- Nonce replay prevention
- Origin validation (strict production, loose development)
- Full security envelope validation
- HTTP route-level tests for protected and chunked delivery
- Chunk index validation (invalid, negative, non-numeric, out-of-range)
- Asset scope mismatch rejection
- Direct static access blocking for protected and chunk files
- Non-chunked asset returns error on chunk route
- Rate limit: license route returns 429 after limit exceeded with `rate_limited` error code
- Rate limit: 429 response includes standard rate-limit headers
- Rate limit: hitting license limit does not block unrelated routes
- Rate limit: chunk limiter is generous enough for normal loading (first request is not 429)

## Manual Testing

### Public Mode

Public URLs are intentionally downloadable:

```
curl http://localhost:3000/Model/Duck/glTF-Binary/Duck.glb
# Should return 200 with model data
```

### Protected Static Access Blocked

```
curl http://localhost:3000/protected-assets/volare/demo-duck/asset.gltf
# Should return 404
```

```
curl http://localhost:3000/protected-assets/volare/demo-chunked/chunk-0000.bin
# Should return 404
```

### Missing Nonce

```powershell
Invoke-RestMethod -Uri http://localhost:3000/api/volare/license -Method POST `
  -ContentType 'application/json' `
  -Body '{"assetId":"demo-duck"}'
# Should return 401 with nonce_missing
```

### Bad Origin (Production Mode)

```powershell
Invoke-RestMethod -Uri http://localhost:3000/api/volare/license -Method POST `
  -ContentType 'application/json' `
  -Headers @{ 'Origin' = 'http://evil.test'; 'X-Volare-Nonce' = 'test-nonce' } `
  -Body '{"assetId":"demo-duck","nonce":"test-nonce"}'
# Should return 403 with origin_not_allowed (in production mode)
```

### Invalid Token

```
curl -H "Authorization: Bearer invalid-token" \
     -H "X-Volare-Nonce: test-nonce" \
     http://localhost:3000/api/volare/manifest/demo-duck
# Should return 401 with license_invalid
```

### Invalid Chunk Index

```
curl -H "Authorization: Bearer <valid-token>" \
     -H "X-Volare-Nonce: test-nonce" \
     http://localhost:3000/api/volare/chunk/demo-chunked/999
# Should return 404 with chunk_not_found
```

### Negative Chunk Index

```
curl -H "Authorization: Bearer <valid-token>" \
     -H "X-Volare-Nonce: test-nonce" \
     http://localhost:3000/api/volare/chunk/demo-chunked/-1
# Should return 400 with chunk_index_invalid
```

### Non-Chunked Asset on Chunk Route

```
curl -H "Authorization: Bearer <valid-token-for-demo-duck>" \
     -H "X-Volare-Nonce: test-nonce" \
     http://localhost:3000/api/volare/chunk/demo-duck/0
# Should return 400 with asset_not_chunked
```

## Browser Network Tab Verification

1. Open Demo.html in Chrome DevTools Network tab.
2. Load a public model — the model URL is visible and downloadable.
3. Load a protected model — the model URL should be a `blob:` URL. The underlying `/api/volare/asset/:assetId` request is visible but requires valid auth headers to replay.
4. Load a chunked protected model — multiple `/api/volare/chunk/:assetId/:index` requests appear. No single request contains the complete model. Each chunk request requires valid auth headers.
5. After loading, the Blob URL is revoked and no longer accessible.

## What You Should See

- Public models: full URL visible and downloadable.
- Protected models: `blob:` URL in Three.js loader, auth-gated API requests in Network tab.
- Chunked models: multiple small chunk requests, no complete model in any single request.
- All auth headers (Authorization, X-Volare-Nonce, X-Volare-Manifest-Signature) are visible in Network tab but cannot be replayed due to nonce protection.

## What You Should Not Expect

- Protected/chunked mode does NOT hide assets from a determined attacker.
- Browser memory inspection, WebGL readback, or intercepting all chunk responses can reconstruct the model.
- Volare provides controlled delivery and deterrence against casual URL sharing, not DRM.
