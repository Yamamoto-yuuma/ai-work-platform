import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // ドメインコアは framework / DB / SDK に依存してはならない（設計書 §0-5）
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["react", "react-dom", "next", "next/*", "@/adapters/*", "@/ui/*"],
          message: "src/core/ は framework 非依存に保ってください。依存は ports/ 経由で注入します。",
        }],
      }],
    },
  },
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
];

export default config;
