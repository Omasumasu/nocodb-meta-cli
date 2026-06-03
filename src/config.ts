import fs from "node:fs";
import path from "node:path";

import { CliError } from "./errors.js";
import { getConfigHome, getProjectContextPath } from "./paths.js";
import { getSecretStore } from "./secret-store.js";
import { loadProfilesFile, loadProjectContext } from "./state.js";
import type { CliConfig, FlagMap, SecretStore } from "./types.js";
import { normalizeBaseUrl, tryReadJsonFile } from "./utils.js";

const LEGACY_CONFIG_FILE = ".nocodb-meta-cli.json";

function readBooleanSetting(
  globalFlags: FlagMap,
  legacyConfig: Record<string, unknown>,
  envName: string,
  key: string,
): boolean {
  return globalFlags[key] === true
    ? true
    : legacyConfig[key] === true || process.env[envName] === "1";
}

export function loadLegacyConfig(cwd = process.cwd()): Record<string, unknown> {
  const legacyConfigPath = path.resolve(cwd, LEGACY_CONFIG_FILE);

  if (!fs.existsSync(legacyConfigPath)) {
    return {};
  }

  return tryReadJsonFile<Record<string, unknown>>(legacyConfigPath) ?? {};
}

export async function loadResolvedConfig(
  globalFlags: FlagMap = {},
  options: {
    cwd?: string;
    homeDir?: string;
    secretStore?: SecretStore;
  } = {},
): Promise<CliConfig> {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? getConfigHome();
  const legacyConfig = loadLegacyConfig(cwd);
  const profilesFile = loadProfilesFile(homeDir);
  const projectContext = loadProjectContext(cwd);
  const projectContextPath = getProjectContextPath(cwd);
  const secretStore = options.secretStore ?? getSecretStore();
  const hasEnvBypass = Boolean(process.env.NOCODB_BASE_URL && process.env.NOCODB_TOKEN);

  const selectedProfileName =
    (globalFlags.profile as string) ||
    projectContext?.profile ||
    profilesFile.defaultProfile ||
    null;
  const selectedProfile =
    selectedProfileName && profilesFile.profiles[selectedProfileName]
      ? profilesFile.profiles[selectedProfileName]
      : null;

  const apiVersionValue =
    (globalFlags["api-version"] as string) ||
    process.env.NOCODB_API_VERSION ||
    selectedProfile?.apiVersion ||
    (legacyConfig.apiVersion as string) ||
    "v3";

  if (!["v2", "v3"].includes(apiVersionValue)) {
    throw new CliError(`Unsupported api version "${apiVersionValue}". Use "v2" or "v3".`);
  }

  const apiVersion = apiVersionValue as CliConfig["apiVersion"];

  const explicitBaseUrl =
    (globalFlags["base-url"] as string) || process.env.NOCODB_BASE_URL || null;
  const explicitToken = (globalFlags.token as string) || process.env.NOCODB_TOKEN || null;
  const managedToken = selectedProfileName ? await secretStore.getToken(selectedProfileName) : null;

  const config: CliConfig = {
    apiVersion,
    baseUrl:
      normalizeBaseUrl(
        explicitBaseUrl || selectedProfile?.baseUrl || (legacyConfig.baseUrl as string) || "",
      ) || null,
    token: explicitToken || managedToken || null,
    workspaceId:
      (globalFlags["workspace-id"] as string) ||
      process.env.NOCODB_WORKSPACE_ID ||
      projectContext?.workspaceId ||
      selectedProfile?.workspaceId ||
      (legacyConfig.workspaceId as string) ||
      null,
    baseId:
      (globalFlags["base-id"] as string) ||
      process.env.NOCODB_BASE_ID ||
      projectContext?.baseId ||
      selectedProfile?.baseId ||
      (legacyConfig.baseId as string) ||
      null,
    profileName: selectedProfileName,
    configHome: homeDir,
    projectContextPath,
    managed: Boolean(selectedProfileName),
    configSource: selectedProfileName ? "managed" : hasEnvBypass ? "env" : "none",
    secretStoreKind: selectedProfileName ? secretStore.kind : null,
    json: readBooleanSetting(globalFlags, legacyConfig, "NOCODB_JSON", "json"),
    verbose: readBooleanSetting(globalFlags, legacyConfig, "NOCODB_VERBOSE", "verbose"),
    configPath: null,
  };

  return config;
}

export function requireConnectionConfig(config: CliConfig): void {
  if (config.configSource === "none") {
    throw new CliError(
      'This command requires initialization. Run "noco-meta init" for local use, or set NOCODB_BASE_URL and NOCODB_TOKEN for CI/non-interactive use.',
    );
  }

  if (config.managed && config.profileName && !config.baseUrl) {
    throw new CliError(
      `Active profile "${config.profileName}" is incomplete or missing. Re-run "noco-meta init" or "noco-meta profile add ${config.profileName}".`,
    );
  }

  if (!config.baseUrl) {
    throw new CliError("Missing base URL. Set it in the active profile or via NOCODB_BASE_URL.");
  }

  if (!config.token) {
    if (config.managed && config.profileName) {
      throw new CliError(
        `Missing token for profile "${config.profileName}". Run "noco-meta auth set ${config.profileName}".`,
      );
    }

    throw new CliError("Missing token. Set NOCODB_TOKEN or store one with noco-meta auth set.");
  }
}
