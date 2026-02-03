import type { Config, Tracer } from '@prefactor/core';

export type PluginConfig = Partial<Config>;

export type OpenClawPluginApi = {
  on: (name: string, handler: (event: any, ctx: any) => void) => void;
  config?: Record<string, any>;
  logger?: {
    info: (msg: string, meta?: unknown) => void;
    error: (msg: string, meta?: unknown) => void;
    debug: (msg: string, meta?: unknown) => void;
  };
};
