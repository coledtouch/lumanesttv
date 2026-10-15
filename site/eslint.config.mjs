import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Internal links and post-auth redirects are deliberately full-document
      // navigations. vinext ships a working next/link, but client-side routing
      // would skip what runs once per document load: public/pwa-install.js is
      // path-scoped (never on /manage or /checkout), counts page views for the
      // mobile banner and fills the header's install slot, and sign-in/out
      // must reload with the new session cookie.
      "@next/next/no-html-link-for-pages": "off",
      "@next/next/no-location-assign-relative-destination": "off",
    },
  },
  {
    files: ["tests/**/*.{ts,mts,mjs}"],
    rules: {
      // Test fixtures deliberately feed malformed PayPal/provider JSON through
      // loosely typed doubles; application code stays fully typed.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;
