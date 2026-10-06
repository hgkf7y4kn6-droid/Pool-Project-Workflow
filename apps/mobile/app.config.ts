import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Environment-specific values layered over app.json. Only public values
 * belong here — everything in `extra` ships inside the app bundle, so never
 * put secrets in it.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const appEnv = process.env.APP_ENV ?? "development";
  return {
    ...(config as ExpoConfig),
    name: appEnv === "production" ? "Pool PM" : `Pool PM (${appEnv})`,
    extra: {
      ...config.extra,
      appEnv,
      apiUrl: process.env.EXPO_PUBLIC_API_URL ?? config.extra?.apiUrl,
      eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
    },
  };
};
