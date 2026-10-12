// Canonical local origin. IndexedDB, permissions and Web Locks are scoped per
// origin, so http://127.0.0.1:4173 would be a different, empty store. Both the
// dev server and the production server redirect to this origin.
export const CANONICAL_HOST = "localhost";
export const PORT = 4173;
export const BIND_ADDRESS = "127.0.0.1";
export const CANONICAL_ORIGIN = `http://${CANONICAL_HOST}:${PORT}`;

/** Returns the redirect target, null when the host header is canonical, or "reject". */
export function canonicalRedirect(hostHeader, url) {
  if (hostHeader === `${CANONICAL_HOST}:${PORT}`) return null;
  if (hostHeader === `127.0.0.1:${PORT}` || hostHeader === `[::1]:${PORT}`) {
    return `${CANONICAL_ORIGIN}${url ?? "/"}`;
  }
  return "reject";
}
