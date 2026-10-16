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
    // Vendored, minified copy of node_modules/mpegts.js/dist/mpegts.js for the Cast receiver.
    "public/cast/mpegts.js",
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
    // The Cast receiver also runs on 1st/2nd-gen Chromecasts with Chrome 70, so it stays within ES2019. The
    // TypeScript parser accepts newer syntax whatever the ecmaVersion, so the newer forms are rejected here.
    files: ["public/cast/receiver.js"],
    rules: {
      "no-restricted-syntax": ["error",
        {selector: "ChainExpression", message: "Optional chaining needs Chrome 80; the Cast receiver must run on Chrome 70."},
        {selector: "LogicalExpression[operator='??']", message: "Nullish coalescing needs Chrome 80; the Cast receiver must run on Chrome 70."},
        {selector: "AssignmentExpression[operator=/^(\\?\\?|&&|\\|\\|)=$/]", message: "Logical assignment needs Chrome 85; the Cast receiver must run on Chrome 70."},
        {selector: "PropertyDefinition, PrivateIdentifier", message: "Class fields need Chrome 72+; the Cast receiver must run on Chrome 70."},
        {selector: "Identifier[name='globalThis']", message: "globalThis needs Chrome 71; use window in the Cast receiver."},
      ],
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
