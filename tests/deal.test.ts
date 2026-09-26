import test from "node:test";
import assert from "node:assert/strict";
import { dealProbability } from "../src/lib/domain";

test("pipeline stages expose explicit probability assumptions", () => {
  assert.deepEqual(
    ["lead", "qualified", "proposal", "won", "lost"].map((stage) => dealProbability(stage as Parameters<typeof dealProbability>[0])),
    [10, 35, 65, 100, 0],
  );
});
