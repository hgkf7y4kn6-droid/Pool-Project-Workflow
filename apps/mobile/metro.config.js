// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

/** @type {import('expo/metro-config').MetroConfig} */
// SDK 54 detects the npm workspace automatically (watchFolders + node_modules
// resolution for the @pool/* packages, which ship TypeScript source).
const config = getDefaultConfig(__dirname);

// expo-sqlite on web runs on a WebAssembly build of SQLite.
config.resolver.assetExts.push("wasm");
config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  // SharedArrayBuffer (used by the web SQLite worker) needs cross-origin isolation.
  res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  return middleware(req, res, next);
};

module.exports = withNativewind(config);
