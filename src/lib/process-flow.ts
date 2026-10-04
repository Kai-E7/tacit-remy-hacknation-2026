import dagre from "@dagrejs/dagre";
import type { WorkMap, WorkStep } from "./work-map.ts";

export const NODE_WIDTH = 224;
export const NODE_HEIGHT = 262;
type Point = { x: number; y: number };
export type FlowLayout = {
  lanes?: {
    id: string;
    name: string;
    unknown: boolean;
    position: Point;
    width: number;
    height: number;
  }[];
  nodes: { id: string; position: Point }[];
  edges: {
    id: string;
    from: string;
    to: string;
    label: string;
    points: Point[];
    labelPosition: Point;
  }[];
};

/** One pool with responsibility lanes; only quoted assignments create named lanes. */
export function layoutSwimlanes(map: WorkMap): FlowLayout {
  const names = new Map<string, string>();
  const actorKey = (s: WorkStep) =>
    s.actor?.name.trim().toLocaleLowerCase() || "__unknown";
  map.steps.forEach((s) =>
    names.set(
      actorKey(s),
      names.get(actorKey(s)) ?? (s.actor?.name.trim() || "To clarify"),
    ),
  );
  const actors = [...names.keys()];
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "LR" });
  graph.setDefaultEdgeLabel(() => ({}));
  map.steps.forEach((s) =>
    graph.setNode(s.id, { width: NODE_WIDTH, height: NODE_HEIGHT }),
  );
  map.edges.forEach((e) => graph.setEdge(e.from, e.to));
  dagre.layout(graph);
  const ordered = [...map.steps].sort(
    (a, b) => graph.node(a.id).x - graph.node(b.id).x,
  );
  const laneHeight = NODE_HEIGHT + 110;
  const width = 185 + ordered.length * (NODE_WIDTH + 85);
  const lanes = actors.map((key, i) => ({
    id: `lane-${i}`,
    name: names.get(key)!,
    unknown: key === "__unknown",
    position: { x: 0, y: i * laneHeight },
    width,
    height: laneHeight,
  }));
  const nodes = ordered.map((s, i) => ({
    id: s.id,
    position: {
      x: 160 + i * (NODE_WIDTH + 85),
      y: actors.indexOf(actorKey(s)) * laneHeight + 60,
    },
  }));
  const edges = map.edges.map((e, i) => {
    const a = nodes.find((n) => n.id === e.from)!.position,
      b = nodes.find((n) => n.id === e.to)!.position;
    const start = { x: a.x + NODE_WIDTH, y: a.y + NODE_HEIGHT / 2 },
      end = { x: b.x, y: b.y + NODE_HEIGHT / 2 };
    const sameLaneNext =
      start.y === end.y && end.x > start.x && end.x - start.x < 100;
    const gapX = start.x + 25,
      targetGapX = end.x - 25;
    const railY = a.y + NODE_HEIGHT + 18 + (i % 3) * 9;
    const points = sameLaneNext
      ? [start, end]
      : [
          start,
          { x: gapX, y: start.y },
          { x: gapX, y: railY },
          { x: targetGapX, y: railY },
          { x: targetGapX, y: end.y },
          end,
        ];
    return {
      ...e,
      id: `edge-${i}`,
      points,
      labelPosition: sameLaneNext
        ? { x: (start.x + end.x) / 2, y: start.y }
        : { x: (gapX + targetGapX) / 2, y: railY },
    };
  });
  return { lanes, nodes, edges };
}

const knownApps = [
  { name: "Notion", mark: "N", color: "#252525", pattern: /\bnotion\b/i },
  { name: "Outlook", mark: "O", color: "#1264a3", pattern: /\boutlook\b/i },
  { name: "Excel", mark: "X", color: "#217346", pattern: /\bexcel\b/i },
  {
    name: "Teams",
    mark: "T",
    color: "#6264a7",
    pattern: /\b(?:microsoft\s+teams|ms\s+teams)\b/i,
  },
  { name: "Slack", mark: "S", color: "#611f69", pattern: /\bslack\b/i },
  { name: "Gmail", mark: "M", color: "#b33830", pattern: /\bgmail\b/i },
  {
    name: "Google Sheets",
    mark: "S",
    color: "#188038",
    pattern: /\bgoogle\s+(?:sheets|tabellen)\b/i,
  },
  { name: "SAP", mark: "SAP", color: "#086b9c", pattern: /\bsap\b/i },
];

/** Legacy maps: only explicit app mentions in the step, never guess from "email". */
export function stepApplications(step: WorkStep) {
  const names =
    step.applications === undefined
      ? knownApps
          .filter((app) => app.pattern.test(`${step.title} ${step.action}`))
          .map((app) => app.name)
      : step.applications;
  return [...new Set(names)].map((name) => {
    const app = knownApps.find(
      (item) => item.name.toLowerCase() === name.toLowerCase(),
    );
    return {
      name,
      mark: app?.mark ?? name.slice(0, 2).toUpperCase(),
      color: app?.color ?? "#52665a",
    };
  });
}

/** Identify only a proven single chain. Never synthesize links from array order. */
function chainOrder(map: WorkMap): string[] | null {
  if (map.edges.length !== map.steps.length - 1) return null;
  const roots = map.steps.filter((s) => !map.edges.some((e) => e.to === s.id));
  if (roots.length !== 1) return null;
  const result: string[] = [];
  let id: string | undefined = roots[0].id;
  while (id && !result.includes(id)) {
    result.push(id);
    const next = map.edges.filter((e) => e.from === id);
    if (next.length > 1) return null;
    id = next[0]?.to;
  }
  return result.length === map.steps.length ? result : null;
}

export function layoutProcessFlow(
  map: WorkMap,
  width: number,
  height: number,
): FlowLayout {
  const chain = chainOrder(map);
  if (chain) {
    const nodes = chain.map((id, i) => ({
      id,
      position: { x: i * (NODE_WIDTH + 90), y: 0 },
    }));
    const edges = map.edges.map((edge, i) => {
      const a = nodes.find((n) => n.id === edge.from)!.position;
      const b = nodes.find((n) => n.id === edge.to)!.position;
      const points = [
        { x: a.x + NODE_WIDTH, y: a.y + NODE_HEIGHT / 2 },
        { x: b.x, y: b.y + NODE_HEIGHT / 2 },
      ];
      return {
        ...edge,
        id: `edge-${i}`,
        points,
        labelPosition: {
          x: (points[0].x + points[1].x) / 2,
          y: (points[0].y + points[1].y) / 2,
        },
      };
    });
    return { nodes, edges };
  }
  function directed() {
    const graph = new dagre.graphlib.Graph({ multigraph: true });
    graph.setGraph({
      rankdir: "LR",
      nodesep: 65,
      ranksep: 100,
      marginx: 16,
      marginy: 16,
    });
    graph.setDefaultEdgeLabel(() => ({}));
    map.steps.forEach((s) =>
      graph.setNode(s.id, { width: NODE_WIDTH, height: NODE_HEIGHT }),
    );
    map.edges.forEach((e, i) =>
      graph.setEdge(
        e.from,
        e.to,
        { width: e.label ? 100 : 0, height: e.label ? 30 : 0 },
        String(i),
      ),
    );
    dagre.layout(graph);
    return {
      nodes: map.steps.map((s) => {
        const p = graph.node(s.id);
        return {
          id: s.id,
          position: { x: p.x - NODE_WIDTH / 2, y: p.y - NODE_HEIGHT / 2 },
        };
      }),
      edges: map.edges.map((e, i) => {
        const route = graph.edge(e.from, e.to, String(i));
        return {
          ...e,
          id: `edge-${i}`,
          points: route.points,
          labelPosition: {
            x: route.x ?? route.points[1].x,
            y: route.y ?? route.points[1].y,
          },
        };
      }),
      score: Math.min(
        width / (graph.graph().width || 1),
        height / (graph.graph().height || 1),
      ),
    };
  }
  // The embedded and expanded views must never rotate the same map.
  return directed();
}
