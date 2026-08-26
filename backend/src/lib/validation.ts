/**
 * Validation at the HTTP boundary.
 *
 * `parse()` is the only thing in the codebase that runs a Joi schema. A handler calls it
 * on its first line, so the raw request is converted to a typed value before anything
 * else happens, and a failure throws — Express 5 forwards a rejected async handler to the
 * error middleware, so every rejection comes back in the same 400 envelope without a
 * single `try/catch` in a route.
 *
 * The type comes back from the schema itself. Schemas are declared as
 * `Joi.object<CreateFootprintInput>({...})`, so `parse(createFootprintSchema, req.body)`
 * infers its result and the shape is written down exactly once.
 *
 * The options are the interesting part, because each one is a property the API depends on:
 *
 *  - **`stripUnknown`** is what prevents mass assignment. A key no schema names is
 *    removed before the value reaches a service, so a client cannot approve its own
 *    submission by posting `{ status: "approved" }` to the create endpoint. Note it
 *    *drops* unknown keys rather than rejecting them, so a client still sending a field
 *    the API has retired keeps working — and that field still cannot reach the database.
 *  - **`abortEarly: false`** reports every problem at once, so a client fixes its request
 *    in one round trip rather than one field per attempt.
 *  - **`convert`** (Joi's default) is what lets a query string — where everything arrives
 *    as text — yield a real number and a real boolean.
 *
 * The rest of this file is the shared rule vocabulary the schemas are assembled from, so
 * that a bound or a message is defined once rather than re-typed per field. Bounds are
 * not cosmetic: an unbounded string or array is a denial of service that needs no
 * exploit, so every rule below carries a limit.
 */
import Joi from "joi";
import { ValidationError } from "./errors";

const OPTIONS: Joi.ValidationOptions = {
  abortEarly: false,
  stripUnknown: true,
  convert: true,
  // Joi quotes labels as "value" by default; the rules below write messages as whole
  // sentences naming the field, so the quoting only gets in the way.
  errors: { wrap: { label: false } },
};

/**
 * Joi reports a path as segments — `["ids", 1]` — but the error envelope carries a
 * string, and a client needs to know *which* element of an array was wrong. Numbers
 * become `[1]` and names are dot-joined, so `ids[1]` and `page.size` read the way a
 * developer would write them.
 */
function formatPath(segments: readonly (string | number)[]): string {
  return segments.reduce<string>((acc, segment) => {
    if (typeof segment === "number") return `${acc}[${segment}]`;
    return acc.length > 0 ? `${acc}.${segment}` : segment;
  }, "");
}

/** Validates one part of a request, or throws the 400 the error handler turns into JSON. */
export function parse<T>(schema: Joi.ObjectSchema<T>, input: unknown): T {
  // `ValidationResult` is a union whose failure branch types `value` as `any`, so the
  // error is checked before `value` is touched.
  const result = schema.validate(input, OPTIONS);
  if (result.error) {
    throw new ValidationError(
      "Invalid request",
      result.error.details.map((detail) => ({
        path: formatPath(detail.path),
        message: detail.message,
      })),
    );
  }
  return result.value;
}

/**
 * RFC 4122 v4, which is what `PrimaryGeneratedColumn("uuid")` produces.
 *
 * The message uses Joi's own label rather than a caller-supplied one, because the label
 * is the only thing that knows *where* the value sat: `id` for an object key, but
 * `ids[3]` for the fourth element of an array. Hardcoding a name would tell a client
 * which field was wrong but not which of its hundred ids.
 */
const uuidRule = Joi.string()
  .guid({ version: "uuidv4" })
  .messages({
    "any.required": "{{#label}} must be a UUID",
    "string.base": "{{#label}} must be a UUID",
    "string.empty": "{{#label}} must be a UUID",
    "string.guid": "{{#label}} must be a UUID",
  });

/** A required UUID, for an object key. */
export const uuid = () => uuidRule.required();

/**
 * A UUID as an element of an array — deliberately *not* required.
 *
 * `.required()` means something different inside `.items()`: it makes the item a value
 * the array must **contain**, so one malformed element produces a second, confusing
 * error against the array itself ("does not contain 1 required value(s)") on top of the
 * one against the element. Emptiness is `.min(1)`'s job, not the item's.
 */
export const uuidItem = () => uuidRule;

/**
 * Deliberately permissive. A regex cannot decide whether an address is real — only
 * delivery can — so this rejects the obviously malformed and leaves the rest to the
 * lookup that follows. `tlds: false` keeps Joi from consulting its built-in TLD list,
 * which would reject perfectly valid internal domains.
 */
export const email = (message: string, max = 200) =>
  Joi.string()
    .trim()
    .max(max)
    .email({ tlds: false })
    .required()
    .messages({
      "any.required": message,
      "string.base": message,
      "string.empty": message,
      "string.email": message,
      "string.max": `email must be at most ${max} characters`,
    });

/** A required, trimmed, length-bounded string. */
export const text = (label: string, max: number, message?: string) =>
  Joi.string()
    .trim()
    .max(max)
    .required()
    .messages({
      "any.required": message ?? `${label} is required`,
      "string.base": message ?? `${label} is required`,
      "string.empty": message ?? `${label} is required`,
      "string.max": `${label} must be at most ${max} characters`,
    });

/**
 * An optional query string value, where empty means absent.
 *
 * `?q=` and no `q` at all mean the same thing to a filter, so `.empty("")` collapses
 * them into `undefined` rather than searching for the empty string.
 */
export const optionalText = (label: string, max: number) =>
  Joi.string()
    .trim()
    .empty("")
    .max(max)
    .messages({ "string.max": `${label} must be at most ${max} characters` });

/**
 * Free text where an empty string means "not provided", not "set to empty" — so clearing
 * a comment and omitting one land in the database identically. An explicit `null` is
 * allowed and preserved, which is what lets an update *clear* a field.
 *
 * No default: a create schema adds `.default(null)` so the column is written, while an
 * update schema leaves it off so an absent key stays absent and the column is untouched.
 * That distinction is the whole difference between "clear this" and "leave it alone".
 */
export const nullableText = (label: string, max: number) =>
  Joi.string()
    .trim()
    .empty("")
    .max(max)
    .allow(null)
    .messages({
      "string.base": `${label} must be text`,
      "string.max": `${label} must be at most ${max} characters`,
    });

export const boundedNumber = (label: string, min: number, max: number) =>
  Joi.number()
    .min(min)
    .max(max)
    .required()
    .messages({
      "any.required": `${label} must be a number`,
      "number.base": `${label} must be a number`,
      "number.min": `${label} must be at least ${min}`,
      "number.max": `${label} must be at most ${max}`,
    });

/** A query-string integer with a default, e.g. `limit`. */
export const boundedInt = (label: string, min: number, max: number, fallback: number) =>
  Joi.number()
    .integer()
    .min(min)
    .max(max)
    .default(fallback)
    .messages({
      "number.base": `${label} must be a number`,
      "number.integer": `${label} must be a whole number`,
      "number.min": `${label} must be at least ${min}`,
      "number.max": `${label} must be at most ${max}`,
    });

/**
 * One of a fixed set.
 *
 * `values` is typed `readonly T[]` so the allowlists in `domain/` can be passed straight
 * in — the set the API accepts and the set the domain defines are then the same object,
 * and adding a member in one place without the other is a compile error.
 */
export const oneOf = <T extends string>(
  label: string,
  values: readonly T[],
  message?: string,
) => {
  const fallbackMessage =
    message ?? `${label} must be one of ${values.map((v) => `"${v}"`).join(", ")}`;
  return Joi.string()
    .valid(...values)
    .messages({
      "any.required": fallbackMessage,
      "any.only": fallbackMessage,
      "string.base": fallbackMessage,
      "string.empty": fallbackMessage,
    });
};
