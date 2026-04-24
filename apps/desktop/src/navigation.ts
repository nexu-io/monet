const desktopRendererScheme = "app:";
const desktopRendererHost = "monet";

function parseUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizeScopedPathname(pathname: string) {
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

export function isAllowedMainWindowNavigation(targetUrl: string, rendererUrl?: string | null) {
  const target = parseUrl(targetUrl);

  if (!target) {
    return false;
  }

  if (target.protocol === desktopRendererScheme && target.hostname === desktopRendererHost) {
    return true;
  }

  const devRenderer = rendererUrl?.trim() ? parseUrl(rendererUrl.trim()) : null;

  if (!devRenderer || !/^https?:$/.test(devRenderer.protocol)) {
    return false;
  }

  if (target.origin !== devRenderer.origin) {
    return false;
  }

  if (target.pathname === devRenderer.pathname) {
    return true;
  }

  return target.pathname.startsWith(normalizeScopedPathname(devRenderer.pathname));
}

export function shouldOpenNavigationExternally(targetUrl: string) {
  const target = parseUrl(targetUrl);

  if (!target) {
    return false;
  }

  return target.protocol !== "file:";
}
