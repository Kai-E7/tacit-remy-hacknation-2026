export type QuestionTiming = "unset" | "during" | "end";

/** Recognize an explicit answer to Remy's opening question; ambiguity never opts in. */
export function questionTimingFromAnswer(input: string): QuestionTiming {
  const text = input.toLowerCase().replace(/[’']/g, "'").trim();
  const end = /\b(at the end|save (?:your )?(?:them|questions|it) (?:for|until) (?:the )?end|after (?:the )?(?:process|walkthrough)|don't interrupt|do not interrupt|no interruptions|ask later|fragen am ende|erst am ende|nicht unterbrechen)\b/.test(text);
  const during = /\b(as we go|along the way|during (?:the )?(?:process|walkthrough)|jump in|interrupt (?:me )?(?:when|if|as)|ask (?:me )?(?:questions )?(?:now|while|during)|frag (?:ruhig |gerne )?zwischendurch|unterbrich (?:mich )?ruhig)\b/.test(text);
  if (end === during) return "unset";
  return end ? "end" : "during";
}

/** Later changes require explicit wording about questions or interruption. */
export function questionTimingChange(input: string): QuestionTiming {
  if (input.length > 180 || !/\b(question|ask|interrupt|frag|frage|unterbrich|zwischendurch)\w*\b/i.test(input))
    return "unset";
  return questionTimingFromAnswer(input);
}

export function questionTimingContext(timing: Exclude<QuestionTiming, "unset">) {
  return timing === "during"
    ? "Application interview preference: the expert explicitly allows short questions during the walkthrough. Ask one useful question at a natural pause after they finish speaking. Never speak over them or interrupt a request for quiet."
    : "Application interview preference: the expert explicitly chose QUESTIONS AT THE END. During the walkthrough, do not ask any process-related question or send a question-like acknowledgment, even if you notice a gap or the expert pauses. Brief factual acknowledgments are fine. Keep gaps for the debrief. Only when the expert signals completion: first ask whether the whole process is finished; after confirmation, ask remaining questions one at a time. This preference overrides generic active-listening advice.";
}
