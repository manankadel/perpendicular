import test from "node:test";
import assert from "node:assert/strict";
import { parseLeadCsv } from "@/lib/lead-csv";

test("lead CSV parser supports quoted commas and optional columns", () => {
  const result = parseLeadCsv('name,email,company,role,location\n"Ada Lovelace",ada@example.com,"Analytical, Inc.",Founder,London\nGrace Hopper,grace@example.com,Compiler Co,,');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.records, [
    { line: 2, name: "Ada Lovelace", email: "ada@example.com", company: "Analytical, Inc.", role: "Founder", location: "London" },
    { line: 3, name: "Grace Hopper", email: "grace@example.com", company: "Compiler Co", role: "Unknown", location: "Unknown" },
  ]);
});

test("lead CSV parser reports malformed rows without losing valid rows", () => {
  const result = parseLeadCsv("full_name,email,organization\nValid Person,valid@example.com,Valid Co\nMissing Email,,No Email Co\nBad Email,bad,Other Co");
  assert.equal(result.records.length, 1);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0].reason, /valid email/);
});
