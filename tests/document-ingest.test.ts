import test from "node:test";
import assert from "node:assert/strict";
import { ingestUploadedDocument } from "../src/lib/document-ingest";

test("uploaded text sources are decoded and normalized", async () => {
  const fileData = Buffer.from("  Sales\nplaybook\u0000  ", "utf8").toString("base64");
  const content = await ingestUploadedDocument({ fileData, fileName: "sales.md", fileType: "text/markdown" });
  assert.equal(content, "Sales\nplaybook");
});

test("pasted sources do not require a file upload", async () => {
  assert.equal(await ingestUploadedDocument({ content: "  Company facts  " }), "Company facts");
});

test("oversized uploads are rejected before indexing", async () => {
  const fileData = Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64");
  await assert.rejects(() => ingestUploadedDocument({ fileData, fileName: "large.txt" }), /under 8 MB/);
});
