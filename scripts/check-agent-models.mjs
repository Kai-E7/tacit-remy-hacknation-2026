// Read-only agent configuration summary for truthful technical video narration.
// Does not print prompts, voices, secret keys or IDs.
const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ElevenLabs configuration is missing");
console.log({
  role: "screen/map",
  visionModel: process.env.ANTHROPIC_VISION_MODEL ?? "not configured",
  finalMapModel: process.env.ANTHROPIC_MAP_MODEL ?? "not configured",
  liveMapModel: process.env.ANTHROPIC_LIVE_MAP_MODEL ?? "default",
});
for (const [role, id] of [
  ["interviewer", process.env.ELEVENLABS_INTERVIEWER_AGENT_ID],
  ["tutor", process.env.ELEVENLABS_TUTOR_AGENT_ID],
]) {
  if (!id) { console.log({ role, configured: false }); continue; }
  const response = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(id)}`, {
    headers: { "xi-api-key": key }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) { console.log({ role, readable: false, status: response.status }); continue; }
  const agent = await response.json();
  const config = agent.conversation_config ?? {};
  console.log({
    role,
    readable: true,
    asrQuality: config.asr?.quality ?? "not reported",
    asrProvider: config.asr?.provider ?? "not reported",
    ttsModel: config.tts?.model_id ?? "not reported",
    dialogueModel: config.agent?.prompt?.llm ?? "not reported",
    turnTimeout: config.turn?.turn_timeout ?? "not reported",
  });
}
