// TaskerBay AI: a Supabase Edge Function that asks Claude on the server, so your API key never reaches the browser.
// Deploy:  supabase functions deploy ai
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// Only signed-in TaskerBay users can call it (Supabase checks the login token before this code runs).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SMART = Deno.env.get("AI_MODEL_SMART") ?? "claude-sonnet-5-5";
const FAST = Deno.env.get("AI_MODEL_FAST") ?? "claude-haiku-5-5";

async function claude(prompt: string, model: string, maxTokens = 1200): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set on the server");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error(`Claude API ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return (j.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
}
function parseJSON(text: string): unknown {
  const t = text.trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) try { return JSON.parse(fence[1]); } catch { /* fall through */ }
  const s = Math.min(...["{", "["].map(c => t.indexOf(c)).filter(i => i >= 0));
  const e = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (isFinite(s) && e > s) return JSON.parse(t.slice(s, e + 1));
  throw new Error("Claude's answer was not valid JSON");
}

// deno-lint-ignore no-explicit-any
const PROMPTS: Record<string, (p: any) => { prompt: string; model: string; json: boolean }> = {
  plan_day: p => ({
    model: SMART, json: true,
    prompt: `You are a calm, practical productivity coach for an HR and payroll professional in Dubai (UAE working week Mon–Fri).
It is now ${p.now}. Today's date key is ${p.today}.
Open tasks assigned to the user (JSON): ${JSON.stringify(p.tasks).slice(0, 20000)}
Today's routine (JSON): ${JSON.stringify(p.routine)}
Focus minutes so far today: ${p.focus_minutes}.
Build a realistic plan for the REST of today, starting from the current time. Respect fixed routine times. Put overdue and high-priority work first, include at least one 25-minute focus block and a short break, and don't overload the day.
Reply with only JSON: {"headline":"max 12 words, specific and encouraging","top3":["task id",...],"plan":[{"time":"HH:MM","what":"max 10 words"}],"tip":"one practical sentence"}
top3 holds up to 3 ids copied exactly from the task list. plan has 3 to 7 entries.`,
  }),
  breakdown: p => ({
    model: FAST, json: true,
    prompt: `Break this task into 3 to 7 small, concrete next steps a busy professional can tick off. Each step starts with a verb and is at most 8 words.
Task: ${JSON.stringify(p.title)}
${p.path?.length ? `It is a step inside: ${JSON.stringify(p.path)}` : ""}
Notes: ${JSON.stringify(p.notes ?? "")}
Steps already listed (don't repeat): ${JSON.stringify(p.existing ?? [])}
Reply with only a JSON array of strings.`,
  }),
  capture: p => ({
    model: FAST, json: true,
    prompt: `Turn this note into tasks and money entries. Today is ${p.weekday} ${p.today}. Resolve relative dates to YYYY-MM-DD.
People in the workspace: ${JSON.stringify(p.people)}
Note: ${JSON.stringify(p.text)}
Reply with only a JSON array. Each item is either
{"type":"task","title":"short, starts with a verb","due":"YYYY-MM-DD or null","area":"Work|Personal|Projects","priority":"High|Medium|Low","steps":["optional sub-steps"],"assignee":"first name from the people list or null"}
or {"type":"expense","title":"short","amount":number,"flow":"out|in","category":"${(p.categories ?? []).join("|")}","date":"YYYY-MM-DD"}.
Money already spent or received becomes an expense. Use High priority only for urgent items. Put sub-steps in "steps" when the note lists them.`,
  }),
  month_insights: p => ({
    model: SMART, json: false,
    prompt: `You are a friendly personal-finance coach in Dubai. Amounts are in ${p.currency}.
Month ${p.month}: spent ${p.spent}, received ${p.income}.
By category: ${JSON.stringify(p.by_category)}
Monthly budgets: ${JSON.stringify(p.budgets)}
Previous month by category: ${JSON.stringify(p.previous)}
Largest entries: ${JSON.stringify(p.largest)}
Write 3 short bullet points (start each with "• "): where most money went, anything unusual versus last month or budgets, and one specific action for next month. Plain text, under 90 words.`,
  }),
};

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { kind, payload } = await req.json();
    const build = PROMPTS[kind];
    if (!build) return new Response(JSON.stringify({ error: "Unknown AI request" }), { status: 400, headers: { ...CORS, "content-type": "application/json" } });
    const { prompt, model, json } = build(payload ?? {});
    const text = await claude(prompt, model);
    const result = json ? parseJSON(text) : text.trim();
    return new Response(JSON.stringify({ result }), { headers: { ...CORS, "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 200, headers: { ...CORS, "content-type": "application/json" } });
  }
});
