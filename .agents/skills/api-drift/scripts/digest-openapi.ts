/**
 * Digests the Prefactor backend OpenAPI spec into a compact text form for
 * drift analysis against the SDK's hand-written API contracts.
 *
 * Usage (from the repo root):
 *   bun .agents/skills/api-drift/scripts/digest-openapi.ts [path/to/openapi.json]
 *
 * Defaults to /tmp/prefactor-openapi.json. Fetch the canonical production spec with:
 *   curl -s https://app.prefactorai.com/api/v1/openapi -o /tmp/prefactor-openapi.json
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// biome-ignore lint/suspicious/noExplicitAny: the OpenAPI spec is a truly dynamic external payload
type Json = any;

const DEFAULT_SPEC_PATH = "/tmp/prefactor-openapi.json";
const MAX_INLINE_DEPTH = 3;
const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

function refName(ref: string): string {
  return ref.split("/").pop() ?? ref;
}

function isNullVariant(variant: Json): boolean {
  return (
    (typeof variant?.$ref === "string" && refName(variant.$ref) === "Null") ||
    variant?.type === "null"
  );
}

function describe(schema: Json | undefined, depth: number): string {
  if (!schema || typeof schema !== "object") return "unknown";
  if (typeof schema.$ref === "string") return refName(schema.$ref);

  const combo: Json[] | undefined = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(combo)) {
    const nonNull = combo.filter((variant) => !isNullVariant(variant));
    const nullable = nonNull.length !== combo.length;
    const inner = nonNull.map((variant) => describe(variant, depth)).join(" | ") || "null";
    return nullable ? `${inner} | null` : inner;
  }

  if (Array.isArray(schema.enum)) {
    return `enum[${schema.enum.join(", ")}]`;
  }

  if (schema.type === "array") {
    return `${describe(schema.items, depth)}[]`;
  }

  if (schema.type === "object" || schema.properties) {
    const props = schema.properties;
    if (!props || typeof props !== "object") return "object";
    if (depth >= MAX_INLINE_DEPTH) return "{ ... }";
    const required: string[] = Array.isArray(schema.required) ? schema.required : [];
    const fields = Object.entries(props).map(([name, sub]) => {
      const optional = required.includes(name) ? "" : "?";
      return `${name}${optional}: ${describe(sub, depth + 1)}`;
    });
    return `{ ${fields.join(", ")} }`;
  }

  return typeof schema.type === "string" ? schema.type : "unknown";
}

function describeParams(params: Json[] | undefined, kind: string): string[] {
  return (params ?? [])
    .filter((param) => param?.in === kind)
    .map((param) => {
      const required = param.required === true ? " (required)" : "";
      return `  - ${param.name}: ${describe(param.schema, 0)}${required}`;
    });
}

function main(): void {
  const specPath = resolve(process.cwd(), process.argv[2] ?? DEFAULT_SPEC_PATH);

  let spec: Json;
  try {
    spec = JSON.parse(readFileSync(specPath, "utf8"));
  } catch {
    console.error(`Cannot read or parse OpenAPI spec at ${specPath}`);
    console.error(
      "Fetch the canonical production spec with: curl -s https://app.prefactorai.com/api/v1/openapi -o /tmp/prefactor-openapi.json",
    );
    process.exit(1);
  }

  const paths: Json = spec.paths ?? {};
  const schemas: Json = spec.components?.schemas ?? {};

  const lines: string[] = [];
  lines.push(`# OpenAPI digest: ${specPath}`);
  lines.push(
    `# ${spec.info?.title ?? "unknown"} ${spec.info?.version ?? ""} — ${Object.keys(paths).length} paths, ${Object.keys(schemas).length} schemas`,
  );
  lines.push("");

  lines.push("## Operations index");
  for (const path of Object.keys(paths).sort()) {
    for (const method of HTTP_METHODS) {
      const operation = paths[path]?.[method];
      if (!operation) continue;
      lines.push(`- ${method.toUpperCase()} ${path} — ${operation.operationId ?? "no operationId"}`);
    }
  }
  lines.push("");

  lines.push("## Operations");
  for (const path of Object.keys(paths).sort()) {
    for (const method of HTTP_METHODS) {
      const operation = paths[path]?.[method];
      if (!operation) continue;
      const deprecated = operation.deprecated === true ? " [deprecated]" : "";
      lines.push(`### ${method.toUpperCase()} ${path}${deprecated}`);
      lines.push(`operationId: ${operation.operationId ?? "none"}`);

      const bodyLines = describeParams(operation.parameters, "body");
      if (bodyLines.length > 0) {
        lines.push("Request body fields:");
        lines.push(...bodyLines);
      }

      const requestBodySchema = operation.requestBody?.content?.["application/json"]?.schema;
      if (requestBodySchema) {
        lines.push(`Request body: ${describe(requestBodySchema, 0)}`);
      }

      const queryLines = describeParams(operation.parameters, "query");
      if (queryLines.length > 0) {
        lines.push("Query params:");
        lines.push(...queryLines);
      }

      lines.push("Responses:");
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        const schema = (response as Json)?.content?.["application/json"]?.schema;
        lines.push(`  - ${status} → ${describe(schema, 0)}`);
      }
      lines.push("");
    }
  }

  lines.push("## Schema index");
  for (const name of Object.keys(schemas).sort()) {
    lines.push(`- ${name}: ${describe(schemas[name], 0)}`);
  }

  console.log(lines.join("\n"));
}

main();
