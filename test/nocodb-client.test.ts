import assert from "node:assert/strict";
import test from "node:test";

import { resolveRequestPath } from "../src/nocodb-client.js";

test("resolveRequestPath prefixes versioned meta paths", () => {
  assert.equal(resolveRequestPath("v3", "/meta/workspaces"), "/api/v3/meta/workspaces");
  assert.equal(resolveRequestPath("v2", "meta/bases/"), "/api/v2/meta/bases/");
});
