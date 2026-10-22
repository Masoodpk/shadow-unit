import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `npm run build:single` produces one self-contained HTML file (used for the hosted preview).
export default defineConfig(({ mode }) => ({
  base: "./",
  // Babylon's ES packages load shaders via dynamic imports; pre-bundling them breaks that in dev.
  optimizeDeps: { exclude: ["@babylonjs/core"] },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 6000,
    reportCompressedSize: false,
  },
  plugins: mode === "single" ? [viteSingleFile()] : [],
  // "artifact" mode: one JS bundle + the .glb assets (for hosts with a file-count limit)
  ...(mode === "artifact"
    ? { build: { target: "es2022", chunkSizeWarningLimit: 8000, reportCompressedSize: false, rolldownOptions: { output: { inlineDynamicImports: true } } } }
    : {}),
}));
