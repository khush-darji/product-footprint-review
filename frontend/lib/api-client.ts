/**
 * The only place the frontend talks to the API.
 *
 * Every call goes through `request()`, so authentication, error handling, the JSON error
 * envelope and abort support are defined once rather than re-derived in each component.
 */
import type {
  ApiErrorBody,
  BulkReviewResult,
  FootprintListResponse,
  FootprintStats,
  ProductFootprint,
  QueueScope,
  ReviewDecision,
  ReviewEvent,
  ReviewStatus,
  Share,
  ShareableRole,
  SortKey,
  SortOrder,
  User,
} from "./types";

/**
 * Inlined into the client bundle at build time by Next.js, which is why the Docker build
 * takes it as a build arg rather than a runtime environment variable.
 */
const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(
  /\/+$/,
  "",
);

const API_PREFIX = "/api/v1";

/**
 * The session travels in an httpOnly cookie, so there is nothing for this module to
 * store or attach — `credentials: "include"` tells the browser to send it, and page
 * JavaScript never sees the value. That is the point: an XSS bug cannot read a cookie it
 * has no access to.
 *
 * The cost is that every request must opt in, and the API must allowlist this origin
 * with `credentials: true`. Both are wired up; see `backend/src/app.ts`.
 */

/** An error carrying what the API actually said, so the UI can explain the failure. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
    /** Field-level validation problems, when the API supplied them. */
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** A message worth showing a user, with field detail folded in when present. */
  get userMessage(): string {
    if (!this.details?.length) return this.message;
    return this.details
      .map((detail) => (detail.path ? `${detail.path}: ${detail.message}` : detail.message))
      .join("; ");
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, signal } = options;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${API_PREFIX}${path}`, {
      method,
      signal,
      // Sends the session cookie cross-origin. Without this every request is anonymous.
      credentials: "include",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    // fetch only rejects when the request never completed — the API is down, DNS failed,
    // or CORS blocked it. Worth distinguishing from a 4xx/5xx below.
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError("Could not reach the API. Is the backend running?", 0, "network_error");
  }

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const envelope = payload as ApiErrorBody | null;
    throw new ApiError(
      envelope?.error?.message ?? `Request failed with status ${response.status}`,
      response.status,
      envelope?.error?.code ?? "unknown",
      envelope?.error?.requestId,
      envelope?.error?.details,
    );
  }

  return payload as T;
}

/* --- identity ------------------------------------------------------------------- */

export interface SignInResult {
  user: User;
  expiresAt: string;
}

/** Sets the session cookie on success. The token itself never reaches this code. */
export function signIn(email: string, password: string): Promise<SignInResult> {
  return request<SignInResult>("/auth/login", {
    method: "POST",
    body: { email, password },
  });
}

/** Clears the session server-side, which is what makes revocation immediate. */
export function signOut(): Promise<void> {
  return request<void>("/auth/logout", { method: "POST" });
}

export function getCurrentUser(signal?: AbortSignal): Promise<User> {
  return request<User>("/auth/me", { signal });
}

export function listUsers(signal?: AbortSignal): Promise<{ items: User[] }> {
  return request<{ items: User[] }>("/users", { signal });
}

/* --- footprints ----------------------------------------------------------------- */

export interface ListFootprintsParams {
  status?: ReviewStatus | "all";
  q?: string;
  scope?: QueueScope;
  highRiskOnly?: boolean;
  sort?: SortKey;
  order?: SortOrder;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export function listFootprints(
  params: ListFootprintsParams = {},
): Promise<FootprintListResponse> {
  const { signal, ...filters } = params;
  const search = new URLSearchParams();

  if (filters.status && filters.status !== "all") search.set("status", filters.status);
  if (filters.q) search.set("q", filters.q);
  if (filters.scope && filters.scope !== "all") search.set("scope", filters.scope);
  if (filters.highRiskOnly) search.set("highRiskOnly", "true");
  if (filters.sort) search.set("sort", filters.sort);
  if (filters.order) search.set("order", filters.order);
  if (filters.limit) search.set("limit", String(filters.limit));
  if (filters.cursor) search.set("cursor", filters.cursor);

  const query = search.toString();
  return request<FootprintListResponse>(`/footprints${query ? `?${query}` : ""}`, { signal });
}

export function getFootprint(id: string, signal?: AbortSignal): Promise<ProductFootprint> {
  return request<ProductFootprint>(`/footprints/${id}`, { signal });
}

export function getStats(signal?: AbortSignal): Promise<FootprintStats> {
  return request<FootprintStats>("/footprints/stats", { signal });
}

export function reviewFootprint(
  id: string,
  decision: ReviewDecision,
  comment?: string,
): Promise<ProductFootprint> {
  return request<ProductFootprint>(`/footprints/${id}/review`, {
    method: "POST",
    body: { decision, comment: comment?.trim() || null },
  });
}

/**
 * Decide several submissions at once, with one comment recorded against all of them.
 *
 * Resolves rather than throws when some ids could not be decided — the result carries
 * `succeeded` and `failed`, and a caller that only checks for a thrown error will report
 * a partial batch as a complete success.
 */
export function bulkReviewFootprints(
  ids: string[],
  decision: ReviewDecision,
  comment?: string,
): Promise<BulkReviewResult> {
  return request<BulkReviewResult>("/footprints/bulk-review", {
    method: "POST",
    body: { ids, decision, comment: comment?.trim() || null },
  });
}

export function listReviewEvents(
  id: string,
  signal?: AbortSignal,
): Promise<{ items: ReviewEvent[] }> {
  return request<{ items: ReviewEvent[] }>(`/footprints/${id}/reviews`, { signal });
}

/* --- sharing --------------------------------------------------------------------- */

export function listShares(id: string, signal?: AbortSignal): Promise<{ items: Share[] }> {
  return request<{ items: Share[] }>(`/footprints/${id}/shares`, { signal });
}

export function grantShare(id: string, email: string, role: ShareableRole): Promise<Share> {
  return request<Share>(`/footprints/${id}/shares`, {
    method: "POST",
    body: { email, role },
  });
}

export function revokeShare(id: string, userId: string): Promise<void> {
  return request<void>(`/footprints/${id}/shares/${userId}`, { method: "DELETE" });
}
