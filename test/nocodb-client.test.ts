import { afterEach, describe, expect, it, vi } from "vitest";

import { createNocoClient, resolveRequestPath } from "../src/nocodb-client.js";
import type { CliConfig } from "../src/types.js";

describe("nocodb client", () => {
  it("resolveRequestPath prefixes versioned meta paths", () => {
    expect(resolveRequestPath("v3", "/meta/workspaces")).toBe("/api/v3/meta/workspaces");
    expect(resolveRequestPath("v2", "meta/bases/")).toBe("/api/v2/meta/bases/");
  });
});

function makeConfig(apiVersion: "v2" | "v3"): CliConfig {
  return {
    baseUrl: "https://nocodb.test",
    token: "test-token",
    apiVersion,
    configSource: "managed",
    workspaceId: null,
    baseId: null,
    profileName: null,
    configHome: null,
    projectContextPath: null,
    managed: false,
    secretStoreKind: null,
    json: false,
    verbose: false,
    configPath: null,
  };
}

function mockFetch(responseBody: unknown, status = 200) {
  const handler = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(responseBody),
  });
  vi.stubGlobal("fetch", handler);
  return handler;
}

describe("updateField", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends PATCH to v2 columns endpoint", async () => {
    const handler = mockFetch({ id: "fld1", title: "Name", uidt: "SingleLineText" });
    const client = createNocoClient(makeConfig("v2"));

    const result = await client.updateField("base1", "tbl1", "fld1", { title: "Updated" });

    expect(handler).toHaveBeenCalledOnce();
    const [url, init] = handler.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/api/v2/meta/tables/tbl1/columns/fld1");
    expect(init.method).toBe("PATCH");
    expect(result.id).toBe("fld1");
    expect(result.title).toBe("Name");
  });

  it("sends PATCH to v3 fields endpoint", async () => {
    const handler = mockFetch({ id: "fld1", title: "Name", type: "SingleLineText" });
    const client = createNocoClient(makeConfig("v3"));

    const result = await client.updateField("base1", "tbl1", "fld1", { title: "Updated" });

    expect(handler).toHaveBeenCalledOnce();
    const [url, init] = handler.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/api/v3/meta/bases/base1/tables/tbl1/fields/fld1");
    expect(init.method).toBe("PATCH");
    expect(result.id).toBe("fld1");
  });
});

describe("deleteField", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends DELETE to v2 columns endpoint", async () => {
    const handler = mockFetch(null);
    const client = createNocoClient(makeConfig("v2"));

    await client.deleteField("base1", "tbl1", "fld1");

    expect(handler).toHaveBeenCalledOnce();
    const [url, init] = handler.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/api/v2/meta/tables/tbl1/columns/fld1");
    expect(init.method).toBe("DELETE");
  });

  it("sends DELETE to v3 fields endpoint", async () => {
    const handler = mockFetch(null);
    const client = createNocoClient(makeConfig("v3"));

    await client.deleteField("base1", "tbl1", "fld1");

    expect(handler).toHaveBeenCalledOnce();
    const [url, init] = handler.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/api/v3/meta/bases/base1/tables/tbl1/fields/fld1");
    expect(init.method).toBe("DELETE");
  });
});

describe("deleteTable", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends DELETE to v2 tables endpoint", async () => {
    const handler = mockFetch(null);
    const client = createNocoClient(makeConfig("v2"));

    await client.deleteTable("base1", "tbl1");

    expect(handler).toHaveBeenCalledOnce();
    const [url, init] = handler.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/api/v2/meta/tables/tbl1");
    expect(init.method).toBe("DELETE");
  });

  it("sends DELETE to v3 tables endpoint", async () => {
    const handler = mockFetch(null);
    const client = createNocoClient(makeConfig("v3"));

    await client.deleteTable("base1", "tbl1");

    expect(handler).toHaveBeenCalledOnce();
    const [url, init] = handler.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/api/v3/meta/bases/base1/tables/tbl1");
    expect(init.method).toBe("DELETE");
  });
});
