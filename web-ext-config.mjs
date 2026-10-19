// Settings for web-ext (npm run lint / build / sign / start).
// Signing reads the AMO credentials from WEB_EXT_API_KEY / WEB_EXT_API_SECRET.
export default {
  sourceDir: ".",
  artifactsDir: "web-ext-artifacts",
  ignoreFiles: [
    "test",
    "node_modules",
    "package.json",
    "package-lock.json",
    "README.md",
    "web-ext-config.mjs",
    "icons/icon.svg",
  ],
};
