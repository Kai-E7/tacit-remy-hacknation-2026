// Run with Node 24: node --env-file=.env.local scripts/refine-remy.mjs [--apply]
// Reads only the interviewer. Updates only dialogue/turn settings; leaves safety rules intact.
import {
  REMY_DIALOGUE_GUIDANCE,
  REMY_LISTENING_GUIDANCE,
} from "../src/lib/remy-dialogue.ts";

const key = process.env.ELEVENLABS_API_KEY;
const id = process.env.ELEVENLABS_INTERVIEWER_AGENT_ID;
if (!key || !id) throw new Error("Missing interviewer configuration");
const url = `https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(id)}`;
const headers = { "xi-api-key": key, "content-type": "application/json" };
const response = await fetch(url, { headers });
if (!response.ok) throw new Error(`Agent read failed (${response.status})`);
const agent = await response.json();
const marker = "[Remy dialogue and completion protocol]";
const opening = "Hi, I'm Remy. May I jump in with short questions as we go, or would you prefer I save questions for the end?";
let base = agent.conversation_config.agent.prompt.prompt
  .split(marker)[0]
  .replace(/(?:\\n|\s)+$/, "");
base = base
  .replace(
    "Comfortable with silence",
    "Comfortable with requested silence; audibly engaged after completed explanations",
  )
  .replace(
    "If reading cannot be observed reliably, wait conservatively or ask: “Are you ready to continue?”",
    "Do not assume reading from missing telemetry. After a completed explanation and a natural pause, acknowledge the concrete step or ask one useful follow-up.",
  )
  .replace(
    "Ask less often, but ask better questions.",
    "Respond briefly when the expert yields the floor; prioritize useful questions over filler.",
  );
const workflow = structuredClone(agent.workflow);
const processPrompts = {
  "Consent & Intro": "The application has already obtained capture consent. The fixed first message asks whether short questions may come during the process or only at the end. Wait for that choice, then invite the expert to show or describe the first step. Do not infer session completion from silence. Respect an immediate request to stop or revoke consent.",
  "Open-Ended Discovery": `This is a workflow apprenticeship, not opinion research. Invite the expert to show or describe the real sequence in their own words. Learn what they do, why, who decides, exceptions and stop conditions. Never ask for prototype ratings or generic opinions. Respect the selected question-timing preference.\n\n${REMY_LISTENING_GUIDANCE}`,
  "Assess Depth Available": "This is an ongoing process walkthrough. If the expert is explaining, showing another screen, or merely quiet, continue the process conversation; do not wrap up. Take a priority path only if the expert explicitly says time is short. Move toward closing only when the expert explicitly says the process is finished or requests an immediate stop. Silence and elapsed time are not evidence of completion.",
  "Deep Dive": `Keep learning the process, especially decision criteria, reasons, exceptions, responsibilities and stop/escalation rules. In questions-as-we-go mode ask at natural pauses; in end-only mode hold questions. Do not set a fixed number of questions or infer completion from silence. Stay in this phase until the expert explicitly says the process is complete or asks to stop.\n\n${REMY_LISTENING_GUIDANCE}`,
  "Priority Questions Only": `The expert explicitly said time is short. Ask only the most valuable grounded question if their selected timing mode permits it; otherwise save it. Never force a three-question quota. Stay with the expert until they explicitly finish the process or request an immediate stop.\n\n${REMY_LISTENING_GUIDANCE}`,
  "Polite Close": "If the expert requested an immediate stop or revoked consent, comply without further questioning. Otherwise first ask whether this is the complete process, then wait for an explicit answer. If not complete, return to process discovery. Only after an explicit yes, give a grounded short summary, clarify remaining gaps one at a time, ask for corrections, and wait until the expert confirms nothing remains. Never end because of silence or time elapsed.",
  "Submit Notes": "Do not claim to write to any repository or to have saved a process. The application handles a local draft on session end. Only after the expert explicitly completes the wrap-up or requests immediate stop, thank them briefly and allow the call to close.",
};
const seen = new Set();
for (const node of Object.values(workflow?.nodes ?? {})) {
  if (node.label in processPrompts) {
    seen.add(node.label);
    node.additional_prompt = processPrompts[node.label];
    if (["Open-Ended Discovery", "Deep Dive", "Priority Questions Only"].includes(node.label)) {
      node.conversation_config ??= {};
      node.conversation_config.turn = {
        ...node.conversation_config.turn,
        turn_eagerness: "normal",
        turn_timeout: 5,
      };
    }
  }
}
if (seen.size !== Object.keys(processPrompts).length || !workflow?.edges?.e5 || !workflow?.edges?.e6)
  throw new Error("Unexpected interviewer workflow; refusing to patch it");
workflow.edges.e2.forward_condition.condition = "The expert answered the opening question-timing preference or began the workflow explanation after application consent. Do not repeat app consent.";
workflow.edges.e3.forward_condition.condition = "The expert completed at least one substantive process explanation and is continuing. Silence alone does not mean finished.";
workflow.edges.e4a.forward_condition.condition = "The expert is still explaining or showing the process; ambiguous pauses default to continuing.";
workflow.edges.e4b.forward_condition.condition = "The expert explicitly says time is short but still wants to explain the process.";
workflow.edges.e4c.forward_condition.condition = "The expert explicitly says the full process is complete or requests an immediate stop. Never infer this from silence or elapsed time.";
for (const edge of [workflow.edges.e5, workflow.edges.e6]) {
  edge.target = "polite_close";
  edge.forward_condition.condition = "The expert explicitly said the full process is complete or requested an immediate stop. Silence or a single completed step is insufficient.";
}
workflow.edges.e7.forward_condition.condition = "The expert confirmed the full process and the grounded wrap-up and said nothing remains, or explicitly requested immediate stop or revoked consent.";
workflow.edges.e8.forward_condition.condition = "The expert explicitly confirmed the wrap-up was finished or requested immediate stop. Do not end based on silence.";
if (workflow.edges.e_consen_goodbye_auto)
  workflow.edges.e_consen_goodbye_auto.forward_condition.condition = "The expert explicitly requests an immediate stop, revokes consent, or clearly says goodbye. Saying a workflow step is done is not enough.";
const patch = {
  conversation_config: {
    turn: { turn_timeout: 5, turn_eagerness: "normal" },
    agent: {
      first_message: opening,
      prompt: { prompt: `${base}\n\n${marker}\n${REMY_DIALOGUE_GUIDANCE}` },
    },
  },
  workflow,
};
if (!process.argv.includes("--apply")) {
  console.log(
    "Preview: opening asks timing preference; generic research workflow becomes process-specific and cannot auto-close from silence. Safety guardrails unchanged. No changes applied.",
  );
} else {
  const updated = await fetch(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify(patch),
  });
  if (!updated.ok)
    throw new Error(
      `Agent update failed (${updated.status}); no raw provider body logged`,
    );
  const verified = await fetch(url, { headers });
  if (!verified.ok) throw new Error(`Verification failed (${verified.status})`);
  const result = await verified.json();
  const ok =
    result.conversation_config.turn.turn_timeout === 5 &&
    result.conversation_config.agent.first_message === opening &&
    result.workflow.edges.e5.target === "polite_close" &&
    result.workflow.edges.e6.target === "polite_close" &&
    result.workflow.nodes.depth_branch.additional_prompt === processPrompts["Assess Depth Available"] &&
    result.conversation_config.agent.prompt.prompt.includes(
      REMY_LISTENING_GUIDANCE,
    );
  if (!ok)
    throw new Error("Saved configuration did not match expected refinement");
  console.log(
    "Verified: interviewer asks timing preference first; process-specific workflow cannot close from silence or elapsed time. Existing privacy/security configuration was not patched. Start a new conversation to use it.",
  );
}
