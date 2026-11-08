import type { ApiClient } from '../api-client.js';

export interface UtilsFieldProblem {
  field: string;
  message: string;
}

export interface ProcessSensitivePayloadResponse {
  markers_valid: boolean;
  output: Record<string, unknown> | null;
  payload_valid: boolean | null;
  problems: UtilsFieldProblem[];
  sensitive_encoding: boolean | null;
  status: 'success';
}

export interface UtilsRenderLiquidTemplateSample {
  payload: Record<string, unknown>;
  result_payload?: Record<string, unknown> | null;
}

export interface UtilsRenderLiquidTemplateResult {
  errors: string[];
  rendered: string | null;
}

export interface RenderLiquidTemplateResponse {
  results: UtilsRenderLiquidTemplateResult[];
  status: 'success';
}

export interface ValidateSchemaResponse {
  problems: UtilsFieldProblem[];
  status: 'success';
  valid: boolean;
}

export class UtilsClient {
  constructor(private readonly client: ApiClient) {}

  renderLiquidTemplate(
    template: string,
    samples: UtilsRenderLiquidTemplateSample[]
  ): Promise<RenderLiquidTemplateResponse> {
    return this.client.request('/utils/render_liquid_template', {
      method: 'POST',
      body: { template, samples },
    });
  }

  validateSchema(
    schema: Record<string, unknown>,
    payload?: Record<string, unknown> | null
  ): Promise<ValidateSchemaResponse> {
    return this.client.request('/utils/validate_schema', {
      method: 'POST',
      body: {
        schema,
        ...(payload !== undefined ? { payload } : {}),
      },
    });
  }

  processSensitivePayload(
    payload: Record<string, unknown>,
    schema?: Record<string, unknown> | null
  ): Promise<ProcessSensitivePayloadResponse> {
    return this.client.request('/utils/process_sensitive_payload', {
      method: 'POST',
      body: {
        payload,
        ...(schema !== undefined ? { schema } : {}),
      },
    });
  }
}
