import { rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await build({
  entryPoints: { index: "src/index.ts", simulate: "src/simulate.ts" },
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outdir: "dist",
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});
