import { type Config, createConfig } from '@prefactor/core';

export type PluginConfig = Partial<Config> & {
  httpConfig?: Config['httpConfig'];
};

export function resolveConfig(config?: PluginConfig): Config | null {
  const transportType =
    config?.transportType ??
    (process.env.PREFACTOR_TRANSPORT as 'stdio' | 'http' | undefined) ??
    'stdio';

  let httpConfig = config?.httpConfig;
  if (transportType === 'http') {
    const apiUrl = httpConfig?.apiUrl ?? process.env.PREFACTOR_API_URL;
    const apiToken = httpConfig?.apiToken ?? process.env.PREFACTOR_API_TOKEN;
    console.log("config is here")

    if (!apiUrl || !apiToken) {
      return null;
    }

    httpConfig = {
      ...httpConfig,
      apiUrl,
      apiToken,
    };
  }

  return createConfig({ ...config, transportType, httpConfig });
}
