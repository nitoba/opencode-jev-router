import { RESPOND_TO_USER, type ToolCatalog, type ToolDefinition } from "./types.ts";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 14))}…[truncated]`;
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function schemaType(schema: unknown): string {
  if (!isRecord(schema)) return "unknown";
  if (typeof schema.type === "string") return schema.type;
  if (Array.isArray(schema.type)) {
    const values = schema.type.filter((item): item is string => typeof item === "string");
    if (values.length > 0) return values.join("|");
  }
  if (Array.isArray(schema.enum)) return `enum(${schema.enum.map(String).slice(0, 6).join("|")})`;
  if (Array.isArray(schema.oneOf)) return "oneOf";
  if (Array.isArray(schema.anyOf)) return "anyOf";
  return "unknown";
}

function summarizeInputSchema(input: unknown): string {
  if (!isRecord(input)) return "unspecified input";
  const properties = isRecord(input.properties) ? input.properties : undefined;
  if (!properties) return `input type: ${schemaType(input)}`;

  const required = new Set(
    Array.isArray(input.required)
      ? input.required.filter((item): item is string => typeof item === "string")
      : [],
  );
  const fields = Object.entries(properties)
    .slice(0, 16)
    .map(([name, schema]) => `${name}:${schemaType(schema)}${required.has(name) ? "!" : ""}`);

  if (fields.length === 0) return "no input fields";
  const suffix = Object.keys(properties).length > fields.length ? ", …" : "";
  return `inputs: ${fields.join(", ")}${suffix}`;
}

export function describeTool(name: string, tool: ToolDefinition, maxChars: number): string {
  const description = compact(tool.description) || `Tool ${name}.`;
  return clip(`${description} ${summarizeInputSchema(tool.input)}`, maxChars);
}

export function toolCriteria(
  tools: ToolCatalog,
  maxChars: number,
): Readonly<Record<string, string>> {
  if (Object.hasOwn(tools, RESPOND_TO_USER)) {
    throw new Error(`Tool name "${RESPOND_TO_USER}" is reserved by opencode-jev-router.`);
  }
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [name, describeTool(name, tool, maxChars)]),
  );
}

export function toolCriteriaChars(tools: ToolCatalog, maxChars: number): number {
  return JSON.stringify(toolCriteria(tools, maxChars)).length;
}

export function toolFamily(name: string): string {
  if (name.includes("__")) {
    const parts = name.split("__").filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}__${parts[1]}`;
  }

  const scoped = name.split(/[.:/]/, 1)[0];
  if (scoped && scoped !== name) return scoped;

  const underscored = name.split("_", 1)[0];
  if (underscored && underscored !== name) return underscored;

  const dashed = name.split("-", 1)[0];
  return dashed || name;
}

export function groupToolsByFamily(
  tools: ToolCatalog,
): ReadonlyMap<string, Readonly<Record<string, ToolDefinition>>> {
  const groups = new Map<string, Record<string, ToolDefinition>>();
  for (const [name, tool] of Object.entries(tools)) {
    const family = toolFamily(name);
    const group = groups.get(family) ?? {};
    group[name] = tool;
    groups.set(family, group);
  }
  return groups;
}

export function describeFamily(
  family: string,
  tools: Readonly<Record<string, ToolDefinition>>,
  maxChars: number,
): string {
  const entries = Object.entries(tools);
  const sampleCount = Math.min(entries.length, 8);
  const perToolChars = Math.max(48, Math.floor(maxChars / Math.max(sampleCount, 1)) - 24);
  const sample = entries
    .slice(0, sampleCount)
    .map(([name, tool]) => {
      const description = compact(tool.description) || "No description";
      return `${name}: ${clip(description, perToolChars)}`;
    })
    .join(" | ");
  const suffix = entries.length > sampleCount ? ` | … ${entries.length - sampleCount} more` : "";
  return clip(`Family ${family}: ${entries.length} tool(s). ${sample}${suffix}`, maxChars);
}

export function keepOnlyTools<T>(tools: Record<string, T>, allowed: readonly string[]): void {
  const keep = new Set(allowed);
  for (const name of Object.keys(tools)) {
    if (!keep.has(name)) delete tools[name];
  }
}

export function clearTools<T>(tools: Record<string, T>): void {
  for (const name of Object.keys(tools)) delete tools[name];
}

function mergeRecord(
  target: Record<string, unknown>,
  source: Readonly<Record<string, unknown>>,
): void {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];
    if (isRecord(current) && isRecord(value)) {
      mergeRecord(current, value);
      continue;
    }
    target[key] = value;
  }
}

export function mergeModelOptions(
  target: Record<string, unknown>,
  source: Readonly<Record<string, unknown>> | undefined,
): void {
  if (source) mergeRecord(target, source);
}
