import os from "node:os";
import path from "node:path";

const APP_DIR_NAME = "noco-meta-cli";

export function getConfigHome(): string {
  if (process.env.NOCODB_META_HOME) {
    return path.resolve(process.env.NOCODB_META_HOME);
  }

  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      APP_DIR_NAME,
    );
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", APP_DIR_NAME);
  }

  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), APP_DIR_NAME);
}

export function getProfilesPath(homeDir = getConfigHome()): string {
  return path.join(homeDir, "profiles.json");
}

export function getProjectStateDir(cwd = process.cwd()): string {
  return path.join(cwd, ".noco-meta");
}

export function getProjectContextPath(cwd = process.cwd()): string {
  return path.join(getProjectStateDir(cwd), "context.json");
}
