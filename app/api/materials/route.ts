import { createClient } from "@/lib/supabase/server";
import { triggerMaterialToPost } from "@/lib/n8n";
import { generateAndSaveQuizzes } from "@/lib/quizzes";
import { writeMemory } from "@/lib/hydra";
import { triggerTeachingWorkflow } from "@/lib/dify";
import { NextRequest, NextResponse, after } from "next/server";

// Background generation runs after the response; give it room on Vercel
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { title, raw_text, source_type = "text" } = body;

  if (!title || !raw_text) {
    return NextResponse.json({ error: "title and raw_text are required" }, { status: 400 });
  }

  if (raw_text.length < 50) {
    return NextResponse.json({ error: "Content too short — paste at least a paragraph." }, { status: 400 });
  }

  // Store material
  const { data: material, error: materialError } = await supabase
    .from("materials")
    .insert({ user_id: user.id, title, raw_text, source_type })
    .select()
    .single();

  if (materialError || !material) {
    return NextResponse.json({ error: materialError?.message ?? "Failed to save material" }, { status: 500 });
  }

  // Fetch user's preferences (non-blocking failure is fine — fall back to defaults)
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("enabled_personas, enable_av_output")
    .eq("id", user.id)
    .single();

  const enabledPersonas: string[] =
    profileRow?.enabled_personas ?? ["lecture-bestie", "exam-gremlin", "problem-grinder"];
  const enableAvOutput: boolean = profileRow?.enable_av_output ?? true;

  // Fire-and-forget: write learner memory signal to HydraDB
  writeMemory({
    userId: user.id,
    text: `User uploaded study material titled "${title}" (${source_type}). Topic preview: ${raw_text.slice(0, 200)}`,
  }).catch(() => {});

  // Background: generate persona-voiced quizzes from the material
  after(() => generateAndSaveQuizzes({
    material_id: material.id,
    raw_text,
    title,
    enabled_personas: enabledPersonas,
  }).catch((err) => {
    console.error("[quiz] Quiz generation failed:", err);
  }));

  // Kick off Dify teaching plan + n8n content pipeline concurrently.
  // We await Dify here (with a short timeout) so we can pass its pedagogical
  // signals (emphasis, priority_personas) directly into the n8n prompt — closing
  // the loop between memory-aware teaching analysis and content generation.
  after(async () => {
    let emphasis: string | undefined;
    let priorityPersonas: string[] | undefined;

    try {
      const difyResult = await Promise.race([
        triggerTeachingWorkflow({
          eventType: "material_uploaded",
          userId: user.id,
          payload: {
            material_id: material.id,
            title,
            source_type,
            topic_preview: raw_text.slice(0, 500),
          },
        }),
        // 10-second ceiling — don't block n8n if Dify is slow
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
      ]);

      if (difyResult && typeof difyResult === "object" && "success" in difyResult && difyResult.success) {
        const out = (difyResult as { output?: Record<string, unknown> }).output ?? {};
        emphasis = typeof out.emphasis === "string" ? out.emphasis : undefined;
        const rawPriority = out.priority_personas;
        if (Array.isArray(rawPriority) && rawPriority.every((p) => typeof p === "string")) {
          priorityPersonas = rawPriority as string[];
        }

        // Persist the teaching plan back to the material row for later use
        const teachingPlan = {
          priority_personas: priorityPersonas,
          emphasis,
          first_review_concept: typeof out.first_review_concept === "string" ? out.first_review_concept : undefined,
          quiz_topic: typeof out.quiz_topic === "string" ? out.quiz_topic : undefined,
        };
        const supabaseService = await createClient();
        await supabaseService
          .from("materials")
          .update({ teaching_plan: teachingPlan })
          .eq("id", material.id);
      }
    } catch (err) {
      console.error("[dify] Teaching workflow failed:", err);
    }

    // Trigger content pipeline (n8n, or Gemini when n8n isn't configured)
    await triggerMaterialToPost({
      material_id: material.id,
      raw_text,
      title,
      enabled_personas: enabledPersonas,
      enable_av_output: enableAvOutput,
      priority_personas: priorityPersonas,
      emphasis,
    }).catch((err) => {
      console.error("[n8n] Material-to-post trigger failed:", err);
    });
  });

  return NextResponse.json({ material_id: material.id, status: "processing" }, { status: 201 });
}
