// Shared by the extension, the detached service, and the Pi-side input bridge.
// Keeping the service identity and the loopback guards in one place stops the
// three servers from drifting apart on what they consider a trusted request.
export const SERVICE_APP = "pi-review-console";
export const SERVICE_PROTOCOL = 6;

/** @param {number} port */
export function serviceOrigin(port) {
  return `http://127.0.0.1:${port}`;
}

// A request must address the loopback interface by its numeric address, so a
// DNS name cannot be rebound to this port by another site.
/** @param {import("node:http").IncomingMessage} request @param {number} port */
export function hasServiceHost(request, port) {
  return request.headers.host === `127.0.0.1:${port}`;
}

// A browser adds Origin to cross-origin requests. Same-origin requests and
// non-browser clients leave it out, which is why only a mismatch is rejected.
/** @param {import("node:http").IncomingMessage} request @param {string} origin */
export function isCrossOrigin(request, origin) {
  const supplied = request.headers.origin;
  return supplied !== undefined && supplied !== origin;
}

/** @param {import("node:http").IncomingMessage} request */
export function bearerToken(request) {
  const header = request.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

