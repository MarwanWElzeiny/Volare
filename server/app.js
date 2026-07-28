require('dotenv').config();

const express = require('express');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');

const rateLimit = require('express-rate-limit');

const {
    createLicenseToken,
    createSignedManifest,
    getSecurityConfig,
    loadProtectedAssetRecord,
    resolveChunkFilePath,
    validateChunkIndex,
    validateOrigin,
    validateNonce,
    validateProtectedAssetRequest,
    validateSecurityEnvelope,
    verifyAssetHash,
    verifySignedManifest,
    VOLARE_SECURITY_CLASSIFICATION
} = require('../security/volareSecurity.cjs');

const PORT = process.env.PORT || 3000;
const publicRoot = path.join(__dirname, '..');
const protectedRoot = path.join(__dirname, '..', 'protected-assets');
const securityConfig = getSecurityConfig(process.env);

function createRateLimiters(overrides = {}) {
    function make(name, windowMs, max) {
        return rateLimit({
            windowMs,
            max,
            ...(overrides[name] || {}),
            standardHeaders: 'draft-7',
            legacyHeaders: false,
            handler(req, res) {
                res.status(429).json({ success: false, error: 'rate_limited' });
            }
        });
    }
    return {
        license:   make('license',   60_000,  20),
        manifest:  make('manifest',  60_000,  60),
        asset:     make('asset',     60_000,  30),
        chunk:     make('chunk',     60_000, 300),
        turnstile: make('turnstile', 60_000,  10)
    };
}

function createCorsOptions(config) {
    return {
        origin(origin, callback) {
            if (validateOrigin(origin, config.allowedOrigins, config.mode)) {
                callback(null, true);
                return;
            }
            callback(new Error('Origin not allowed'));
        },
        methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'X-Volare-Nonce',
            'X-Volare-Manifest-Signature',
            'X-Volare-Manifest-Expiry'
        ],
        credentials: false,
        maxAge: 600
    };
}

function safeErrorResponse(res, status, code) {
    res.status(status).json({
        success: false,
        error: code
    });
}

function getRequestOrigin(req) {
    return req.get('Origin') || `${req.protocol}://${req.get('host')}`;
}

function getLicenseTokenExpiry(config) {
    return Math.max(30, Math.min(Number(config.tokenTtlSeconds) || 300, 900));
}

function buildManifestFromHeaders(record, req) {
    return {
        assetId: record.assetId,
        assetPath: `/api/volare/asset/${record.assetId}`,
        file: record.file,
        hash: record.sha256,
        size: record.size,
        contentType: record.contentType,
        expiresAt: req.get('X-Volare-Manifest-Expiry'),
        signature: req.get('X-Volare-Manifest-Signature')
    };
}

function createApp(config = securityConfig, options = {}) {
const limiters = createRateLimiters(options.rateLimits || {});
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '128kb' }));
app.use(cors(createCorsOptions(config)));
app.use(helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", "blob:", "data:", "https://cdn.jsdelivr.net", "https://unpkg.com", "https://cdnjs.cloudflare.com", "https://cdn.rawgit.com"],
            "style-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net/gh/iconoir-icons"],
            "font-src": ["'self'", "data:", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
            "img-src": ["'self'", "data:", "blob:", "https:"],
            "media-src": ["'self'", "blob:", "data:"],
            "connect-src": ["'self'", "blob:", "data:", "https://cdn.jsdelivr.net", "https://unpkg.com", "https://cdnjs.cloudflare.com", "https://challenges.cloudflare.com"],
            "worker-src": ["'self'", "blob:"],
            "child-src": ["'self'", "blob:"],
            "object-src": ["'none'"],
            // Blocks inline event-handler attributes (onclick= etc.) while keeping
            // unsafe-inline in script-src for importmap/static-demo compatibility.
            "script-src-attr": ["'none'"]
        }
    }
}));

app.post('/verify-turnstile', limiters.turnstile, async (req, res) => {
    const { token } = req.body;
    const secret = process.env.TURNSTILE_SECRET_KEY;

    if (!token) return safeErrorResponse(res, 400, 'missing_token');
    if (!secret) return safeErrorResponse(res, 503, 'turnstile_not_configured');

    try {
        const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret, response: token })
        });

        const data = await verifyResponse.json();
        if (data.success) {
            res.json({ success: true });
            return;
        }
        safeErrorResponse(res, 400, 'verification_failed');
    } catch (error) {
        console.error('Turnstile verification failed:', error.message);
        safeErrorResponse(res, 500, 'turnstile_verification_error');
    }
});

app.get('/api/security/status', (req, res) => {
    res.json({
        mode: config.mode,
        configured: config.securityConfigured,
        devFallback: config.devFallback,
        classification: VOLARE_SECURITY_CLASSIFICATION
    });
});

app.post('/api/security/validate', (req, res) => {
    const result = validateSecurityEnvelope({
        manifest: req.body?.manifest,
        licenseToken: req.body?.licenseToken,
        nonce: req.body?.nonce || req.get('X-Volare-Nonce'),
        origin: req.get('Origin'),
        publicRoot,
        config
    });

    if (!result.ok) {
        safeErrorResponse(res, result.status || 401, result.reason);
        return;
    }

    res.json({
        success: true,
        checkedAssets: result.checkedAssets,
        manifestId: result.manifest.id || null,
        licenseSubject: result.license.sub || null
    });
});

app.post('/api/volare/license', limiters.license, (req, res) => {
    const assetId = req.body?.assetId;
    const origin = getRequestOrigin(req);

    if (!config.securityConfigured) {
        safeErrorResponse(res, 503, 'security_not_configured');
        return;
    }
    if (!validateOrigin(req.get('Origin'), config.allowedOrigins, config.mode)) {
        safeErrorResponse(res, 403, 'origin_not_allowed');
        return;
    }

    const record = loadProtectedAssetRecord(protectedRoot, assetId);
    if (!record.ok) {
        safeErrorResponse(res, record.status || 404, record.reason);
        return;
    }

    const clientNonce = req.body?.nonce || req.get('X-Volare-Nonce');
    const nonceResult = validateNonce(clientNonce);
    if (!nonceResult.ok) {
        safeErrorResponse(res, 401, nonceResult.reason);
        return;
    }

    const expiresIn = getLicenseTokenExpiry(config);
    const requestId = crypto.randomUUID();
    const token = createLicenseToken({
        sub: req.body?.clientId || 'volare-client',
        assetId,
        origin,
        requestId,
        nonce: clientNonce
    }, config.licenseSecret, { expiresIn: `${expiresIn}s` });

    res.json({
        success: true,
        token,
        tokenType: 'Bearer',
        expiresIn,
        assetId,
        requestId,
        devModeWarning: config.devFallback
            ? 'Development fallback signing key is active. Configure VOLARE_SECURITY_SECRET for production.'
            : null
    });
});

app.get('/api/volare/manifest/:assetId', limiters.manifest, (req, res) => {
    const access = validateProtectedAssetRequest({ req, assetId: req.params.assetId, config });
    if (!access.ok) {
        safeErrorResponse(res, access.status || 401, access.reason);
        return;
    }

    const record = loadProtectedAssetRecord(protectedRoot, req.params.assetId);
    if (!record.ok) {
        safeErrorResponse(res, record.status || 404, record.reason);
        return;
    }

    if (!record.chunked) {
        const hash = verifyAssetHash(record.record.filePath, record.record.sha256);
        if (!hash.ok) {
            safeErrorResponse(res, 409, hash.reason);
            return;
        }
    }

    const expiresAt = new Date(Math.min(access.license.exp * 1000, Date.now() + getLicenseTokenExpiry(config) * 1000)).toISOString();
    const manifest = createSignedManifest(record.record, config.secret, expiresAt);
    const verified = verifySignedManifest(manifest, config.secret);
    if (!verified.ok) {
        safeErrorResponse(res, 500, verified.reason);
        return;
    }

    res.json({
        success: true,
        manifest
    });
});

app.get('/api/volare/chunk/:assetId/:index', limiters.chunk, (req, res) => {
    const access = validateProtectedAssetRequest({ req, assetId: req.params.assetId, config });
    if (!access.ok) {
        safeErrorResponse(res, access.status || 401, access.reason);
        return;
    }

    const record = loadProtectedAssetRecord(protectedRoot, req.params.assetId);
    if (!record.ok) {
        safeErrorResponse(res, record.status || 404, record.reason);
        return;
    }
    if (!record.chunked) {
        safeErrorResponse(res, 400, 'asset_not_chunked');
        return;
    }

    const chunkResult = validateChunkIndex(record, req.params.index);
    if (!chunkResult.ok) {
        safeErrorResponse(res, chunkResult.status || 400, chunkResult.reason);
        return;
    }

    let chunkPath;
    try {
        chunkPath = resolveChunkFilePath(protectedRoot, req.params.assetId, chunkResult.chunk.file);
    } catch {
        safeErrorResponse(res, 400, 'chunk_path_invalid');
        return;
    }

    const hash = verifyAssetHash(chunkPath, chunkResult.chunk.sha256);
    if (!hash.ok) {
        safeErrorResponse(res, 409, hash.reason);
        return;
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(chunkResult.chunk.size));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(chunkPath, error => {
        if (error && !res.headersSent) safeErrorResponse(res, 500, 'chunk_send_failed');
    });
});

app.get('/api/volare/asset/:assetId', limiters.asset, (req, res) => {
    const access = validateProtectedAssetRequest({ req, assetId: req.params.assetId, config });
    if (!access.ok) {
        safeErrorResponse(res, access.status || 401, access.reason);
        return;
    }

    const record = loadProtectedAssetRecord(protectedRoot, req.params.assetId);
    if (!record.ok) {
        safeErrorResponse(res, record.status || 404, record.reason);
        return;
    }

    const signedManifest = buildManifestFromHeaders(record.record, req);
    const manifest = verifySignedManifest(signedManifest, config.secret);
    if (!manifest.ok) {
        safeErrorResponse(res, 401, manifest.reason);
        return;
    }

    const hash = verifyAssetHash(record.record.filePath, record.record.sha256);
    if (!hash.ok) {
        safeErrorResponse(res, 409, hash.reason);
        return;
    }

    res.setHeader('Content-Type', record.record.contentType);
    res.setHeader('Content-Length', String(record.record.size));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(record.record.filePath, error => {
        if (error && !res.headersSent) safeErrorResponse(res, 500, 'asset_send_failed');
    });
});

app.use('/node_modules', (req, res) => {
    res.sendStatus(404);
});
app.use('/server', (req, res) => {
    res.sendStatus(404);
});
app.use('/security', (req, res) => {
    res.sendStatus(404);
});
app.use('/tests', (req, res) => {
    res.sendStatus(404);
});
app.use('/tools', (req, res) => {
    res.sendStatus(404);
});

app.use(['/protected-assets', '/server-assets'], (req, res) => {
    safeErrorResponse(res, 404, 'not_found');
});

app.use(express.static(publicRoot, {
    dotfiles: 'deny',
    etag: true,
    fallthrough: true,
    index: false,
    maxAge: config.mode === 'production' ? '1h' : 0,
    setHeaders(res) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
    }
}));

app.get('/', (req, res) => {
    // Redirect (not sendFile) so the browser's location actually becomes
    // /DEMO/, letting the page's own relative asset paths (./scripts/...,
    // ./models/...) resolve against the right base instead of against '/'.
    res.redirect('/DEMO/index.html');
});

app.use((req, res) => {
    safeErrorResponse(res, 404, 'not_found');
});

app.use((error, req, res, next) => {
    if (res.headersSent) {
        next(error);
        return;
    }
    const status = error.message === 'Origin not allowed' ? 403 : 500;
    safeErrorResponse(res, status, status === 403 ? 'origin_not_allowed' : 'server_error');
});

return app;
}

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const iface of Object.values(interfaces)) {
        for (const config of iface) {
            if (
                config.family === 'IPv4' &&
                !config.internal &&
                !config.address.startsWith('169.254')
            ) {
                return config.address;
            }
        }
    }
    return 'localhost';
}

if (require.main === module) {
const app = createApp();
app.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log(`Server is running on http://${ip}:${PORT}`);
    console.log(`[SECURITY] mode=${securityConfig.mode} configured=${securityConfig.securityConfigured}`);
    if (securityConfig.devFallback) {
        console.warn('[SECURITY] Development fallback signing key is active. Set VOLARE_SECURITY_SECRET for production.');
    }
});
}

module.exports = {
    createApp,
    publicRoot,
    protectedRoot
};
