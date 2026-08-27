/**
 * Request validation, hand-rolled.
 *
 * `Fields` collects every problem instead of throwing on the first, so a client gets the
 * whole list back in one response rather than fixing one field per round trip. Each
 * reader returns a typed value and records an issue when the input is wrong.
 *
 * The important property is what the *parsers* built on this do: they construct their
 * result field by field, so a key nobody asked for cannot survive into the output. That
 * is what stops a client sending `{ status: "approved" }` to an endpoint that has no
 * business accepting it — mass assignment is prevented by never copying the input
 * object, not by filtering it afterwards.
 */
import { ValidationError } from "./errors";

export interface ValidationIssue {
  path: string;
  message: string;
}

/** RFC 4122 v4, which is what `PrimaryGeneratedColumn("uuid")` produces. */
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Deliberately permissive. A regex cannot decide whether an address is real — only
 * delivery can — so this rejects the obviously malformed and leaves the rest to the
 * lookup that follows.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class Fields {
  private readonly issues: ValidationIssue[] = [];
  private readonly source: Record<string, unknown>;

  constructor(input: unknown) {
    // A JSON body can legitimately be any type; anything that is not an object has no
    // fields to read, so every required reader will report itself missing.
    this.source =
      typeof input === "object" && input !== null && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {};
  }

  private raw(path: string): unknown {
    return this.source[path];
  }

  private add(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  /** Records a problem discovered by the caller, e.g. a cross-field rule. */
  reject(path: string, message: string): void {
    this.add(path, message);
  }

  private present(path: string): boolean {
    const value = this.raw(path);
    return value !== undefined && value !== null && value !== "";
  }

  string(
    path: string,
    opts: { min?: number; max: number; message?: string } = { max: 255 },
  ): string {
    const value = this.raw(path);
    if (typeof value !== "string") {
      this.add(path, opts.message ?? `${path} is required`);
      return "";
    }

    const trimmed = value.trim();
    const min = opts.min ?? 1;
    if (trimmed.length < min) {
      this.add(path, opts.message ?? `${path} is required`);
      return trimmed;
    }
    if (trimmed.length > opts.max) {
      this.add(path, `${path} must be at most ${opts.max} characters`);
    }
    return trimmed;
  }

  optionalString(path: string, opts: { max: number }): string | undefined {
    if (!this.present(path)) return undefined;
    return this.string(path, { max: opts.max });
  }

  /**
   * Free text where an empty string means "not provided", not "set to empty" — so
   * clearing a comment and omitting one land in the database identically.
   */
  nullableText(path: string, opts: { max: number }): string | null {
    const value = this.raw(path);
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") {
      this.add(path, `${path} must be text`);
      return null;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.length > opts.max) {
      this.add(path, `${path} must be at most ${opts.max} characters`);
    }
    return trimmed;
  }

  number(path: string, opts: { min: number; max: number; integer?: boolean }): number {
    const value = this.raw(path);
    if (typeof value !== "number" || !Number.isFinite(value)) {
      this.add(path, `${path} must be a number`);
      return opts.min;
    }
    if (opts.integer && !Number.isInteger(value)) {
      this.add(path, `${path} must be a whole number`);
      return opts.min;
    }
    if (value < opts.min) {
      this.add(path, `${path} must be at least ${opts.min}`);
    } else if (value > opts.max) {
      this.add(path, `${path} must be at most ${opts.max}`);
    }
    return value;
  }

  /**
   * A non-empty list of UUIDs, as a bulk endpoint takes.
   *
   * Each element is reported against its own index, so a client that sends one bad id
   * learns which one it was instead of being told "ids is invalid". The upper bound is
   * required rather than optional: an unbounded list is an unbounded amount of work for
   * one request, which is the same denial of service an unbounded page size would be.
   *
   * Duplicates are collapsed. Left in, the second copy of an id would be reviewed
   * against a row the first copy had just decided, and report itself as a conflict.
   */
  uuidArray(path: string, opts: { max: number }): string[] {
    const value = this.raw(path);
    if (!Array.isArray(value)) {
      this.add(path, `${path} must be an array of ids`);
      return [];
    }
    if (value.length === 0) {
      this.add(path, `${path} must contain at least one id`);
      return [];
    }
    if (value.length > opts.max) {
      this.add(path, `${path} must contain at most ${opts.max} ids`);
      return [];
    }

    const ids = new Set<string>();
    value.forEach((entry: unknown, index: number) => {
      if (typeof entry !== "string" || !UUID_V4.test(entry)) {
        this.add(`${path}[${index}]`, `${path}[${index}] must be a UUID`);
        return;
      }
      ids.add(entry);
    });
    return [...ids];
  }

  /**
   * Query strings carry everything as text, so a numeric query parameter has to be
   * coerced. `Number("")` is 0 and `Number("abc")` is NaN — both are rejected.
   */
  intFromQuery(
    path: string,
    opts: { min: number; max: number; fallback: number },
  ): number {
    if (!this.present(path)) return opts.fallback;

    const raw = this.raw(path);
    if (typeof raw !== "string" && typeof raw !== "number") {
      this.add(path, `${path} must be a number`);
      return opts.fallback;
    }

    const value = Number(raw);
    if (!Number.isInteger(value)) {
      this.add(path, `${path} must be a whole number`);
      return opts.fallback;
    }
    if (value < opts.min) {
      this.add(path, `${path} must be at least ${opts.min}`);
      return opts.fallback;
    }
    if (value > opts.max) {
      this.add(path, `${path} must be at most ${opts.max}`);
      return opts.fallback;
    }
    return value;
  }

  enum<T extends string>(
    path: string,
    allowed: readonly T[],
    opts: { fallback?: T; message?: string } = {},
  ): T {
    if (!this.present(path) && opts.fallback !== undefined) return opts.fallback;

    const value = this.raw(path);
    if (typeof value !== "string" || !allowed.includes(value as T)) {
      this.add(
        path,
        opts.message ??
          `${path} must be one of ${allowed.map((option) => `"${option}"`).join(", ")}`,
      );
      return opts.fallback ?? allowed[0]!;
    }
    return value as T;
  }

  /** `"true"` in a query string means true; anything else absent means the fallback. */
  boolFromQuery(path: string, fallback: boolean): boolean {
    if (!this.present(path)) return fallback;

    const value = this.raw(path);
    if (value === "true" || value === true) return true;
    if (value === "false" || value === false) return false;

    this.add(path, `${path} must be "true" or "false"`);
    return fallback;
  }

  uuid(path: string, message?: string): string {
    const value = this.raw(path);
    if (typeof value !== "string" || !UUID_V4.test(value)) {
      this.add(path, message ?? `${path} must be a UUID`);
      return "";
    }
    return value;
  }

  email(path: string, opts: { max: number; message?: string }): string {
    const value = this.raw(path);
    if (typeof value !== "string") {
      this.add(path, opts.message ?? `${path} must be an email address`);
      return "";
    }

    const trimmed = value.trim();
    if (trimmed.length > opts.max) {
      this.add(path, `${path} must be at most ${opts.max} characters`);
      return trimmed;
    }
    if (!EMAIL.test(trimmed)) {
      this.add(path, opts.message ?? `${path} must be an email address`);
    }
    return trimmed;
  }

  /**
   * An ISO 8601 timestamp. `new Date("nonsense")` is an Invalid Date rather than a
   * throw, so the NaN check is what actually does the rejecting.
   */
  optionalIsoDate(path: string, message: string): Date | undefined {
    if (!this.present(path)) return undefined;

    const value = this.raw(path);
    if (typeof value !== "string") {
      this.add(path, message);
      return undefined;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      this.add(path, message);
      return undefined;
    }
    return date;
  }

  /** True when the input carried a usable (non-empty) value for this field. */
  has(path: string): boolean {
    return this.present(path);
  }

  /**
   * True when the key was supplied at all, even as null or "".
   *
   * The difference from `has` matters for a nullable field: omitting `supplierNotes`
   * means "leave it alone", whereas sending `null` means "clear it".
   */
  hasKey(path: string): boolean {
    return Object.hasOwn(this.source, path);
  }

  get failed(): boolean {
    return this.issues.length > 0;
  }

  /**
   * Throws if anything went wrong. The error carries every issue, and the central error
   * handler turns it into a 400 with the same envelope every other failure uses.
   */
  done(): void {
    if (this.issues.length > 0) {
      throw new ValidationError("Invalid request", this.issues);
    }
  }
}
