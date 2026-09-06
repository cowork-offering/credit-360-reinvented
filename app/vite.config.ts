import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const rootDir = dirname(fileURLToPath(import.meta.url));

/* WHICH BUILD IS ON THE FOUNDER'S SCREEN.
 *
 * The cockpit is handed over as a pinned artifact and republished from more
 * than one worktree, so "is he looking at the build we just shipped" is a real
 * question with no way to answer it from the glass. The commit is the answer,
 * and it goes into the cockpit state document the session reads.
 *
 * THE COMMIT AND NOTHING ELSE. No timestamp, no branch, no user: a build stamp
 * that changes on every run would make two builds of the same commit different
 * bundles for no gain, and the repo rule is that nothing identifying goes into
 * the artifact. Unknown outside a checkout, which is a state and not an error. */
function buildStamp(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: rootDir, encoding: "utf8" }).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

// Dev-only: serve the repo sample data at /sample-data.json so the app can load
// it in dev mode. In a production build the loader is behind import.meta.env.DEV
// and dead-code-eliminated, so nothing here ships in the bundle.
function sampleDataDevServer(): Plugin {
  const sample = resolve(rootDir, "..", "artifact", "sample-data.json");
  return {
    name: "c360-sample-data-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/sample-data.json", (_req, res) => {
        try {
          res.setHeader("Content-Type", "application/json");
          res.end(readFileSync(sample, "utf8"));
        } catch (e) {
          res.statusCode = 404;
          res.end(String(e));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), sampleDataDevServer(), viteSingleFile()],
  define: { __C360_BUILD__: JSON.stringify(buildStamp()) },
  build: {
    target: "es2022",
    cssCodeSplit: false,
    sourcemap: false,
    // Everything is inlined — no module preloading, so drop the polyfill helper
    // (it carries an inert fetch() that would otherwise trip the A19 no-network scan).
    modulePreload: false,
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      // Single chunk, everything inlined — no dynamic-import splitting (A18).
      output: { inlineDynamicImports: true },
    },
  },
});
