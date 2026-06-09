import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (!existsSync("dist/simulate.js")) {
  const build = spawnSync(process.execPath, ["scripts/build.mjs"], {
    stdio: "inherit",
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const result = spawnSync(
  process.execPath,
  ["dist/simulate.js", ...process.argv.slice(2)],
  { stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
