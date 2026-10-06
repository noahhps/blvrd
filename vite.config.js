import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri serves the dev build from this fixed port (see src-tauri/tauri.conf.json)
// and expects it to fail rather than drift to another one.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: Number(process.env.PORT) || 5180,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "es2021",
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
});
