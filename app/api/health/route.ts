import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { GEMINI_MODEL, GEMINI_FAST_MODEL } from "@/lib/constants";
import { generateAndSavePosts } from "@/lib/gemini-content";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Check = { ok: boolean; detail: string };

// Setup check for the free deployment: open /api/health while signed in to see
// which piece (env vars, database, Gemini, post generation) is failing.
// /api/health?retry=1 re-runs post generation for the latest upload and reports the result.
export async function GET(req: Request) {
  const retry = new URL(req.url).searchParams.get("retry") === "1";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first, then open /api/health again." }, { status: 401 });
  }

  const checks: Record<string, Check> = {};

  const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_KEY", "GEMINI_API_KEY"];
  const missing = required.filter((k) => !process.env[k]?.trim());
  checks.env = missing.length
    ? { ok: false, detail: `Missing in Vercel: ${missing.join(", ")}` }
    : { ok: true, detail: "All required variables are set" };

  try {
    const service = createServiceClient();
    const { count, error } = await service.from("personas").select("id", { count: "exact", head: true });
    checks.database = error
      ? { ok: false, detail: `${error.message} — check SUPABASE_SERVICE_KEY and that supabase/setup.sql was run` }
      : { ok: (count ?? 0) > 0, detail: `${count ?? 0} personas found${count ? "" : " — run supabase/setup.sql"}` };
  } catch (err) {
    checks.database = { ok: false, detail: String(err) };
  }

  // Ping both models used by the app: chat/PDF and bulk generation (skipped on retry to save time)
  for (const [name, modelId] of retry ? [] : ([["gemini", GEMINI_MODEL], ["gemini_fast", GEMINI_FAST_MODEL]] as const)) {
    try {
      const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "").getGenerativeModel({ model: modelId });
      const started = Date.now();
      const result = await model.generateContent("Reply with the single word: ok");
      checks[name] = { ok: true, detail: `Model "${modelId}" answered "${result.response.text().trim().slice(0, 20)}" in ${Date.now() - started} ms` };
    } catch (err) {
      checks[name] = { ok: false, detail: `Model "${modelId}": ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // Did the user's latest upload produce anything?
  const { data: latest } = await supabase
    .from("materials")
    .select("id, title, raw_text, created_at, teaching_plan")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest) {
    if (retry) {
      const { data: profile } = await supabase.from("profiles").select("enabled_personas").eq("id", user.id).single();
      const result = await generateAndSavePosts({
        material_id: latest.id,
        raw_text: latest.raw_text,
        title: latest.title,
        enabled_personas: profile?.enabled_personas ?? undefined,
      });
      checks.retry = {
        ok: result.inserted > 0,
        detail: `Generated ${result.inserted} posts${result.error ? ` — errors: ${result.error}` : " — open the feed"}`,
      };
    }

    const generation = retry ? undefined : (latest.teaching_plan as { generation?: { posts?: number; error?: string | null; at?: string } } | null)?.generation;
    if (!retry) checks.last_generation = generation
      ? { ok: (generation.posts ?? 0) > 0, detail: `${generation.posts ?? 0} posts at ${generation.at}${generation.error ? ` — errors: ${generation.error}` : ""}` }
      : { ok: false, detail: "No generation result recorded — the background job never finished (timeout?). Try /api/health?retry=1" };

    const [{ count: postCount }, { count: quizCount }] = await Promise.all([
      supabase.from("posts").select("id", { count: "exact", head: true }).eq("material_id", latest.id),
      supabase.from("quizzes").select("id", { count: "exact", head: true }).eq("material_id", latest.id),
    ]);
    checks.latest_upload = {
      ok: (postCount ?? 0) > 0,
      detail: `"${latest.title}": ${postCount ?? 0} posts, ${quizCount ?? 0} quizzes`,
    };
  }

  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 500 });
}
