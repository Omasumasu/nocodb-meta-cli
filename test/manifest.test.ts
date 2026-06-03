import { describe, expect, it } from "vitest";

import { createExampleManifest, normalizeManifest, validateManifest } from "../src/manifest.js";

describe("manifest", () => {
  it("normalizeManifest accepts snake_case aliases", () => {
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

    expect(manifest.tables[0].fields[0].options.relationType).toBe("hm");
    expect(manifest.tables[0].fields[0].options.relatedTable).toBe("Companies");
  });

  it("example manifest validates", () => {
    const manifest = normalizeManifest(createExampleManifest());
    expect(() => validateManifest(manifest)).not.toThrow();
  });
});
