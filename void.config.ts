import { defineConfig } from "void/config";

export default defineConfig({
  worker: { compatibility_date: "2026-10-26" },
  routing: {
    headers: { "/assets/*": ["Cache-Control: public, max-age=31536000, immutable"] },
  },
});
