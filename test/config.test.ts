import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadResolvedConfig, requireConnectionConfig } from "../src/config.js";
import { saveProjectContext, upsertProfile } from "../src/state.js";
import type { SecretStore } from "../src/types.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), "noco-meta-test-"));
  tempDirs.push(dirPath);
  return dirPath;
}

function createMockSecretStore(tokens: Record<string, string>): SecretStore {
  return {
    kind: "unsupported",
    async isAvailable() {
      return { ok: true };
    },
    async getToken(profileName: string) {
      return tokens[profileName] ?? null;
    },
    async setToken(profileName: string, token: string) {
      tokens[profileName] = token;
    },
    async deleteToken(profileName: string) {
      delete tokens[profileName];
    },
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { force: true, recursive: true });
  }
});

describe("config resolution", () => {
  it("resolves managed profile and project context", async () => {
    const homeDir = createTempDir();
    const cwd = createTempDir();

    upsertProfile(
      {
        name: "dev",
        baseUrl: "https://example.nocodb.test/",
        apiVersion: "v3",
        workspaceId: "ws_profile",
        baseId: "base_profile",
      },
      homeDir,
    );
    saveProjectContext(
      {
        profile: "dev",
        workspaceId: "ws_context",
      },
      cwd,
    );

    const config = await loadResolvedConfig(
      {},
      {
        cwd,
        homeDir,
        secretStore: createMockSecretStore({ dev: "secret-token" }),
      },
    );

    expect(config.configSource).toBe("managed");
    expect(config.profileName).toBe("dev");
    expect(config.baseUrl).toBe("https://example.nocodb.test");
    expect(config.token).toBe("secret-token");
    expect(config.workspaceId).toBe("ws_context");
    expect(config.baseId).toBe("base_profile");
  });

  it("requires init when only CLI flags are provided locally", async () => {
    const emptyHome = createTempDir();
    const emptyCwd = createTempDir();

    const config = await loadResolvedConfig(
      {
        "base-url": "https://example.nocodb.test",
        token: "secret-token",
        "api-version": "v3",
      },
      {
        cwd: emptyCwd,
        homeDir: emptyHome,
      },
    );

    expect(config.configSource).toBe("none");
    expect(() => requireConnectionConfig(config)).toThrow(/requires initialization/i);
  });
});
