import { defineConfig } from "@apps-in-toss/web-framework/config";

export default defineConfig({
  appName: "shade-route",
  brand: {
    displayName: "그늘길",
    primaryColor: "#3182F6",
    icon: "", // 콘솔에 등록한 앱 아이콘 URL로 교체해야 해요.
  },
  web: {
    host: "localhost",
    port: 5173,
    commands: {
      dev: "vite dev",
      build: "vite build",
    },
  },
  permissions: [{ name: "geolocation", access: "access" }],
  outdir: "dist",
  webViewProps: {
    type: "partner",
  },
});
