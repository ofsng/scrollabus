import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Android's local web server may not know the .mjs MIME type, which
        // would break the pdf.js worker; ship it as .js
        assetFileNames: (asset) =>
          asset.names?.some((n) => n.endsWith(".mjs")) ? "assets/[name]-[hash].js" : "assets/[name]-[hash][extname]",
      },
    },
  },
});
