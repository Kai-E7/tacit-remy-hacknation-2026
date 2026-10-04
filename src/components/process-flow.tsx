"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BaseEdge,
  Handle,
  MarkerType,
  Position,
  type Node,
  type NodeProps,
  type Edge,
  type EdgeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  layoutProcessFlow,
  layoutSwimlanes,
  NODE_HEIGHT,
  NODE_WIDTH,
  stepApplications,
} from "../lib/process-flow";
import type { WorkMap, WorkStep } from "../lib/work-map";
import type { Evidence } from "../lib/processes";
import "./process-flow.css";

type StepNode = Node<
  {
    step: WorkStep;
    number: number;
    hasFrame: boolean;
    hasRule: boolean;
    rule: string;
    ruleStatus: "draft" | "reviewed" | "example";
    edited: boolean;
    open: (id: string) => void;
  },
  "workStep"
>;
type LaneNode = Node<{ name: string; unknown: boolean }, "lane">;
type DiagramNode = StepNode | LaneNode;
type RouteEdge = Edge<
  {
    points: { x: number; y: number }[];
    labelPosition: { x: number; y: number };
  },
  "route"
>;

export function AppBadges({ step }: { step: WorkStep }) {
  const apps = stepApplications(step);
  return (
    <div className="flow-apps">
      {apps.length ? (
        apps.map((app) => (
          <span className="flow-app" key={app.name} title={app.name}>
            <i style={{ backgroundColor: app.color }} aria-hidden="true">
              {app.mark}
            </i>
            {app.name}
          </span>
        ))
      ) : (
        <span className="flow-app flow-app-unknown">App not identified</span>
      )}
    </div>
  );
}

function StepCard({ data }: NodeProps<StepNode>) {
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <button
        type="button"
        className={`flow-step nodrag ${data.step.decision ? "flow-step-decision" : ""}`}
        onClick={() => data.open(data.step.id)}
        aria-label={`Step ${data.number}: ${data.step.title} — open evidence`}
      >
        <div className="flow-step-top">
          <span className="flow-step-number">
            {String(data.number).padStart(2, "0")}
          </span>
          <span>
            {data.step.decision ? "◇ Decision" : "Process step"}
          </span>
        </div>
        <AppBadges step={data.step} />
        <strong title={data.step.title}>{data.step.title}</strong>
        <span className="flow-step-action" title={data.step.action}>
          {data.step.action}
        </span>
        <span className="flow-insights">
          {data.hasRule && <span className="flow-insight flow-insight-rule" title={data.rule}>
            <b>MUST · {data.ruleStatus}</b> {data.rule}
          </span>}
          {data.step.reason && <span className="flow-insight flow-insight-why" title={data.step.reason}>
            <b>Expert know-how</b> {data.step.reason}
          </span>}
          {data.step.decision && <span className="flow-insight flow-insight-human" title={data.step.decision}>
            <b>Human judgment</b> {data.step.decision}
          </span>}
          {data.edited && <span className="flow-insight flow-insight-revised"><b>✎ Revised</b></span>}
        </span>
        <span className="flow-step-source">
          {data.hasFrame ? "▧ Screenshot" : "No screenshot"} ·{" "}
          {data.step.provenance === "explained"
            ? "explained only"
            : "screen-linked"}{" "}
          ↗
        </span>
      </button>
      <Handle type="source" position={Position.Right} />
    </>
  );
}
function RoutedEdge(props: EdgeProps<RouteEdge>) {
  const route = props.data;
  if (!route) return null;
  const path = route.points
    .map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`)
    .join(" ");
  const label = typeof props.label === "string" ? props.label : "";
  return (
    <g>
      <title>{label}</title>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        style={{ stroke: "#708577", strokeWidth: 1.8 }}
        label={label.length > 22 ? `${label.slice(0, 21)}…` : label}
        labelX={route.labelPosition.x}
        labelY={route.labelPosition.y}
        labelStyle={{ fontSize: 11, fill: "#40574a" }}
        labelBgStyle={{ fill: "#f7f8f2" }}
        labelBgPadding={[6, 4]}
        labelBgBorderRadius={4}
      />
    </g>
  );
}
function Lane({ data }: NodeProps<LaneNode>) {
  return (
    <div className={`flow-lane ${data.unknown ? "flow-lane-unknown" : ""}`} style={{ width: "100%", height: "100%" }}>
      <span className="flow-lane-label">{data.name}</span>
    </div>
  );
}
const nodeTypes = { workStep: StepCard, lane: Lane };
const edgeTypes = { route: RoutedEdge };
const fitOptions = { padding: 0.12, maxZoom: 1, minZoom: 0.05 };

export function ProcessFlow({
  map,
  evidence,
  onOpen,
  onExpand,
  expanded = false,
  editedStepIds = [],
  reviewed = false,
  synthetic = false,
}: {
  map: WorkMap;
  evidence: Evidence[];
  onOpen: (id: string) => void;
  onExpand?: () => void;
  expanded?: boolean;
  editedStepIds?: string[];
  reviewed?: boolean;
  synthetic?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 700, height: 530 });
  const [instance, setInstance] = useState<ReactFlowInstance<
    DiagramNode,
    RouteEdge
  > | null>(null);
  const swimlanes = !evidence.length || map.steps.some((s) => s.actor?.name);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setSize({ width, height });
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const layout = useMemo(
    () =>
      swimlanes
        ? layoutSwimlanes(map)
        : layoutProcessFlow(map, size.width, size.height),
    [map, size, swimlanes],
  );
  const nodes: DiagramNode[] = layout.nodes.map((node) => {
    const step = map.steps.find((s) => s.id === node.id)!;
    return {
      ...node,
      type: "workStep",
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      focusable: false,
      data: {
        step,
        number: map.steps.indexOf(step) + 1,
        hasFrame: evidence.some((f) => f.id === step.frameId),
        hasRule: map.guardrails.some((g) => g.stepId === step.id),
        rule: map.guardrails.find((g) => g.stepId === step.id)?.rule ?? "",
        ruleStatus: synthetic ? "example" : reviewed ? "reviewed" : "draft",
        edited: editedStepIds.includes(step.id),
        open: onOpen,
      },
    };
  });
  nodes.unshift(
    ...(layout.lanes ?? []).map((lane): LaneNode => ({
      id: lane.id,
      type: "lane",
      position: lane.position,
      width: lane.width,
      height: lane.height,
      style: { width: lane.width, height: lane.height, pointerEvents: "none" },
      zIndex: -1,
      focusable: false,
      selectable: false,
      data: { name: lane.name, unknown: lane.unknown },
    })),
  );
  const edges: RouteEdge[] = layout.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    label: edge.label,
    type: "route",
    data: edge,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "#708577",
      width: 16,
      height: 16,
    },
  }));
  useEffect(() => {
    const timer = requestAnimationFrame(() => {
      if (!instance) return;
      if (map.steps.length <= 4) {
        void instance.fitView(fitOptions);
        return;
      }
      // A seven-step map shrunk to fit is unreadable. Start at the left edge;
      // panning and "Show all" reveal the rest without rotating the flow.
      const first = layout.nodes.find((node) => node.id === map.steps[0]?.id) ?? layout.nodes[0];
      const zoom = expanded ? 0.95 : 0.85;
      const centerY = first.position.y + NODE_HEIGHT / 2;
      void instance.setViewport({ x: 24 - first.position.x * zoom, y: size.height / 2 - centerY * zoom, zoom });
    });
    return () => cancelAnimationFrame(timer);
  }, [instance, layout, map.steps, expanded, size.height]);
  return (
    <section
      className={`process-flow ${expanded ? "process-flow-expanded" : ""} ${swimlanes ? "process-flow-lanes" : ""}`}
      aria-label={expanded ? "Expanded process diagram" : "Process flow diagram"}
    >
      <div className="flow-toolbar">
        <div>
          <strong>
            {swimlanes
              ? "Process flow · responsibilities"
              : "Process flow"}
          </strong>
          <span>{map.steps.length} steps · left to right · drag to explore · click for evidence</span>
        </div>
        <div className="flow-tools">
          <button
            type="button"
            aria-label="Zoom out of diagram"
            onClick={() => void instance?.zoomOut()}
          >
            −
          </button>
          <button
            type="button"
            aria-label="Zoom in on diagram"
            onClick={() => void instance?.zoomIn()}
          >
            +
          </button>
          <button
            type="button"
            onClick={() => void instance?.fitView(fitOptions)}
          >
            Show all
          </button>
          {onExpand && (
            <button type="button" onClick={onExpand}>
              Expand ↗
            </button>
          )}
        </div>
      </div>
      <div ref={container} className="flow-canvas">
        <ReactFlow<DiagramNode, RouteEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onInit={setInstance}
          fitView
          fitViewOptions={fitOptions}
          minZoom={0.05}
          maxZoom={1.8}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          edgesFocusable={false}
          deleteKeyCode={null}
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
        >
          <Background color="#d7ded2" gap={22} size={1} />
        </ReactFlow>
      </div>
      {swimlanes && (
        <p className="flow-lane-caption">
          One process · one lane per named responsibility. Unknown roles remain
          open for clarification. BPMN-inspired view, not a validated BPMN export.
        </p>
      )}
      <div className="flow-legend">
        <span>→ Flow</span>
        <span>◇ Decision</span>
        <span>▧ Screen evidence</span>
        <span>✦ Know-how · expert's why</span>
        <span>⚑ MUST · stated boundary</span>
        <span>◇ Human judgment · check with an expert</span>
        <span>{synthetic ? "Synthetic example" : reviewed ? "Expert-reviewed map" : "AI draft · please review"}</span>
      </div>
    </section>
  );
}
