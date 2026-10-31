import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.ofsng.scrollabus",
  appName: "Scrollabus",
  webDir: "dist",
  plugins: {
    // Light status-bar icons on the app's dark background
    SystemBars: { style: "DARK" },
  },
};

export default config;
