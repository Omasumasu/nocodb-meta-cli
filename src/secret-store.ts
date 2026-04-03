import { spawn } from "node:child_process";

import { CliError } from "./errors.js";
import type { SecretStore } from "./types.js";

const SECRET_SERVICE_NAME = "nocodb-meta-cli";

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

function runCommand(
  command: string,
  args: string[],
  options: { input?: string; allowFailure?: boolean } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (options.allowFailure) {
        resolve({
          stdout,
          stderr: `${stderr}${error.message}`,
          exitCode: 1,
        });
        return;
      }

      reject(error);
    });

    child.on("close", (exitCode) => {
      if (exitCode !== 0 && !options.allowFailure) {
        reject(
          new CliError(`Command failed: ${command} ${args.join(" ")}`, {
            details: stderr.trim() || stdout.trim(),
          }),
        );
        return;
      }

      resolve({
        stdout,
        stderr,
        exitCode: exitCode ?? 1,
      });
    });

    if (options.input !== undefined) {
      child.stdin.write(options.input);
    }

    child.stdin.end();
  });
}

function createMacOsKeychainStore(): SecretStore {
  return {
    kind: "macos-keychain",

    async isAvailable() {
      return { ok: process.platform === "darwin" };
    },

    async getToken(profileName) {
      const result = await runCommand(
        "security",
        ["find-generic-password", "-a", profileName, "-s", SECRET_SERVICE_NAME, "-w"],
        { allowFailure: true },
      );

      if (result.exitCode !== 0) {
        return null;
      }

      return result.stdout.trim() || null;
    },

    async setToken(profileName, token) {
      await runCommand("security", [
        "add-generic-password",
        "-a",
        profileName,
        "-s",
        SECRET_SERVICE_NAME,
        "-w",
        token,
        "-U",
      ]);
    },

    async deleteToken(profileName) {
      await runCommand(
        "security",
        ["delete-generic-password", "-a", profileName, "-s", SECRET_SERVICE_NAME],
        { allowFailure: true },
      );
    },
  };
}

function createLinuxSecretStore(): SecretStore {
  return {
    kind: "linux-secret-service",

    async isAvailable() {
      if (process.platform !== "linux") {
        return { ok: false, reason: "Not running on Linux." };
      }

      const result = await runCommand("which", ["secret-tool"], { allowFailure: true });

      if (result.exitCode !== 0) {
        return { ok: false, reason: "secret-tool is not installed." };
      }

      return { ok: true };
    },

    async getToken(profileName) {
      const result = await runCommand(
        "secret-tool",
        ["lookup", "service", SECRET_SERVICE_NAME, "account", profileName],
        { allowFailure: true },
      );

      if (result.exitCode !== 0) {
        return null;
      }

      return result.stdout.trim() || null;
    },

    async setToken(profileName, token) {
      await runCommand(
        "secret-tool",
        [
          "store",
          "--label",
          `NocoDB Meta CLI token (${profileName})`,
          "service",
          SECRET_SERVICE_NAME,
          "account",
          profileName,
        ],
        { input: token },
      );
    },

    async deleteToken(profileName) {
      await runCommand(
        "secret-tool",
        ["clear", "service", SECRET_SERVICE_NAME, "account", profileName],
        { allowFailure: true },
      );
    },
  };
}

function createUnsupportedStore(): SecretStore {
  return {
    kind: "unsupported",

    async isAvailable() {
      return {
        ok: false,
        reason:
          "No supported secure secret store is available on this platform. Use CI env vars or add platform support.",
      };
    },

    async getToken() {
      return null;
    },

    async setToken() {
      throw new CliError(
        "Secure secret storage is not supported on this platform in the current implementation.",
      );
    },

    async deleteToken() {},
  };
}

export function getSecretStore(): SecretStore {
  if (process.platform === "darwin") {
    return createMacOsKeychainStore();
  }

  if (process.platform === "linux") {
    return createLinuxSecretStore();
  }

  return createUnsupportedStore();
}
