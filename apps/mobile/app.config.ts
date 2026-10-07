import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Environment-specific values layered over app.json. Only public values
 * belong here — everything in `extra` ships inside the app bundle, so never
 * put secrets in it.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const appEnv = process.env.APP_ENV ?? "development";
  // Store/internal builds must point at a real API; set EXPO_PUBLIC_API_URL in the
  // EAS environment ("preview" for staging, "production") on expo.dev.
  if ((appEnv === "staging" || appEnv === "production") && !process.env.EXPO_PUBLIC_API_URL) {
    throw new Error(`EXPO_PUBLIC_API_URL is not set for the ${appEnv} build. Add it under Project → Environment variables on expo.dev.`);
  }
  return {
    ...(config as ExpoConfig),
    name: appEnv === "production" ? "Pool PM" : `Pool PM (${appEnv})`,
    extra: {
      ...config.extra,
      appEnv,
      apiUrl: process.env.EXPO_PUBLIC_API_URL ?? config.extra?.apiUrl,
      // EAS project (app.json); EAS_PROJECT_ID overrides it, e.g. for a fork under another account.
      eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : config.extra?.eas,
    },
  };
};
