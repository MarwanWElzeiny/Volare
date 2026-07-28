const DEFAULT_BASE_URL = 'http://localhost/';

function normalizeBaseUrl(baseUrl = globalThis.location?.href) {
  if (!baseUrl) {
    return DEFAULT_BASE_URL;
  }

  try {
    const parsed = new URL(baseUrl, DEFAULT_BASE_URL);
    const pathname = parsed.pathname.replace(/\/+$|index\.html$/i, '');
    const segments = pathname.split('/').filter(Boolean);

    if (segments.length === 0) {
      return `${parsed.origin}/`;
    }

    if (segments[segments.length - 1].toLowerCase() === 'demo' || segments[segments.length - 1].toLowerCase() === 'demo') {
      segments.pop();
    }

    const basePath = segments.length > 0 ? `/${segments.join('/')}/` : '/';
    return `${parsed.origin}${basePath}`;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

function getBaseUrl(baseUrl = globalThis.location?.href) {
  return normalizeBaseUrl(baseUrl);
}

export function resolveAssetUrl(assetPath, baseUrl = globalThis.location?.href) {
  if (!assetPath || typeof assetPath !== 'string') {
    return assetPath;
  }

  if (
    assetPath.startsWith('#') ||
    assetPath.startsWith('mailto:') ||
    assetPath.startsWith('data:') ||
    assetPath.startsWith('javascript:') ||
    /^(?:[a-z]+:)?\/\//i.test(assetPath)
  ) {
    return assetPath;
  }

  const resolvedBaseUrl = getBaseUrl(baseUrl);

  try {
    if (assetPath.startsWith('/')) {
      return new URL(assetPath.replace(/^\/+/, ''), resolvedBaseUrl).toString();
    }

    if (assetPath.startsWith('./') || assetPath.startsWith('../')) {
      return new URL(assetPath, baseUrl || resolvedBaseUrl).toString();
    }

    return new URL(assetPath, resolvedBaseUrl).toString();
  } catch {
    return assetPath;
  }
}

export function getDeploymentBaseUrl(baseUrl = globalThis.location?.href) {
  return getBaseUrl(baseUrl);
}
