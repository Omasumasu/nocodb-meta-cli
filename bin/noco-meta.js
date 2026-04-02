#!/usr/bin/env node

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const compiledCliPath = path.resolve(currentDir, "../dist/noco-meta.js");

if (!existsSync(compiledCliPath)) {
  console.error('Missing compiled output. Run "npm run build" first.');
  process.exit(1);
}

const { runCli } = await import(compiledCliPath);
await runCli(process.argv.slice(2));
