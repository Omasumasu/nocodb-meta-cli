import type { CliConfig } from "./types.js";
import { CliError } from "./errors.js";

function buildUrl(baseUrl: string, requestPath: string, query: Record<string, unknown> = {}): URL {
  const url = new URL(requestPath, `${baseUrl}/`);

  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue === undefined || rawValue === null) {
      continue;
    }

    if (Array.isArray(rawValue)) {
      for (const value of rawValue) {
        url.searchParams.append(key, String(value));
      }
      continue;
    }

    url.searchParams.set(key, String(rawValue));
  }

  return url;
}

export async function requestJson(
  config: CliConfig,
  request: {
    method: string;
    path: string;
    query?: Record<string, unknown>;
    body?: unknown;
    headers?: Record<string, string>;
  },
): Promise<any> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...request.headers,
  };

  if (config.token && !headers["xc-token"]) {
    headers["xc-token"] = config.token;
  }

  let body: string | undefined;
  if (request.body !== undefined) {
    body = JSON.stringify(request.body);
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(buildUrl(config.baseUrl!, request.path, request.query), {
    method: request.method,
    headers,
    body,
  });

  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = text ? (isJson ? JSON.parse(text) : text) : null;

  if (!response.ok) {
    if (config.verbose) {
      process.stderr.write(`[debug] ${request.method} ${request.path} → ${response.status}\n`);
      process.stderr.write(`[debug] request body: ${body ?? "(none)"}\n`);
      process.stderr.write(`[debug] response: ${text}\n`);
    }
    throw new CliError(`Request failed for ${request.method} ${request.path}`, {
      status: response.status,
      details: payload,
    });
  }

  return payload;
}
