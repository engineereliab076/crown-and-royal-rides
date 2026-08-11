import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "src/generated/**",
    ],
  },
  {
    files: [
      "src/server/modules/**/*.{ts,tsx}",
      "src/components/**/*.{ts,tsx}",
      "src/app/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "cloudinary",
                "cloudinary/*",
                "resend",
                "resend/*",
                "@upstash/*",
                "@sentry/*",
              ],
              message:
                "Provider SDKs may only be imported from src/server/integrations/.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
