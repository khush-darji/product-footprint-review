/**
 * The application's error vocabulary.
 *
 * Services throw these; the error handler is the one place that turns them into status
 * codes. Anything that is not an `AppError` reaching the handler is treated as a bug and
 * reported to the client as a generic 500 — driver messages and stack traces stay in the
 * logs, where they do not help an attacker map the schema.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

/** 400 — the request was understood but the content is not acceptable. */
export class ValidationError extends AppError {
  constructor(message = "Invalid request", details?: unknown) {
    super(message, 400, "validation_failed", details);
  }
}

/** 401 — we do not know who the caller is. */
export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, 401, "unauthorized");
  }
}

/** 403 — we know who the caller is, and the answer is no. */
export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, 403, "forbidden");
  }
}

/** 404 — no such record, or none this caller is allowed to know about. */
export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, 404, "not_found");
  }
}

/** 409 — the request conflicts with the current state of the record. */
export class ConflictError extends AppError {
  constructor(message = "Conflict", details?: unknown) {
    super(message, 409, "conflict", details);
  }
}

/** 503 — a dependency this request needs is unavailable. */
export class ServiceUnavailableError extends AppError {
  constructor(message = "Service unavailable") {
    super(message, 503, "service_unavailable");
  }
}
