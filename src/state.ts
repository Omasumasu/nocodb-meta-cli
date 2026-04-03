import fs from "node:fs";
import path from "node:path";

import { getProfilesPath, getProjectContextPath, getProjectStateDir } from "./paths.js";
import type { ApiVersion, ProfileRecord, ProfilesFile, ProjectContext } from "./types.js";
import { CliError } from "./errors.js";
import { readJsonFile } from "./utils.js";

const EMPTY_PROFILES_FILE: ProfilesFile = {
  version: 1,
  defaultProfile: null,
  profiles: {},
};

function now(): string {
  return new Date().toISOString();
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function assertValidProfileName(profileName: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(profileName)) {
    throw new CliError('Invalid profile name. Use only letters, numbers, ".", "_" and "-".');
  }
}

export function loadProfilesFile(homeDir?: string): ProfilesFile {
  const profilesPath = getProfilesPath(homeDir);

  if (!fs.existsSync(profilesPath)) {
    return structuredClone(EMPTY_PROFILES_FILE);
  }

  const file = readJsonFile<ProfilesFile>(profilesPath);
  return {
    version: 1,
    defaultProfile: file.defaultProfile ?? null,
    profiles: file.profiles ?? {},
  };
}

function saveProfilesFile(file: ProfilesFile, homeDir?: string): string {
  const profilesPath = getProfilesPath(homeDir);
  ensureDir(path.dirname(profilesPath));
  fs.writeFileSync(profilesPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  return profilesPath;
}

export function upsertProfile(
  input: {
    name: string;
    baseUrl: string;
    apiVersion: ApiVersion;
    workspaceId?: string | null;
    baseId?: string | null;
  },
  homeDir?: string,
): ProfileRecord {
  assertValidProfileName(input.name);
  const file = loadProfilesFile(homeDir);
  const existing = file.profiles[input.name];
  const profile: ProfileRecord = {
    name: input.name,
    baseUrl: input.baseUrl,
    apiVersion: input.apiVersion,
    workspaceId: input.workspaceId ?? null,
    baseId: input.baseId ?? null,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
  };

  file.profiles[input.name] = profile;

  if (!file.defaultProfile) {
    file.defaultProfile = input.name;
  }

  saveProfilesFile(file, homeDir);
  return profile;
}

export function removeProfile(profileName: string, homeDir?: string): void {
  const file = loadProfilesFile(homeDir);
  delete file.profiles[profileName];

  if (file.defaultProfile === profileName) {
    file.defaultProfile = Object.keys(file.profiles)[0] ?? null;
  }

  saveProfilesFile(file, homeDir);
}

export function setDefaultProfile(profileName: string, homeDir?: string): void {
  const file = loadProfilesFile(homeDir);

  if (!file.profiles[profileName]) {
    throw new CliError(`Profile "${profileName}" does not exist.`);
  }

  file.defaultProfile = profileName;
  saveProfilesFile(file, homeDir);
}

export function loadProjectContext(cwd?: string): ProjectContext | null {
  const contextPath = getProjectContextPath(cwd);

  if (!fs.existsSync(contextPath)) {
    return null;
  }

  const file = readJsonFile<ProjectContext>(contextPath);
  return {
    version: 1,
    profile: file.profile ?? null,
    workspaceId: file.workspaceId ?? null,
    baseId: file.baseId ?? null,
    updatedAt: file.updatedAt ?? now(),
  };
}

export function saveProjectContext(
  input: {
    profile?: string | null;
    workspaceId?: string | null;
    baseId?: string | null;
  },
  cwd?: string,
): string {
  const contextPath = getProjectContextPath(cwd);
  ensureDir(getProjectStateDir(cwd));

  const existing = loadProjectContext(cwd);
  const next: ProjectContext = {
    version: 1,
    profile: input.profile ?? existing?.profile ?? null,
    workspaceId:
      input.workspaceId !== undefined ? input.workspaceId : (existing?.workspaceId ?? null),
    baseId: input.baseId !== undefined ? input.baseId : (existing?.baseId ?? null),
    updatedAt: now(),
  };

  fs.writeFileSync(contextPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return contextPath;
}

export function clearProjectContext(cwd?: string): void {
  const contextPath = getProjectContextPath(cwd);

  if (fs.existsSync(contextPath)) {
    fs.unlinkSync(contextPath);
  }
}
