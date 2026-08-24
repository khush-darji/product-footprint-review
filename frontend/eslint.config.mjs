import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

// eslint-config-next ships native flat configs as of Next 16, so they spread in
// directly — no FlatCompat shim needed.
const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...nextCoreWebVitals,
  ...nextTypeScript,
];

export default config;
