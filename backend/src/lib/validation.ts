/**
 * The rule vocabulary the schemas are built from.
 *
 * No Joi is *run* here — `middleware/validate.ts` is the only place that calls
 * `validate()`. These are just the shared, bounded building blocks, so that a limit or
 * a message is defined once rather than re-typed per field.
 *
 * Bounds are not cosmetic. An unbounded string or array is a denial of service that
 * needs no exploit, so every rule below carries a limit and every schema is built from
 * these rather than from bare Joi types.
 */
import Joi from "joi";

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
