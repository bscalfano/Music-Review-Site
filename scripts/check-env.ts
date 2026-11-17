/**
 * Pre-deploy check: `pnpm check:env` validates .env.local; `pnpm check:env --file=.env.production`
 * checks another file; in CI you can pipe real environment variables instead with `--process`.
 */
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { checkProductionEnv } from "../src/lib/env-check";

const args = process.argv.slice(2);
const fileArg = args.find((a) => a.startsWith("--file="))?.slice("--file=".length) ?? ".env.local";
const env = args.includes("--process")
  ? (process.env as Record<string, string | undefined>)
  : parse(readFileSync(fileArg));

const issues = checkProductionEnv(env);
const required = issues.filter((i) => i.level === "required");
const recommended = issues.filter((i) => i.level === "recommended");

for (const i of required) console.log(`✗ ${i.name}: ${i.message}`);
for (const i of recommended) console.log(`! ${i.name}: ${i.message}`);
if (issues.length === 0) console.log("✓ Everything needed for production is set.");
console.log(`\n${required.length} required problem(s), ${recommended.length} recommendation(s).`);
process.exit(required.length > 0 ? 1 : 0);
