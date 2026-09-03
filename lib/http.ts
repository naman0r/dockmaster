import { CommandError } from "./exec";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class GuardError extends HttpError {
  constructor(message: string, status = 403) {
    super(status, message);
  }
}

export function errorJson(err: unknown): Response {
  if (err instanceof HttpError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof CommandError) {
    return Response.json({ error: err.message }, { status: 503 });
  }
  console.error("[dockmaster]", err);
  return Response.json({ error: "Request failed." }, { status: 500 });
}

export async function readJsonBody(req: Request): Promise<unknown> {
  const length = Number(req.headers.get("content-length") || "0");
  if (!Number.isFinite(length) || length <= 0 || length > 64 * 1024) {
    throw new HttpError(400, "Request body must be between 1 and 64KiB.");
  }
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Request body is not valid JSON.");
  }
}

export function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw new HttpError(400, `${field} must be a non-empty string.`);
  }
  return value;
}

export function asInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new HttpError(400, `${field} must be an integer.`);
  }
  return value;
}

export function asBool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new HttpError(400, `${field} must be a boolean.`);
  }
  return value;
}
