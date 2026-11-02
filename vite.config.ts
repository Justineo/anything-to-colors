import { defineConfig } from "vite-plus";
import vue from "@vitejs/plugin-vue";
import { voidPlugin } from "void";
import { compactShaderModule } from "./scripts/compact-shaders";

export default defineConfig({
  // Retain Vite's other browser targets while lowering the Chromium requirement.
  build: { target: ["chrome100", "edge111", "firefox114", "safari16.4", "ios16.4"] },
  plugins: [
    vue({ features: { optionsAPI: false } }),
    {
      name: "compact-glsl",
      apply: "build",
      enforce: "pre",
      transform(code, id) {
        if (!id.endsWith("/src/shaders.ts")) return;
        return { code: compactShaderModule(code), map: null };
      },
    },
    {
      name: "preload-app",
      apply: "build",
      transformIndexHtml: {
        order: "post",
        handler(_, context) {
          const app = Object.values(context.bundle ?? {}).find(
            (chunk) => chunk.type === "chunk" && chunk.facadeModuleId?.endsWith("/src/mount.ts"),
          );
          if (!app || app.type !== "chunk") return [];
          return [
            {
              tag: "link",
              attrs: { rel: "modulepreload", href: `/${app.fileName}`, crossorigin: "" },
            },
            ...[...(app.viteMetadata?.importedCss ?? [])].map((css) => ({
              tag: "link",
              attrs: { rel: "stylesheet", href: `/${css}`, crossorigin: "" },
            })),
          ];
        },
      },
    },
    voidPlugin(),
  ],
});
