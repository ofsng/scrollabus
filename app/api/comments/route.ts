import { createClient } from "@/lib/supabase/server";
import { triggerCommentReply } from "@/lib/n8n";
import { writeMemory, recallMemory } from "@/lib/hydra";
import { NextRequest, NextResponse, after } from "next/server";

export const maxDuration = 30;

// GET /api/comments?post_id=xxx
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const postId = req.nextUrl.searchParams.get("post_id");
  if (!postId) {
    return NextResponse.json({ error: "post_id required" }, { status: 400 });
  }

  const { data: comments, error } = await supabase
    .from("comments")
    .select(`
      *,
      persona:personas(id, name, slug, accent_color, role_tag, emoji),
      profile:profiles(display_name)
    `)
    .eq("post_id", postId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ comments });
}

// POST /api/comments
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { post_id, body: commentBody, parent_comment_id } = body;

  if (!post_id || !commentBody?.trim()) {
    return NextResponse.json({ error: "post_id and body are required" }, { status: 400 });
  }

  // Insert human comment
  const { data: comment, error: commentError } = await supabase
    .from("comments")
    .insert({
      post_id,
      user_id: user.id,
      body: commentBody.trim(),
      parent_comment_id: parent_comment_id ?? null,
    })
    .select(`
      *,
      profile:profiles(display_name)
    `)
    .single();

  if (commentError || !comment) {
    return NextResponse.json({ error: commentError?.message ?? "Failed to save comment" }, { status: 500 });
  }

  // Fire-and-forget: write learner memory signal to HydraDB
  writeMemory({
    userId: user.id,
    text: `User asked a question in comments on post ${post_id}: "${commentBody.trim().slice(0, 300)}"`,
  }).catch(() => {});

  // Recall learner memory and pass as context to the persona reply pipeline (runs after the response)
  after(() => recallMemory({
    userId: user.id,
    query: commentBody.trim(),
    maxResults: 5,
  }).then((memories) => {
    const learnerContext = memories.length > 0
      ? memories.map((m, i) => `${i + 1}. ${m}`).join("\n")
      : "";
    return triggerCommentReply({
      comment_id: comment.id,
      post_id,
      comment_body: commentBody.trim(),
      learner_context: learnerContext,
    }).catch((err) => {
      console.error("[n8n] Comment reply trigger failed:", err);
    });
  }).catch(() => {
    // Fall back to reply without memory context
    return triggerCommentReply({
      comment_id: comment.id,
      post_id,
      comment_body: commentBody.trim(),
    }).catch((err) => {
      console.error("[n8n] Comment reply trigger failed:", err);
    });
  }));

  return NextResponse.json({ comment }, { status: 201 });
}
