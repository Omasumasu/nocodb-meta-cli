import { builtinModules } from "node:module";
import path from "node:path";

import { defineConfig } from "vite";

const external = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

export default defineConfig({
  build: {
    target: "node20",
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    lib: {
      entry: path.resolve(import.meta.dirname, "src/cli.ts"),
      formats: ["es"],
      fileName: () => "noco-meta.js",
    },
    rollupOptions: {
      external: (id) => external.has(id),
      output: {
        banner: "#!/usr/bin/env node",
      },
    },
  },
});
