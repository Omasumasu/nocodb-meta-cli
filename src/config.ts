import fs from "node:fs";
import path from "node:path";

import { CliError } from "./errors.js";
import type { CliConfig, FlagMap } from "./types.js";
import { normalizeBaseUrl, tryReadJsonFile } from "./utils.js";

const DEFAULT_CONFIG_FILE = ".nocodb-meta-cli.json";

export function loadResolvedConfig(globalFlags: FlagMap = {}): CliConfig {
  const explicitConfigPath =
    (globalFlags.config as string) || process.env.NOCODB_META_CONFIG || null;
  const candidatePath = explicitConfigPath || path.resolve(process.cwd(), DEFAULT_CONFIG_FILE);
  const fileConfig =
    explicitConfigPath || fs.existsSync(candidatePath)
      ? (tryReadJsonFile<Record<string, any>>(candidatePath) ?? {})
      : {};

  const apiVersion =
    (globalFlags["api-version"] as string) ||
    process.env.NOCODB_API_VERSION ||
    fileConfig.apiVersion ||
    "v3";

  if (!["v2", "v3"].includes(apiVersion)) {
    throw new CliError(`Unsupported api version "${apiVersion}". Use "v2" or "v3".`);
  }

  const config: CliConfig = {
    apiVersion,
    baseUrl:
      (globalFlags["base-url"] as string) ||
      process.env.NOCODB_BASE_URL ||
      fileConfig.baseUrl ||
      null,
    token: (globalFlags.token as string) || process.env.NOCODB_TOKEN || fileConfig.token || null,
    workspaceId:
      (globalFlags["workspace-id"] as string) ||
      process.env.NOCODB_WORKSPACE_ID ||
      fileConfig.workspaceId ||
      null,
    baseId:
      (globalFlags["base-id"] as string) || process.env.NOCODB_BASE_ID || fileConfig.baseId || null,
    json:
      globalFlags.json === true
        ? true
        : fileConfig.json === true || process.env.NOCODB_JSON === "1",
    verbose:
      globalFlags.verbose === true
        ? true
        : fileConfig.verbose === true || process.env.NOCODB_VERBOSE === "1",
    configPath: explicitConfigPath ? candidatePath : null,
  };

  if (config.baseUrl) {
    config.baseUrl = normalizeBaseUrl(config.baseUrl);
  }

  return config;
}

export function requireConnectionConfig(config: CliConfig): void {
  if (!config.baseUrl) {
    throw new CliError("Missing base URL. Set NOCODB_BASE_URL or pass --base-url.");
  }

  if (!config.token) {
    throw new CliError("Missing token. Set NOCODB_TOKEN or pass --token.");
  }
}
