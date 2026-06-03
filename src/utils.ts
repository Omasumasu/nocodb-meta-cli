import fs from "node:fs";
import path from "node:path";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(stripUndefined) as T;
  }

  if (!isObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .map(([key, nested]) => [key, stripUndefined(nested)]),
  ) as T;
}

export function deepMerge(baseValue: any, overrideValue: any): any {
  if (overrideValue === undefined) {
    return clone(baseValue);
  }

  if (baseValue === undefined) {
    return clone(overrideValue);
  }

  if (Array.isArray(baseValue) || Array.isArray(overrideValue)) {
    return clone(overrideValue);
  }

  if (isObject(baseValue) && isObject(overrideValue)) {
    const keys = new Set([...Object.keys(baseValue), ...Object.keys(overrideValue)]);
    const merged: Record<string, unknown> = {};

    for (const key of keys) {
      merged[key] = deepMerge(baseValue[key], overrideValue[key]);
    }

    return merged;
  }

  return clone(overrideValue);
}

function clone<T>(value: T): T {
  if (value === undefined) {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

export function readJsonFile<T = any>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export function tryReadJsonFile<T = any>(filePath: string | null): T | null {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  return readJsonFile<T>(filePath);
}

async function readTextInput(reference?: string): Promise<string> {
  if (!reference || reference === "-") {
    return readStdin();
  }

  if (reference.startsWith("@")) {
    return fs.readFileSync(path.resolve(reference.slice(1)), "utf8");
  }

  const resolvedPath = path.resolve(reference);

  if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
    return fs.readFileSync(resolvedPath, "utf8");
  }

  return reference;
}

export async function readJsonInput<T = any>(reference?: string): Promise<T> {
  const text = await readTextInput(reference);
  return JSON.parse(text) as T;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function printOutput(value: unknown): void {
  if (typeof value === "string") {
    process.stdout.write(`${value}\n`);
    return;
  }

  process.stdout.write(`${prettyJson(value)}\n`);
}

function ensureArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function normalizeCaseInsensitiveMatch<T>(
  items: T[],
  value: string | undefined,
  selector: (item: T) => unknown,
): T | undefined {
  if (!value) {
    return undefined;
  }

  const lowerNeedle = String(value).toLowerCase();
  return items.find((item) => {
    const candidate = selector(item);
    return candidate === value || String(candidate).toLowerCase() === lowerNeedle;
  });
}

export function keyValueListToObject(
  entries: string | boolean | Array<string | boolean> | undefined,
): Record<string, string | boolean> {
  const object: Record<string, string | boolean> = {};

  for (const entry of ensureArray(entries)) {
    if (!entry) {
      continue;
    }

    const normalized = String(entry);
    const separatorIndex = normalized.indexOf("=");

    if (separatorIndex === -1) {
      object[normalized] = true;
      continue;
    }

    const key = normalized.slice(0, separatorIndex);
    const value = normalized.slice(separatorIndex + 1);
    object[key] = value;
  }

  return object;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
