# Security Boundary

Volare has two operating modes with distinct security boundaries.

## Public Mode (Default)

Models are served as regular static files. No backend required.

```js
const viewer = await createVolareViewer({
  container: '#viewer',
  model: './models/car.glb'
});
```

- Model URLs are plain `<script>` / `fetch()` targets
- No authentication, no tokens, no server-side logic
- Suitable for public portfolios, documentation, open-source demos

## Protected Mode (Optional)

Models are served through a backend that enforces access control.

```js
const viewer = await createVolareViewer({
  container: '#viewer',
  protectedAsset: {
    assetId: 'my-model-id',
    licenseEndpoint: '/api/volare/license',
    manifestEndpoint: '/api/volare/manifest/my-model-id',
    assetEndpoint: '/api/volare/asset/my-model-id'
  }
});
```

### What the server does

- Issues **JWT license tokens** with expiry and client binding
- Signs **HMAC-SHA256 manifests** to verify asset integrity
- Enforces **nonce replay protection** to prevent request reuse
- Validates **origin** in production
- Delivers chunks with **per-chunk SHA-256** verification

### What the browser does NOT do

- No secrets in browser code — signing keys, JWT secrets, and HMAC keys
  live only on the server (`server/app.js` / your backend)
- No `/api/` calls outside the `Security/` folder — core viewer, UI, tools,
  and managers never contact the server directly
- All endpoints are configurable — `licenseEndpoint`, `manifestEndpoint`,
  `assetEndpoint`, `chunkEndpoint` default to `/api/volare/*` but can point
  anywhere

### Honest limitations

Browser-delivered 3D assets can be extracted by a determined attacker with
dev tools. Protected mode is **access control and deterrence**, not DRM. It
prevents casual hotlinking and unauthorized embedding.

## SDK File Boundary

| Layer | Contacts server? | Contains secrets? |
|-------|------------------|-------------------|
| `SDK/Core/` | No | No |
| `SDK/Managers/` | No | No |
| `SDK/UI/` | No | No |
| `SDK/Visualization/`, `SDK/Analysis/` | No | No |
| `SDK/Security/` | Yes (configurable endpoints) | No |
| `server/app.js` | N/A (is the server) | Yes (reads `.env`) |

## Rules for Integrators

1. **Never embed signing keys in browser bundles.**
2. **Protected delivery is optional** — public viewing works without any backend.
3. **All `/api/` paths are configurable** — you are not locked to `/api/volare/*`.
4. **`.env` stays on the server** — the SDK runtime has zero `process.env` references.
