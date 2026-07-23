export class ManifestError extends Error {
    constructor(message, code, status) {
        super(message);
        this.name = 'ManifestError';
        this.code = code;
        this.status = status;
    }
}

export class ManifestClient {
    constructor({ baseUrl = '', fetchImpl = globalThis.fetch } = {}) {
        this._base = baseUrl;
        this._fetch = fetchImpl;
    }

    async fetchManifest({ assetId, token, nonce, signal } = {}) {
        if (!assetId) throw new ManifestError('assetId is required', 'invalid_request', 0);
        if (!token) throw new ManifestError('token is required', 'invalid_request', 0);
        if (!nonce) throw new ManifestError('nonce is required', 'invalid_request', 0);

        const url = `${this._base}/api/volare/manifest/${encodeURIComponent(assetId)}`;

        let response;
        try {
            response = await this._fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Volare-Nonce': nonce
                },
                signal
            });
        } catch (err) {
            throw new ManifestError(`Manifest request failed: ${err.message}`, 'network_error', 0);
        }

        if (response.status === 429) {
            throw new ManifestError('Rate limit exceeded — retry after a moment', 'rate_limited', 429);
        }
        if (response.status === 401) {
            let body = null;
            try { body = await response.json(); } catch { /* proxy may return HTML */ }
            throw new ManifestError(body?.error || 'Unauthorized', body?.error || 'unauthorized', 401);
        }
        if (response.status === 403) {
            let body = null;
            try { body = await response.json(); } catch { /* proxy may return HTML */ }
            throw new ManifestError(body?.error || 'Forbidden', body?.error || 'forbidden', 403);
        }

        let body;
        try {
            body = await response.json();
        } catch {
            throw new ManifestError('Manifest response was not valid JSON', 'invalid_response', response.status);
        }

        if (!response.ok) {
            throw new ManifestError(body?.error || 'Manifest request failed', body?.error || 'request_failed', response.status);
        }

        const manifest = body?.manifest;
        if (!manifest || !manifest.assetId) {
            throw new ManifestError('Invalid manifest shape', 'invalid_response', response.status);
        }

        return manifest;
    }
}
