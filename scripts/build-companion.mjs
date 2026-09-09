import { build } from "esbuild";
await build({
  entryPoints: ["scripts/companion.ts"],
  outfile: "dist/companion.cjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
});
