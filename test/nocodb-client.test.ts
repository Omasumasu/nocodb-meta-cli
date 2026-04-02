import { describe, expect, it } from "vitest";

import { resolveRequestPath } from "../src/nocodb-client.js";

describe("nocodb client", () => {
  it("resolveRequestPath prefixes versioned meta paths", () => {
    expect(resolveRequestPath("v3", "/meta/workspaces")).toBe("/api/v3/meta/workspaces");
    expect(resolveRequestPath("v2", "meta/bases/")).toBe("/api/v2/meta/bases/");
  });
});
