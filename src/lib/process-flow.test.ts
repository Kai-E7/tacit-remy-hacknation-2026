import { test } from "node:test";
import assert from "node:assert/strict";
import {
  layoutProcessFlow,
  layoutSwimlanes,
  NODE_WIDTH,
  NODE_HEIGHT,
  stepApplications,
} from "./process-flow.ts";
import type { WorkMap, WorkStep } from "./work-map.ts";
const step = (id: string): WorkStep => ({
  id,
  title: id,
  action: "Check email",
  decision: "",
  reason: "",
  frameId: "f1",
  utteranceId: "",
  quote: "",
  provenance: "observed",
});
const map = (count: number): WorkMap => ({
  title: "Test",
  summary: "",
  steps: Array.from({ length: count }, (_, i) => step(String(i))),
  edges: Array.from({ length: count - 1 }, (_, i) => ({
    from: String(i),
    to: String(i + 1),
    label: "next",
  })),
  guardrails: [],
  questions: [],
});
test("apps use explicit names, preserve unknowns and support legacy maps", () => {
  assert.deepEqual(stepApplications(step("email")), []);
  assert.deepEqual(
    stepApplications({ ...step("s"), title: "Notion → Outlook" }).map(
      (a) => a.name,
    ),
    ["Notion", "Outlook"],
  );
  assert.deepEqual(
    stepApplications({ ...step("Notion"), applications: [] }),
    [],
  );
  assert.equal(
    stepApplications({ ...step("s"), applications: ["Internal ERP"] })[0].name,
    "Internal ERP",
  );
});

test("swimlanes group responsibility without guessing an actor for unknown steps", () => {
  const source = map(4);
  source.steps[0].actor = { name: "Demo-User", utteranceId: "u1", quote: "Demo-User" };
  source.steps[1].actor = { name: "Anna", utteranceId: "u2", quote: "Anna" };
  source.steps[2].actor = { name: "demo-user", utteranceId: "u3", quote: "demo-user" };
  const layout = layoutSwimlanes(source);
  assert.deepEqual(layout.lanes?.map((l) => l.name), ["Demo-User", "Anna", "To clarify"]);
  assert.equal(layout.nodes[0].position.y, layout.nodes[2].position.y);
  assert.equal(layout.edges.length, source.edges.length);
  assert.equal(source.steps[3].actor, undefined);
});
test("linear flows stay left-to-right at every viewport without modifying edges", () => {
  const source = map(7),
    original = JSON.stringify(source);
  const result = layoutProcessFlow(source, 1000, 600);
  assert.ok(result.nodes[3].position.x > result.nodes[2].position.x);
  assert.equal(result.nodes[3].position.y, result.nodes[2].position.y);
  assert.equal(result.edges.length, 6);
  assert.equal(JSON.stringify(source), original);
  assert.deepEqual(layoutProcessFlow(source, 320, 500).nodes, result.nodes);
  assert.ok(result.edges.every((edge) => edge.points[0].x < edge.points.at(-1)!.x));
});
test("branches, loops, disconnected and maximum-sized maps have finite non-overlapping nodes", () => {
  for (const source of [
    map(1),
    map(20),
    {
      ...map(5),
      edges: [
        { from: "0", to: "1", label: "yes" },
        { from: "0", to: "2", label: "no" },
        { from: "2", to: "0", label: "retry" },
      ],
    },
    { ...map(4), edges: [] },
  ]) {
    const result = layoutProcessFlow(source, 800, 600);
    assert.equal(result.edges.length, source.edges.length);
    for (const [i, a] of result.nodes.entries()) {
      assert.ok(Number.isFinite(a.position.x) && Number.isFinite(a.position.y));
      for (const b of result.nodes.slice(i + 1))
        assert.ok(
          Math.abs(a.position.x - b.position.x) >= NODE_WIDTH ||
            Math.abs(a.position.y - b.position.y) >= NODE_HEIGHT,
        );
    }
    for (const edge of result.edges)
      assert.ok(
        edge.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
      );
  }
});
