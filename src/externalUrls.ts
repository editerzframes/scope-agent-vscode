export function isSafeExternalUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function isSafeClickUpTicketUrl(value: unknown): value is string {
  if (!isSafeExternalUrl(value)) {
    return false;
  }
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    url.hostname.toLowerCase() === "app.clickup.com" &&
    /^\/t\/[a-z0-9_-]+\/?$/i.test(url.pathname)
  );
}
