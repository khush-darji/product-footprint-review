/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emits a self-contained server bundle with only the needed node_modules, which is
  // what keeps the runtime Docker image small and lets it run without `npm install`.
  output: "standalone",
  poweredByHeader: false,
  // Next 16 scaffolds assistant instruction files into the project on dev start;
  // this repo documents itself in the README instead.
  agentRules: false,
  // The dev-only overlay sits bottom-left, directly on top of the sidebar's Sign out
  // button. It never ships to production, but it makes the button unclickable while
  // developing, which is worse than losing the indicator.
  devIndicators: false,
};

module.exports = nextConfig;
