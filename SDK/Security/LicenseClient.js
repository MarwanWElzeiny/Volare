export class LicenseError extends Error {
    constructor(message, code, status) {
        super(message);
        this.name = 'LicenseError';
        this.code = code;
        this.status = status;
    }
}

export class LicenseClient {
    constructor({ baseUrl = '', fetchImpl = globalThis.fetch } = {}) {
        this._base = baseUrl;
        this._fetch = fetchImpl;
    }

    async requestLicense({ assetId, nonce, clientId, signal } = {}) {
        if (!assetId) throw new LicenseError('assetId is required', 'invalid_request', 0);
        if (!nonce) throw new LicenseError('nonce is required', 'invalid_request', 0);

        const url = `${this._base}/api/volare/license`;

        let response;
        try {
            response = await this._fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Volare-Nonce': nonce
                },
                body: JSON.stringify({ assetId, nonce, clientId }),
                signal
            });
        } catch (err) {
            throw new LicenseError(`License request failed: ${err.message}`, 'network_error', 0);
        }

        if (response.status === 429) {
            throw new LicenseError('Rate limit exceeded — retry after a moment', 'rate_limited', 429);
        }
        if (response.status === 401) {
            let body = null;
            try { body = await response.json(); } catch { /* proxy may return HTML */ }
            throw new LicenseError(body?.error || 'Unauthorized', body?.error || 'unauthorized', 401);
        }
        if (response.status === 403) {
            let body = null;
            try { body = await response.json(); } catch { /* proxy may return HTML */ }
            throw new LicenseError(body?.error || 'Forbidden', body?.error || 'forbidden', 403);
        }

        let body;
        try {
            body = await response.json();
        } catch {
            throw new LicenseError('License response was not valid JSON', 'invalid_response', response.status);
        }

        if (!response.ok) {
            throw new LicenseError(body?.error || 'License request failed', body?.error || 'request_failed', response.status);
        }
        if (!body?.success || !body?.token) {
            throw new LicenseError('Invalid license response shape', 'invalid_response', response.status);
        }

        return {
            token: body.token,
            tokenType: body.tokenType || 'Bearer',
            expiresIn: body.expiresIn,
            assetId: body.assetId,
            requestId: body.requestId
        };
    }
}
