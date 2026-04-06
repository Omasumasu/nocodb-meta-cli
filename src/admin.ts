import fs from "node:fs";

import { parseFlags } from "./args.js";
import { loadLegacyConfig, loadResolvedConfig } from "./config.js";
import { CliError } from "./errors.js";
import { getConfigHome, getProfilesPath, getProjectContextPath } from "./paths.js";
import { confirm, promptHidden, promptLine } from "./prompts.js";
import { getSecretStore } from "./secret-store.js";
import {
  assertValidProfileName,
  clearProjectContext,
  loadProfilesFile,
  loadProjectContext,
  removeProfile,
  saveProjectContext,
  setDefaultProfile,
  upsertProfile,
} from "./state.js";
import type {
  ApiVersion,
  CliConfig,
  FlagMap,
  NormalizedBase,
  NormalizedWorkspace,
  ProfileRecord,
} from "./types.js";
import { printOutput } from "./utils.js";
import { createNocoClient } from "./nocodb-client.js";

function redactConfig(config: CliConfig) {
  return {
    ...config,
    token: config.token ? "***" : null,
  };
}

function isApiVersion(value: string): value is ApiVersion {
  return value === "v2" || value === "v3";
}

async function promptApiVersion(defaultValue: ApiVersion): Promise<ApiVersion> {
  while (true) {
    const value = await promptLine("API version (v2 or v3)", {
      defaultValue,
    });

    if (value && isApiVersion(value)) {
      return value;
    }

    process.stdout.write('Please enter "v2" or "v3".\n');
  }
}

function normalizeMaybeId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
}

function printSelectionList<T extends { id?: string; title?: string }>(
  label: string,
  items: T[],
): void {
  process.stdout.write(`${label}:\n`);
  items.forEach((item, index) => {
    process.stdout.write(`  ${index + 1}. ${item.title || "(untitled)"} [${item.id}]\n`);
  });
}

async function chooseResource<T extends { id?: string; title?: string }>(
  label: string,
  items: T[],
  defaultValue?: string | null,
): Promise<T | null> {
  if (items.length === 0) {
    return null;
  }

  printSelectionList(label, items);

  while (true) {
    const answer = await promptLine(`${label} selection (number/id, blank to skip)`, {
      defaultValue: defaultValue ?? null,
      allowEmpty: true,
    });

    const normalized = normalizeMaybeId(answer);

    if (!normalized) {
      return null;
    }

    const numericChoice = Number(normalized);

    if (Number.isInteger(numericChoice) && numericChoice >= 1 && numericChoice <= items.length) {
      return items[numericChoice - 1];
    }

    const byId = items.find((item) => item.id === normalized);

    if (byId) {
      return byId;
    }

    process.stdout.write("Invalid selection. Choose a number from the list or paste an id.\n");
  }
}

async function verifyConnection(config: CliConfig): Promise<{
  workspaces: NormalizedWorkspace[];
  bases: NormalizedBase[];
}> {
  const client = createNocoClient(config);

  const workspaces = await client.listWorkspaces();

  const workspaceId = config.workspaceId ?? workspaces[0]?.id ?? null;

  if (!workspaceId) {
    return {
      workspaces,
      bases: [],
    };
  }

  const bases = await client.listBases(workspaceId);
  return { workspaces, bases };
}

async function buildInteractiveConfig(flags: FlagMap): Promise<{
  profileName: string;
  baseUrl: string;
  apiVersion: ApiVersion;
  token: string;
  workspaceId: string | null;
  baseId: string | null;
}> {
  const store = getSecretStore();
  const availability = await store.isAvailable();

  if (!availability.ok) {
    throw new CliError(
      availability.reason ||
        "A supported secure secret store is required for init on this platform.",
    );
  }

  const legacyConfig = loadLegacyConfig();
  const defaultProfileName = (flags.profile as string) || "default";
  const profileName =
    normalizeMaybeId((flags.profile as string) || undefined) ||
    normalizeMaybeId(
      await promptLine("Profile name", {
        defaultValue: defaultProfileName,
      }),
    );

  if (!profileName) {
    throw new CliError("Profile name is required.");
  }

  assertValidProfileName(profileName);

  const baseUrl =
    normalizeMaybeId((flags["base-url"] as string) || undefined) ||
    normalizeMaybeId(
      await promptLine("NocoDB base URL", {
        defaultValue: (legacyConfig.baseUrl as string) || null,
      }),
    );

  if (!baseUrl) {
    throw new CliError("Base URL is required.");
  }

  const apiVersion = isApiVersion(flags["api-version"] as string)
    ? (flags["api-version"] as ApiVersion)
    : await promptApiVersion(
        isApiVersion(legacyConfig.apiVersion as string)
          ? (legacyConfig.apiVersion as ApiVersion)
          : "v3",
      );

  const token =
    normalizeMaybeId((flags.token as string) || undefined) ||
    normalizeMaybeId(await promptHidden("xc-token"));

  if (!token) {
    throw new CliError("xc-token is required.");
  }

  const tempConfig: CliConfig = {
    apiVersion,
    baseUrl,
    token,
    workspaceId: null,
    baseId: null,
    profileName,
    configHome: getConfigHome(),
    projectContextPath: getProjectContextPath(),
    managed: true,
    configSource: "managed",
    secretStoreKind: store.kind,
    json: false,
    verbose: false,
    configPath: null,
  };

  const discovered = await verifyConnection(tempConfig);
  process.stdout.write("Connection check succeeded.\n");

  let workspaceId = normalizeMaybeId(flags["workspace-id"] as string);
  let baseId = normalizeMaybeId(flags["base-id"] as string);

  if (apiVersion === "v3" && !workspaceId) {
    const selectedWorkspace = await chooseResource(
      "Workspaces",
      discovered.workspaces,
      (legacyConfig.workspaceId as string) || null,
    );
    workspaceId = selectedWorkspace?.id || null;

    if (workspaceId) {
      const client = createNocoClient({
        ...tempConfig,
        workspaceId,
      });
      const bases = await client.listBases(workspaceId);
      const selectedBase = await chooseResource(
        "Bases",
        bases,
        (legacyConfig.baseId as string) || null,
      );
      baseId = selectedBase?.id || baseId;
    }
  } else if (apiVersion === "v2" && !baseId) {
    const selectedBase = await chooseResource(
      "Bases",
      discovered.bases,
      (legacyConfig.baseId as string) || null,
    );
    baseId = selectedBase?.id || null;
  }

  return {
    profileName,
    baseUrl,
    apiVersion,
    token,
    workspaceId,
    baseId,
  };
}

function profileToJson(profile: ProfileRecord, activeProfileName: string | null) {
  return {
    ...profile,
    active: profile.name === activeProfileName,
  };
}

export async function runInit(globalFlags: FlagMap, argv: string[]): Promise<void> {
  const { flags } = parseFlags(argv);
  const resolvedFlags = {
    ...globalFlags,
    ...flags,
  };
  const setup = await buildInteractiveConfig(resolvedFlags);
  const store = getSecretStore();

  await store.setToken(setup.profileName, setup.token);
  upsertProfile({
    name: setup.profileName,
    baseUrl: setup.baseUrl,
    apiVersion: setup.apiVersion,
    workspaceId: setup.workspaceId,
    baseId: setup.baseId,
  });
  saveProjectContext({
    profile: setup.profileName,
    workspaceId: setup.workspaceId,
    baseId: setup.baseId,
  });

  printOutput({
    ok: true,
    profile: setup.profileName,
    baseUrl: setup.baseUrl,
    apiVersion: setup.apiVersion,
    workspaceId: setup.workspaceId,
    baseId: setup.baseId,
    configHome: getConfigHome(),
    projectContextPath: getProjectContextPath(),
    secretStore: store.kind,
  });
}

export async function runProfileCommand(globalFlags: FlagMap, argv: string[]): Promise<void> {
  const { flags, positionals } = parseFlags(argv);
  const subcommand = positionals[0] || "ls";
  const homeDir = getConfigHome();
  const profilesFile = loadProfilesFile(homeDir);
  const activeContext = loadProjectContext();

  switch (subcommand) {
    case "ls": {
      const profiles = Object.values(profilesFile.profiles);

      if (globalFlags.json === true) {
        printOutput({
          defaultProfile: profilesFile.defaultProfile,
          profiles: profiles.map((profile) =>
            profileToJson(profile, activeContext?.profile ?? null),
          ),
        });
        return;
      }

      if (profiles.length === 0) {
        printOutput("No profiles found. Run `noco-meta init` first.");
        return;
      }

      const lines = profiles.map((profile) => {
        const markers = [
          profile.name === profilesFile.defaultProfile ? "default" : null,
          profile.name === activeContext?.profile ? "active" : null,
        ].filter(Boolean);
        const suffix = markers.length ? ` (${markers.join(", ")})` : "";
        return `- ${profile.name}${suffix}: ${profile.baseUrl} [${profile.apiVersion}]`;
      });
      printOutput(lines.join("\n"));
      return;
    }

    case "show": {
      const profileName =
        positionals[1] || (globalFlags.profile as string) || activeContext?.profile;

      if (!profileName) {
        throw new CliError("Specify a profile name or activate one first.");
      }

      const profile = profilesFile.profiles[profileName];

      if (!profile) {
        throw new CliError(`Profile "${profileName}" does not exist.`);
      }

      printOutput(profileToJson(profile, activeContext?.profile ?? null));
      return;
    }

    case "add": {
      const setup = await buildInteractiveConfig({
        ...globalFlags,
        ...flags,
        profile: (flags.profile as string) || positionals[1] || (globalFlags.profile as string),
      });
      const store = getSecretStore();
      await store.setToken(setup.profileName, setup.token);
      upsertProfile({
        name: setup.profileName,
        baseUrl: setup.baseUrl,
        apiVersion: setup.apiVersion,
        workspaceId: setup.workspaceId,
        baseId: setup.baseId,
      });

      if (flags.use === true || (await confirm("Use this profile in the current project?", true))) {
        saveProjectContext({
          profile: setup.profileName,
          workspaceId: setup.workspaceId,
          baseId: setup.baseId,
        });
      }

      printOutput({
        ok: true,
        profile: setup.profileName,
      });
      return;
    }

    case "use": {
      const profileName = positionals[1] || (globalFlags.profile as string);

      if (!profileName) {
        throw new CliError("profile use requires a profile name.");
      }

      if (!profilesFile.profiles[profileName]) {
        throw new CliError(`Profile "${profileName}" does not exist.`);
      }

      saveProjectContext({
        profile: profileName,
      });
      printOutput(`Active profile set to "${profileName}".`);
      return;
    }

    case "rm": {
      const profileName = positionals[1] || (globalFlags.profile as string);

      if (!profileName) {
        throw new CliError("profile rm requires a profile name.");
      }

      if (!profilesFile.profiles[profileName]) {
        throw new CliError(`Profile "${profileName}" does not exist.`);
      }

      removeProfile(profileName, homeDir);
      await getSecretStore().deleteToken(profileName);

      if (activeContext?.profile === profileName) {
        clearProjectContext();
      }

      printOutput(`Removed profile "${profileName}".`);
      return;
    }

    case "default": {
      const profileName = positionals[1] || (globalFlags.profile as string);

      if (!profileName) {
        throw new CliError("profile default requires a profile name.");
      }

      setDefaultProfile(profileName, homeDir);
      printOutput(`Default profile set to "${profileName}".`);
      return;
    }

    default:
      throw new CliError(
        "Unknown profile subcommand. Use one of: ls, show, add, use, rm, default.",
      );
  }
}

export async function runAuthCommand(globalFlags: FlagMap, argv: string[]): Promise<void> {
  const { flags, positionals } = parseFlags(argv);
  const subcommand = positionals[0] || "status";
  const profileName =
    positionals[1] ||
    (flags.profile as string) ||
    (globalFlags.profile as string) ||
    loadProjectContext()?.profile;

  if (!profileName) {
    throw new CliError("Specify a profile name or activate one first.");
  }

  const profilesFile = loadProfilesFile();

  if (!profilesFile.profiles[profileName]) {
    throw new CliError(`Profile "${profileName}" does not exist.`);
  }

  const store = getSecretStore();

  switch (subcommand) {
    case "set": {
      const token =
        normalizeMaybeId((flags.token as string) || undefined) ||
        normalizeMaybeId(await promptHidden("xc-token"));

      if (!token) {
        throw new CliError("xc-token is required.");
      }

      await store.setToken(profileName, token);
      printOutput(`Stored token for "${profileName}" in ${store.kind}.`);
      return;
    }

    case "rm": {
      await store.deleteToken(profileName);
      printOutput(`Removed token for "${profileName}".`);
      return;
    }

    case "status": {
      const availability = await store.isAvailable();
      const token = availability.ok ? await store.getToken(profileName) : null;

      printOutput({
        profile: profileName,
        secretStore: store.kind,
        available: availability.ok,
        reason: availability.reason,
        hasToken: Boolean(token),
      });
      return;
    }

    default:
      throw new CliError("Unknown auth subcommand. Use one of: set, rm, status.");
  }
}

export async function runContextCommand(globalFlags: FlagMap, argv: string[]): Promise<void> {
  const { flags, positionals } = parseFlags(argv);
  const subcommand = positionals[0] || "show";

  switch (subcommand) {
    case "show": {
      const context = loadProjectContext();
      const config = await loadResolvedConfig(globalFlags);
      const contextPath = getProjectContextPath();

      printOutput({
        path: contextPath,
        exists: fs.existsSync(contextPath),
        context,
        resolved: {
          ...redactConfig(config),
        },
      });
      return;
    }

    case "set": {
      saveProjectContext({
        profile: (flags.profile as string) || positionals[1] || undefined,
        workspaceId:
          flags["workspace-id"] === undefined
            ? undefined
            : normalizeMaybeId(flags["workspace-id"] as string),
        baseId:
          flags["base-id"] === undefined ? undefined : normalizeMaybeId(flags["base-id"] as string),
      });
      printOutput(`Updated project context at ${getProjectContextPath()}.`);
      return;
    }

    case "clear": {
      clearProjectContext();
      printOutput(`Cleared project context at ${getProjectContextPath()}.`);
      return;
    }

    default:
      throw new CliError("Unknown context subcommand. Use one of: show, set, clear.");
  }
}

export async function runDoctor(globalFlags: FlagMap): Promise<void> {
  const homeDir = getConfigHome();
  const profilesPath = getProfilesPath(homeDir);
  const contextPath = getProjectContextPath();
  const profilesFile = loadProfilesFile(homeDir);
  const projectContext = loadProjectContext();
  const store = getSecretStore();
  const availability = await store.isAvailable();
  const resolved = await loadResolvedConfig(globalFlags);

  let connection: Record<string, unknown> = {
    ok: false,
  };

  if (resolved.baseUrl && resolved.token) {
    try {
      const client = createNocoClient(resolved);
      const payload =
        resolved.apiVersion === "v3"
          ? resolved.workspaceId
            ? { bases: await client.listBases(resolved.workspaceId) }
            : { workspaces: await client.listWorkspaces() }
          : { bases: await client.listBases(null) };

      connection = {
        ok: true,
        ...payload,
      };
    } catch (error) {
      connection = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  printOutput({
    configHome: homeDir,
    profilesPath,
    hasProfilesFile: fs.existsSync(profilesPath),
    profileCount: Object.keys(profilesFile.profiles).length,
    defaultProfile: profilesFile.defaultProfile,
    projectContextPath: contextPath,
    hasProjectContext: fs.existsSync(contextPath),
    projectContext,
    secretStore: {
      kind: store.kind,
      available: availability.ok,
      reason: availability.reason,
      hasToken: resolved.profileName ? Boolean(await store.getToken(resolved.profileName)) : false,
    },
    resolved: redactConfig(resolved),
    connection,
  });
}
