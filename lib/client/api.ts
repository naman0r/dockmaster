let token = "";

export function setApiToken(value: string): void {
  token = value;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "X-Dockmaster-Token": token,
  };
  if (init?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
  });

  if (res.status === 401) {
    // The server was restarted and its token rotated; one automatic reload
    // picks up the fresh token embedded in the new page. 403s are action
    // refusals (protected process, default branch) and must surface as errors.
    try {
      const last = Number(sessionStorage.getItem("dm-auth-reload") || "0");
      if (Date.now() - last > 10000) {
        sessionStorage.setItem("dm-auth-reload", String(Date.now()));
        window.location.reload();
      }
    } catch {
      // sessionStorage can be unavailable; fall through to the error below.
    }
  }

  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new ApiError(res.status, payload.error || `Request failed (${res.status})`);
  }
  return payload as T;
}

export function apiGet<T>(url: string): Promise<T> {
  return request<T>(url);
}

export function apiPost<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, { method: "POST", body: JSON.stringify(body ?? {}) });
}

export function apiDelete<T>(url: string): Promise<T> {
  return request<T>(url, { method: "DELETE" });
}
