import type { ValueTransformer } from "typeorm";

/**
 * Postgres `numeric` arrives from the `pg` driver as a string, because it is an
 * arbitrary-precision type that does not always fit an IEEE double. Without this
 * transformer, `emissionsValue` would be `"612.000"` and every comparison and bit of
 * arithmetic downstream would be quietly wrong.
 *
 * The values here (emissions in kg CO2e, a percentage) are well inside the safe integer
 * range at the scales we store, so converting to `number` is sound. A monetary column
 * would want a different answer.
 */
export const numericTransformer: ValueTransformer = {
  to: (value: number | null | undefined): number | null => value ?? null,
  from: (value: string | number | null): number | null => {
    if (value === null || value === undefined) return null;
    return typeof value === "number" ? value : Number.parseFloat(value);
  },
};
