import { defineConfig } from "@apps-in-toss/web-framework/config";

export default defineConfig({
  appName: "shade-route",
  brand: {
    displayName: "그늘길",
    primaryColor: "#3182F6",
    icon: "https://static.toss.im/appsintoss/58729/4cf5f833-1c9a-490a-b36f-ea92fdaa7539.png",
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
