export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}
export const requestId = () => crypto.randomUUID();
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-Lumi-Request", "1");
  if (init.body && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(
      data.message || "Không thể kết nối. Vui lòng thử lại.",
      data.code || "REQUEST_FAILED",
      response.status,
    );
  }
  return response.json() as Promise<T>;
}
export function mutation(body?: unknown, key?: string): RequestInit {
  return {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: key ? { "Idempotency-Key": key } : undefined,
  };
}
