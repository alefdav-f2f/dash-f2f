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
    // Saída gerada por `npm run mcp:build` (tsc -p mcp/tsconfig.json) — nunca
    // deveria ter sido lintada como se fosse código-fonte escrito à mão; era
    // de onde vinha a maior parte do baseline de erros deste projeto.
    "mcp/dist/**",
  ]),
]);

export default eslintConfig;
