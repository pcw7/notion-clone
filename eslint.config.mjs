import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // 링크는 `@/app/link` 로 — 보이는 링크마다 미리받지 않는다(HANDOFF §3.2-271 · 10n-7). 그 파일만 `next/link` 를 감싼다.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/app/link.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/link",
              message: "@/app/link 를 쓴다 — 보이는 링크마다 미리받기하면 화면이 다시 그려질 때마다 서버 요청이 나가고, 떠날 때 끊겨 오류가 찍힌다(HANDOFF §3.2-271).",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
