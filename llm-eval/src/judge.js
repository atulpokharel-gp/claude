// LLM-as-judge: score a model's final answer against a prompt's 0-3 rubric and
// return a numeric score plus the judge's reasoning (kept for inspection).
import { extractJson } from './prompts.js';

const JUDGE_SYSTEM = `You are a strict, consistent evaluator of language-model answers.
You are given the original prompt, a scoring rubric, and a candidate answer.
Score the candidate on an integer scale from 0 to 3 using the rubric.
Be calibrated: reserve 3 for genuinely excellent answers and 0 for wrong/empty ones.
Respond with ONLY strict JSON: {"score": <0-3 integer>, "reasoning": "<two or three sentences>"}`;

/**
 * @param chat     the providers.chat function
 * @param judge    { provider, model }
 * @param promptText   the user-visible prompt (last user turn, flattened)
 * @param rubric   scoring guide string
 * @param answer   candidate final answer (thinking already stripped)
 */
export async function judgeAnswer({ chat, judge, promptText, rubric, answer }) {
  const res = await chat(judge.provider, {
    model: judge.model,
    temperature: 0,
    maxTokens: 600,
    messages: [
      { role: 'system', content: JUDGE_SYSTEM },
      {
        role: 'user',
        content:
          `## Prompt\n${promptText}\n\n` +
          `## Rubric (0-3)\n${rubric}\n\n` +
          `## Candidate answer\n${answer || '(empty)'}\n\n` +
          `Now return the JSON verdict.`,
      },
    ],
  });
  const parsed = extractJson(res.text) || {};
  let score = Number(parsed.score);
  if (!Number.isFinite(score)) score = null;
  else score = Math.max(0, Math.min(3, Math.round(score)));
  return {
    score,
    reasoning: parsed.reasoning || res.text?.slice(0, 500) || '',
    judgeLatencyMs: res.latencyMs,
    judgeModel: judge.model,
  };
}
