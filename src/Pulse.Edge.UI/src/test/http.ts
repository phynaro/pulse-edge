// Minimal Response fakes for component tests. They implement only the surface
// the components actually touch (ok/status/json/blob/headers), which keeps the
// fetch mocks readable without pulling in a full network stub library.

export function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

export function blobResponse(
  status: number,
  blob: Blob,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    blob: async () => blob,
    headers: new Headers(headers),
  } as unknown as Response;
}
