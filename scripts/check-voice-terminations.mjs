// Read-only metadata audit. Never prints transcripts, conversation IDs or credentials.
// Run: node --env-file=.env.local scripts/check-voice-terminations.mjs
const key = process.env.ELEVENLABS_API_KEY;
const id = process.env.ELEVENLABS_INTERVIEWER_AGENT_ID;
if (!key || !id) throw new Error("Interviewer configuration is missing");
const url = new URL("https://api.elevenlabs.io/v1/convai/conversations");
url.searchParams.set("agent_id", id);
url.searchParams.set("call_start_after_unix", String(Math.floor(Date.now() / 1000) - 6 * 3600));
url.searchParams.set("page_size", "20");
const response = await fetch(url, { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(10000) });
if (!response.ok) throw new Error(`Conversation metadata unavailable (${response.status})`);
const result = await response.json();
const rows = (Array.isArray(result.conversations) ? result.conversations : []).slice(0, 12);
console.log(rows.map((item, index) => ({
  newestIndex: index,
  startedUtc: new Date(item.start_time_unix_secs * 1000).toISOString(),
  seconds: item.call_duration_secs,
  status: item.status,
  success: item.call_successful,
  termination: item.termination_reason || "not reported",
})));
