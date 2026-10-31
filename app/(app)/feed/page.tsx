"use client";

import { Suspense, useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { PersonaSprite } from "@/components/PersonaSprites";
import type { Post, Quiz, FeedItem, Persona } from "@/lib/types";
import { PERSONA_CONFIG, QUIZ_INSERT_INTERVAL } from "@/lib/constants";
import { FeedCard } from "@/components/FeedCard";
import { QuizCard } from "@/components/QuizCard";
import { CommentSheet } from "@/components/CommentSheet";
import { PersonaProfileSheet } from "@/components/PersonaProfileSheet";
import { EmptyFeedLanding } from "@/components/EmptyFeedLanding";

interface PendingImpression {
  post_id: string;
  duration_ms: number;
}

// Deterministically interleave quizzes into the post list at pseudo-random intervals.
// Uses a simple hash of quiz IDs to pick positions so the layout is stable across renders.
function buildFeedItems(posts: Post[], quizzes: Quiz[]): FeedItem[] {
  if (quizzes.length === 0) {
    return posts.map((p) => ({ _type: "post" as const, data: p }));
  }

  const { min, max } = QUIZ_INSERT_INTERVAL;
  const range = max - min + 1;

  // Derive a seeded offset per quiz from its ID to vary insertion gaps
  function quizOffset(quiz: Quiz, index: number): number {
    const seed = quiz.id.charCodeAt(0) + index;
    return min + (seed % range);
  }

  const items: FeedItem[] = [];
  let postIdx = 0;
  let quizIdx = 0;
  let postsUntilNextQuiz = quizOffset(quizzes[0], 0);

  while (postIdx < posts.length || quizIdx < quizzes.length) {
    if (postIdx < posts.length && postsUntilNextQuiz > 0) {
      items.push({ _type: "post", data: posts[postIdx++] });
      postsUntilNextQuiz--;
    } else if (quizIdx < quizzes.length) {
      items.push({ _type: "quiz", data: quizzes[quizIdx] });
      quizIdx++;
      postsUntilNextQuiz = quizIdx < quizzes.length
        ? quizOffset(quizzes[quizIdx], quizIdx)
        : Infinity;
    } else {
      // Remaining posts
      items.push({ _type: "post", data: posts[postIdx++] });
    }
  }

  return items;
}

function FeedLoadingScreen() {
  return (
    <div className="min-h-dvh flex flex-col bg-cream animate-feed-fade-in">
      {/* Skeleton filter bar */}
      <div className="flex gap-2 px-4 py-3 pt-safe">
        {[40, 56, 72, 56, 64].map((w, i) => (
          <div
            key={i}
            className="h-7 rounded-full bg-warm-200 animate-pulse shrink-0"
            style={{ width: w, animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>

      {/* Centred loading content */}
      <div className="flex-1 flex flex-col items-center justify-center pb-24 gap-7">
        {/* Ghost card */}
        <div className="w-[min(340px,88vw)] rounded-3xl overflow-hidden shadow-card">
          <div className="h-[200px] bg-warm-100 animate-pulse" />
          <div className="bg-warm-50 px-5 py-4 space-y-2.5">
            <div className="h-4 w-3/4 rounded-full bg-warm-200 animate-pulse" style={{ animationDelay: "80ms" }} />
            <div className="h-3 w-1/2 rounded-full bg-warm-200 animate-pulse" style={{ animationDelay: "160ms" }} />
          </div>
        </div>

        {/* Floating persona sprites */}
        <div className="flex gap-5 mt-1">
          {(["lecture-bestie", "exam-gremlin", "problem-grinder"] as const).map((slug, i) => (
            <div key={slug} className="animate-float" style={{ animationDelay: `${i * 220}ms` }}>
              <PersonaSprite slug={slug} size={42} />
            </div>
          ))}
        </div>

        <p className="font-sans text-charcoal/45 text-xs tracking-wide">
          Getting your feed ready…
        </p>
      </div>
    </div>
  );
}

function FeedContent() {
  const searchParams = useSearchParams();
  const materialId = searchParams.get("material_id");

  const [posts, setPosts] = useState<Post[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [generationSlow, setGenerationSlow] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [activeCommentPostId, setActiveCommentPostId] = useState<string | null>(null);
  const [activeCommentPersonaSlug, setActiveCommentPersonaSlug] = useState<string | null>(null);
  const [activePersonaSlug, setActivePersonaSlug] = useState<string | null>(null);
  const [personaFilter, setPersonaFilter] = useState<string | null>(null);
  const [quizFilter, setQuizFilter] = useState(false);
  const [allPersonas, setAllPersonas] = useState<Persona[]>(() =>
    PERSONA_CONFIG.map((p) => ({
      id: p.slug,
      slug: p.slug,
      name: p.name,
      emoji: p.emoji,
      accent_color: p.accentColor,
      role_tag: "",
      description: null,
      system_prompt: "",
      avatar_url: null,
      created_by: null,
      is_public: true,
      tone: null,
      teaching_style: null,
    }))
  );

  const impressionsQueue = useRef<PendingImpression[]>([]);
  const flushTimer = useRef<NodeJS.Timeout | null>(null);
  const isFetchingMoreRef = useRef(false);
  const feedContainerRef = useRef<HTMLDivElement | null>(null);
  // Stable ref to the latest loadMore closure — lets the IntersectionObserver
  // always call the current version without needing to be recreated.
  const loadMoreFnRef = useRef<() => void>(() => {});
  // Single persistent observer; disconnected/reconnected only when the
  // trigger element itself mounts/unmounts (not on every render).
  const triggerObserverRef = useRef<IntersectionObserver | null>(null);
  const triggerRef = useCallback((el: HTMLDivElement | null) => {
    triggerObserverRef.current?.disconnect();
    triggerObserverRef.current = null;
    if (el) {
      triggerObserverRef.current = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) loadMoreFnRef.current(); },
        { threshold: 0.5 },
      );
      triggerObserverRef.current.observe(el);
    }
  }, []);

  // Load all visible personas for filter chips
  useEffect(() => {
    fetch("/api/personas")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.personas && data.personas.length > 0) {
          setAllPersonas(data.personas);
        }
      })
      .catch(() => {});
  }, []);

  const flushImpressions = useCallback(async () => {
    const batch = impressionsQueue.current.splice(0);
    if (batch.length === 0) return;
    await fetch("/api/impressions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ impressions: batch }),
    }).catch(() => {});
  }, []);

  const handleVisible = useCallback((postId: string, durationMs: number) => {
    impressionsQueue.current.push({ post_id: postId, duration_ms: durationMs });
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(flushImpressions, 3000);
  }, [flushImpressions]);

  async function fetchFeed(cursor?: string, filterSlug?: string | null) {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    if (materialId) params.set("material_id", materialId);
    const slug = filterSlug !== undefined ? filterSlug : personaFilter;
    if (slug) params.set("persona_slug", slug);
    // Use adaptive mode on the home feed (no material filter and no persona filter)
    // so the feed biases toward personas the student genuinely engages with.
    if (!materialId && !slug) params.set("mode", "adaptive");

    const res = await fetch(`/api/feed?${params}`);

    if (res.status === 401) {
      await new Promise((r) => setTimeout(r, 300));
      const retry = await fetch(`/api/feed?${params}`);
      if (retry.status === 401) { window.location.href = "/login"; return; }
      if (!retry.ok) { console.error("[feed] retry error", retry.status); return; }
      return retry.json();
    }
    if (!res.ok) { console.error("[feed] API error", res.status); return; }
    return res.json();
  }

  async function fetchQuizzes(fMaterialId?: string | null) {
    // Only load quizzes for the general home feed or a specific material
    const params = new URLSearchParams();
    if (fMaterialId) params.set("material_id", fMaterialId);
    try {
      const res = await fetch(`/api/quizzes?${params}`);
      if (!res.ok) return [];
      const json = await res.json();
      return (json.quizzes ?? []) as Quiz[];
    } catch {
      return [];
    }
  }

  // Rebuild feed items whenever posts, quizzes, or filters change
  useEffect(() => {
    let items: FeedItem[];
    if (quizFilter) {
      items = quizzes.map((q) => ({ _type: "quiz" as const, data: q }));
    } else if (personaFilter) {
      items = posts.map((p) => ({ _type: "post" as const, data: p }));
    } else {
      items = buildFeedItems(posts, quizzes);
    }
    setFeedItems(items);
  }, [posts, quizzes, personaFilter, quizFilter]);

  useEffect(() => {
    let polling: NodeJS.Timeout | null = null;
    // Generation normally finishes within a minute; past that it has most likely failed
    const slowTimer = setTimeout(() => setGenerationSlow(true), 90_000);
    setGenerationSlow(false);

    async function load() {
      setIsLoading(true);
      const [feedData, quizData] = await Promise.all([
        fetchFeed(undefined, personaFilter),
        fetchQuizzes(materialId),
      ]);

      if (feedData) {
        setPosts(feedData.posts);
        setNextCursor(feedData.nextCursor);
      }
      setQuizzes(quizData);
      setIsLoading(false);

      // Poll every 2s until posts are ready. Also re-fetch quizzes on each tick
      // since quiz generation (Gemini, ~5-15s) finishes well before posts (n8n, ~30-60s).
      const hasPosts = feedData && feedData.posts.length > 0;
      if (!hasPosts) {
        polling = setInterval(async () => {
          const [d, qd] = await Promise.all([
            fetchFeed(undefined, personaFilter),
            fetchQuizzes(materialId),
          ]);
          if (qd.length > 0) setQuizzes(qd);
          if (d && d.posts.length > 0) {
            setPosts(d.posts);
            setNextCursor(d.nextCursor);
            if (polling) clearInterval(polling);
          }
        }, 2000);
      }
    }

    load();
    return () => {
      clearTimeout(slowTimer);
      if (polling) clearInterval(polling);
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushImpressions();
    };
  }, [materialId, personaFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMore() {
    if (!nextCursor || isFetchingMoreRef.current) return;
    isFetchingMoreRef.current = true;
    setIsFetchingMore(true);
    // Capture the current item count so we can scroll to the first new card
    // after the DOM updates. The IntersectionObserver won't re-fire on its own
    // because intersection ratio doesn't change when new items are prepended.
    const prevCount = feedItems.length;
    const data = await fetchFeed(nextCursor, personaFilter);
    if (data) {
      setPosts((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const newPosts = data.posts.filter((p: Post) => !existingIds.has(p.id));
        return [...prev, ...newPosts];
      });
      setNextCursor(data.nextCursor);
      // Give React + the browser two frames to flush the new DOM nodes, then
      // snap-scroll to the first new card so the user isn't left on the trigger.
      setTimeout(() => {
        const container = feedContainerRef.current;
        if (!container) return;
        const firstNew = container.children[prevCount] as HTMLElement | undefined;
        firstNew?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    }
    isFetchingMoreRef.current = false;
    setIsFetchingMore(false);
  }
  // Keep the stable ref current on every render so the observer always
  // sees the latest nextCursor / personaFilter without being recreated.
  loadMoreFnRef.current = loadMore;

  if (isLoading) return <FeedLoadingScreen />;

  if (posts.length === 0) {
    if (materialId) {
      return (
        <div className="min-h-dvh flex flex-col items-center justify-center bg-cream px-6 text-center pb-20">
          <Image src="/logo.png" alt="Scrollabus" width={160} height={87} className="mb-4" />
          <h2 className="font-display font-bold text-2xl text-charcoal mb-2">Nothing here yet</h2>
          <p className="font-sans text-charcoal/60 text-sm max-w-xs">
            Your personas are working on it. Check back in a moment…
          </p>
          {generationSlow && (
            <p className="font-sans text-charcoal/80 text-sm max-w-xs mt-4">
              This is taking longer than usual — generation may have failed.{" "}
              <a href="/api/health" className="underline font-semibold">Run a setup check</a>
            </p>
          )}
          <div className="flex gap-3 mt-6">
            {["lecture-bestie", "exam-gremlin", "problem-grinder"].map((slug, i) => (
              <div key={slug} className="animate-bounce" style={{ animationDelay: `${i * 150}ms` }}>
                <PersonaSprite slug={slug} size={44} />
              </div>
            ))}
          </div>
        </div>
      );
    }
    return <EmptyFeedLanding />;
  }

  return (
    <>
      {/* Filter bar */}
      <div className="fixed top-0 left-0 right-0 z-20 pt-safe">
        <div className="flex gap-2 px-4 py-3 overflow-x-auto scrollbar-none">
          {/* All */}
          <button
            type="button"
            onClick={() => { setPersonaFilter(null); setQuizFilter(false); }}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-sans font-semibold transition-all ${
              personaFilter === null && !quizFilter
                ? "bg-charcoal text-cream shadow-sm"
                : "bg-white/70 backdrop-blur-sm text-charcoal/70 border border-warm-200"
            }`}
          >
            All
          </button>

          {/* Quizzes */}
          <button
            type="button"
            onClick={() => { setQuizFilter((prev) => !prev); setPersonaFilter(null); }}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-sans font-semibold transition-all"
            style={quizFilter
              ? {
                  background: "linear-gradient(135deg, #8B6FD4, #5B8BD4)",
                  color: "white",
                  boxShadow: "0 2px 8px rgba(139,111,212,0.4)",
                }
              : {
                  background: "rgba(255,255,255,0.7)",
                  backdropFilter: "blur(8px)",
                  border: "1px solid rgba(139,111,212,0.3)",
                  color: "#8B6FD4",
                }
            }
          >
            <span>🧠</span>
            <span>Quizzes</span>
            {quizzes.length > 0 && (
              <span
                className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none"
                style={quizFilter
                  ? { background: "rgba(255,255,255,0.3)", color: "white" }
                  : { background: "rgba(139,111,212,0.15)", color: "#8B6FD4" }
                }
              >
                {quizzes.length}
              </span>
            )}
          </button>

          {/* Divider */}
          <div className="shrink-0 w-px bg-warm-200 self-stretch my-1" />

          {/* Persona filters */}
          {allPersonas.map((p) => (
            <button
              key={p.slug}
              type="button"
              onClick={() => { setPersonaFilter(personaFilter === p.slug ? null : p.slug); setQuizFilter(false); }}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-sans font-semibold transition-all ${
                personaFilter === p.slug
                  ? "text-white shadow-sm"
                  : "bg-white/70 backdrop-blur-sm text-charcoal/70 border border-warm-200"
              }`}
              style={personaFilter === p.slug ? { backgroundColor: p.accent_color } : {}}
            >
              <span className="inline-flex items-center justify-center rounded-full overflow-hidden" style={{ width: 16, height: 16 }}>
                <PersonaSprite slug={p.slug} size={16} emoji={p.emoji} accentColor={p.accent_color} />
              </span>
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Feed: CSS snap scroll */}
      <div ref={feedContainerRef} className="feed-container pb-16">
        {feedItems.map((item) =>
          item._type === "quiz" ? (
            <QuizCard
              key={`quiz-${item.data.id}`}
              quiz={item.data}
              onVisible={handleVisible}
            />
          ) : (
            <FeedCard
              key={`post-${item.data.id}`}
              post={item.data}
              onOpenComments={(postId, personaSlug) => {
                setActiveCommentPostId(postId);
                setActiveCommentPersonaSlug(personaSlug ?? null);
              }}
              onVisible={handleVisible}
              onPersonaClick={setActivePersonaSlug}
            />
          )
        )}

        {/* Load more trigger */}
        {nextCursor && (
          <div
            ref={triggerRef}
            className="h-dvh flex flex-col items-center justify-center gap-5"
            style={{ scrollSnapAlign: "start" }}
          >
            {/* Persona sprites — bounce while fetching, dimmed while idle */}
            <div className="flex gap-5">
              {(["lecture-bestie", "exam-gremlin", "problem-grinder"] as const).map((slug, i) => (
                <div
                  key={slug}
                  className="transition-all duration-500"
                  style={{
                    opacity: isFetchingMore ? 1 : 0.28,
                    animation: isFetchingMore ? `bounce 1s ${i * 130}ms ease infinite` : "none",
                  }}
                >
                  <PersonaSprite slug={slug} size={38} />
                </div>
              ))}
            </div>
            {/* Text fades between idle and loading copy */}
            <p className="font-sans text-charcoal/50 text-sm transition-opacity duration-300">
              {isFetchingMore ? "Loading more…" : "Scroll for more ✨"}
            </p>
          </div>
        )}
      </div>

      {/* Comment sheet */}
      <CommentSheet
        postId={activeCommentPostId}
        personaSlug={activeCommentPersonaSlug}
        onClose={() => { setActiveCommentPostId(null); setActiveCommentPersonaSlug(null); }}
      />

      {/* Persona profile sheet */}
      <PersonaProfileSheet
        slug={activePersonaSlug}
        onClose={() => setActivePersonaSlug(null)}
      />
    </>
  );
}

export default function FeedPage() {
  return (
    <Suspense fallback={<FeedLoadingScreen />}>
      <FeedContent />
    </Suspense>
  );
}
