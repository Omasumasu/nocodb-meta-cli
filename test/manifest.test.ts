import assert from "node:assert/strict";
import test from "node:test";

import { createExampleManifest, normalizeManifest, validateManifest } from "../src/manifest.js";

test("normalizeManifest accepts snake_case aliases", () => {
  const manifest = normalizeManifest({
    base: {
      title: "CRM",
    },
    tables: [
      {
        title: "Contacts",
        fields: [
          {
            title: "Company",
            type: "LinkToAnotherRecord",
            options: {
              relation_type: "hm",
              related_table: "Companies",
            },
          },
        ],
      },
    ],
  });

  assert.equal(manifest.tables[0].fields[0].options.relationType, "hm");
  assert.equal(manifest.tables[0].fields[0].options.relatedTable, "Companies");
});

test("example manifest validates", () => {
  const manifest = normalizeManifest(createExampleManifest());
  assert.doesNotThrow(() => validateManifest(manifest));
});
