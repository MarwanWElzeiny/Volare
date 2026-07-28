import { LicenseClient, LicenseError } from './LicenseClient.js';
import { ManifestClient, ManifestError } from './ManifestClient.js';

export { LicenseError, ManifestError };

export class AssetError extends Error {
    constructor(message, code, status) {
        super(message);
        this.name = 'AssetError';
        this.code = code;
        this.status = status;
    }
}

export class ProtectedAssetClient {
    constructor({ baseUrl = '', fetchImpl = globalThis.fetch } = {}) {
        this._base = baseUrl;
        this._fetch = fetchImpl;
        this._license = new LicenseClient({ baseUrl, fetchImpl });
        this._manifest = new ManifestClient({ baseUrl, fetchImpl });
    }

    async requestLicense(opts) {
        return this._license.requestLicense(opts);
    }

    async fetchManifest(opts) {
        return this._manifest.fetchManifest(opts);
    }

    async fetchAsset({ assetId, token, nonce, manifest, signal } = {}) {
        if (!assetId) throw new AssetError('assetId is required', 'invalid_request', 0);
        if (!token) throw new AssetError('token is required', 'invalid_request', 0);
        if (!nonce) throw new AssetError('nonce is required', 'invalid_request', 0);
        if (!manifest?.signature) throw new AssetError('manifest with signature is required', 'invalid_request', 0);

        const url = `${this._base}/api/volare/asset/${encodeURIComponent(assetId)}`;

        let response;
        try {
            response = await this._fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Volare-Nonce': nonce,
                    'X-Volare-Manifest-Signature': manifest.signature,
                    'X-Volare-Manifest-Expiry': manifest.expiresAt || ''
                },
                signal
            });
        } catch (err) {
            throw new AssetError(`Asset request failed: ${err.message}`, 'network_error', 0);
        }

        if (response.status === 429) {
            throw new AssetError('Rate limit exceeded — retry after a moment', 'rate_limited', 429);
        }
        if (response.status === 401 || response.status === 403) {
            let body = null;
            try { body = await response.json(); } catch { /* ignore */ }
            throw new AssetError(body?.error || 'Access denied', body?.error || 'access_denied', response.status);
        }
        if (!response.ok) {
            throw new AssetError('Asset request failed', 'request_failed', response.status);
        }

        return response.arrayBuffer();
    }

    async fetchChunk({ assetId, index, token, nonce, signal } = {}) {
        if (!assetId) throw new AssetError('assetId is required', 'invalid_request', 0);
        if (index === undefined || index === null) throw new AssetError('index is required', 'invalid_request', 0);
        if (!token) throw new AssetError('token is required', 'invalid_request', 0);
        if (!nonce) throw new AssetError('nonce is required', 'invalid_request', 0);

        const url = `${this._base}/api/volare/chunk/${encodeURIComponent(assetId)}/${encodeURIComponent(index)}`;

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
            throw new AssetError(`Chunk request failed: ${err.message}`, 'network_error', 0);
        }

        if (response.status === 429) {
            throw new AssetError('Rate limit exceeded — retry after a moment', 'rate_limited', 429);
        }
        if (response.status === 401 || response.status === 403) {
            let body = null;
            try { body = await response.json(); } catch { /* ignore */ }
            throw new AssetError(body?.error || 'Access denied', body?.error || 'access_denied', response.status);
        }
        if (!response.ok) {
            throw new AssetError('Chunk request failed', 'request_failed', response.status);
        }

        return response.arrayBuffer();
    }
}
