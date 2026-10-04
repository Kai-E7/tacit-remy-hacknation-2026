// node --env-file=.env.local scripts/refine-participant-guardrail.mjs [--apply|--restore-original]
// Dry-run by default. Never logs credentials, agent IDs, other prompts or transcripts.
const name = "No sharing other participants' answers";
const originalPrompt =
  "Block the agent from referencing or comparing to what other research participants have said. Each interview must stand alone.";
const refinedPrompt =
  "Block only if the agent explicitly reveals or compares private statements from a DIFFERENT interview participant or an unauthorized conversation. Do not block a summary of this conversation, a coworker or approver named by this speaker, or a comparison with a prior process version explicitly supplied as authorized reference. A person's name alone is not evidence of another interview. If there is no clear disclosure of another participant's private answer, allow the response.";

const key = process.env.ELEVENLABS_API_KEY;
const id = process.env.ELEVENLABS_INTERVIEWER_AGENT_ID;
if (!key || !id) throw new Error("Missing interviewer configuration");
const url = `https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(id)}`;
const headers = { "xi-api-key": key, "content-type": "application/json" };
async function getAgent() {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Agent read failed (${response.status})`);
  return response.json();
}
function selectedGuardrail(agent) {
  const guardrails = agent.platform_settings?.guardrails;
  const configs = guardrails?.custom?.config?.configs;
  if (!Array.isArray(configs)) throw new Error("Unexpected guardrail configuration");
  const matches = configs.filter((item) => item.name === name);
  if (matches.length !== 1) throw new Error("Expected exactly one participant guardrail");
  return { guardrails, configs, target: matches[0] };
}

const restore = process.argv.includes("--restore-original");
const apply = process.argv.includes("--apply") || restore;
const agent = await getAgent();
const { guardrails, configs, target } = selectedGuardrail(agent);
if (!target.is_enabled || target.execution_mode !== "streaming" || target.trigger_action?.type !== "end_call")
  throw new Error("Safety configuration changed; refusing automatic update");
const expected = restore ? refinedPrompt : originalPrompt;
const desired = restore ? originalPrompt : refinedPrompt;
if (target.prompt === desired && target.history_message_count === (restore ? 0 : 10)) {
  console.log("Participant guardrail already has the requested configuration.");
  process.exit(0);
}
if (target.prompt !== expected)
  throw new Error("Guardrail prompt changed since inspection; refusing to overwrite it");
if (!apply) {
  console.log("Preview: narrow cross-participant rule; retain enabled streaming/end-call protection; add 10 messages of context. No change applied.");
  process.exit(0);
}
const revised = structuredClone(guardrails);
revised.custom.config.configs = configs.map((item) => item.name === name
  ? { ...item, prompt: desired, history_message_count: restore ? 0 : 10 }
  : item);
const response = await fetch(url, {
  method: "PATCH", headers, signal: AbortSignal.timeout(15000),
  body: JSON.stringify({ platform_settings: { guardrails: revised } }),
});
if (!response.ok) throw new Error(`Agent update failed (${response.status}); no raw provider body logged`);
const verified = await getAgent();
const after = selectedGuardrail(verified);
const actual = after.target;
if (actual.prompt !== desired || actual.history_message_count !== (restore ? 0 : 10) ||
    !actual.is_enabled || actual.execution_mode !== "streaming" || actual.trigger_action?.type !== "end_call" ||
    JSON.stringify(after.configs.filter((item) => item.name !== name)) !==
      JSON.stringify(configs.filter((item) => item.name !== name)))
  throw new Error("Guardrail verification failed; inspect the provider dashboard before testing");
console.log(`Verified ${restore ? "original" : "refined"} participant privacy guardrail. It remains enabled and ends a call on a clear violation. New conversations use the change.`);
