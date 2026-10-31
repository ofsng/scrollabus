import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { GEMINI_MODEL } from "@/lib/constants";

export const dynamic = "force-dynamic";

type Check = { ok: boolean; detail: string };

// Setup check for the free deployment: open /api/health while signed in to see
// which piece (env vars, database, Gemini, post generation) is failing.
export async function GET() {
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

  try {
    const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "").getGenerativeModel({ model: GEMINI_MODEL });
    const result = await model.generateContent("Reply with the single word: ok");
    checks.gemini = { ok: true, detail: `Model "${GEMINI_MODEL}" answered: ${result.response.text().trim().slice(0, 40)}` };
  } catch (err) {
    checks.gemini = { ok: false, detail: `Model "${GEMINI_MODEL}": ${err instanceof Error ? err.message : String(err)}` };
  }

  // Did the user's latest upload produce anything?
  const { data: latest } = await supabase
    .from("materials")
    .select("id, title, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest) {
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
