import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === "pages" ? "/1c-enterprise-clone/" : "/",
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:4000" }
  }
}));
