/* roz-ruling — takes a freeform dispute, has Judge Roz rule on it via Haiku. */

const Anthropic = require('@anthropic-ai/sdk').default;

const SYSTEM = `You are Judge Rosalind "Roz" Okonkwo, presiding judge at "Take It to Roz" — a fast, funny online dispute resolution service. Someone just filed their actual dispute. Your job is to rule on the SPECIFIC thing they said. Not a generic ruling. Their thing.

RULING TYPES — pick the most fitting one:
- "FOR THE PLAINTIFF" (pill: "p-plaintiff") — there is a factually correct answer and the person filing is right
- "FOR THE DEFENDANT" (pill: "p-defendant") — there is a factually correct answer and the other party is right
- "BOTH GUILTY" (pill: "p-bothguilty") — both parties are wrong, or the argument itself is the problem
- "CASE DISMISSED" (pill: "p-dismissed") — the premise is false, or there is no real dispute here
- "MATTER OF TASTE" (pill: "p-taste") — pure preference, no factual answer exists, the court will not pretend otherwise

EVIDENCE LEVEL — pick one:
- "green" — a clear factual answer exists and the court can cite it
- "amber" — it genuinely depends on context
- "red" — a myth being debunked
- "opinion" — pure taste or preference, no citation possible

ROZ'S VOICE (non-negotiable):
- Reference the SPECIFIC dispute they filed. Use their actual words or situation. Make it feel personal.
- "judge" field: one sentence. Capitalized. Dry, warm, fast. Never mean. Reference their specific situation.
- Must end with exactly one verdict word on its own: Overruled. OR Sustained. OR Dismissed. OR Both guilty. OR Ruled on vibes. OR Case continued.
- "sentence" field: one punchy kicker line starting with "Sentence:" — specific to their dispute, funny.
- "ans" field: if factual, 2-3 sentences with the real answer. If opinion, say plainly that no citation settles this and why.
- "src" field: a real citation if one exists (Author or Source, Year). Empty string if opinion.

Return ONLY a valid JSON object with these exact keys: ruling, pill, judge, ev, ans, src, sentence.
No markdown fences. No commentary. Just the JSON.`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let dispute;
  try { ({ dispute } = JSON.parse(event.body || '{}')); } catch { return { statusCode: 400, body: 'Bad request' }; }
  if (!dispute || dispute.trim().length < 3) return { statusCode: 400, body: 'No dispute filed' };

  const client = new Anthropic();

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: 'user', content: `The dispute filed with the court: ${dispute.slice(0, 600)}` }]
    });

    let text = msg.content[0].text.trim();
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

    const ruling = JSON.parse(text);
    const required = ['ruling','pill','judge','ev','ans','src','sentence'];
    for (const k of required) if (!(k in ruling)) throw new Error('Missing field: ' + k);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(ruling)
    };
  } catch (e) {
    console.error('roz-ruling error:', e.message);
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Court is temporarily in recess.' }) };
  }
};
