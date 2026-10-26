"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import Image from "next/image";
import { useSearchParams, useRouter } from "next/navigation";
import type { Post, SaveCategory } from "@/lib/types";
import { PersonaBadge } from "@/components/PersonaBadge";
import { PostTypeTag } from "@/components/PostTypeTag";
import { CommentSheet } from "@/components/CommentSheet";
import { SaveCategorySheet } from "@/components/SaveCategorySheet";

// ─── Category accent colours (cycles through a palette) ──────────────────────
const CATEGORY_PALETTE = [
  { bg: "#C9B8E8", text: "#4A3B72" }, // lavender
  { bg: "#9DBE8A", text: "#2D5C1E" }, // sage
  { bg: "#F5C842", text: "#6B4F00" }, // yellow
  { bg: "#F0A09A", text: "#6B1A18" }, // rose
  { bg: "#7EC8E3", text: "#0D4A63" }, // sky
  { bg: "#B8E86B", text: "#3A5C00" }, // lime
];

function categoryColor(index: number) {
  return CATEGORY_PALETTE[index % CATEGORY_PALETTE.length];
}

// ─── Small inline category pill ───────────────────────────────────────────────
function CategoryPill({ name, color }: { name: string; color: { bg: string; text: string } }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-sans font-semibold leading-none"
      style={{ backgroundColor: color.bg + "33", color: color.text }}
    >
      {name}
    </span>
  );
}

// ─── Post card ────────────────────────────────────────────────────────────────
function PostCard({
  post,
  categories,
  categoryMap,
  onComment,
  onManageSave,
}: {
  post: Post;
  categories: SaveCategory[];
  categoryMap: Map<string, { name: string; color: { bg: string; text: string } }>;
  onComment: () => void;
  onManageSave: () => void;
}) {
  const postCats = (post.category_ids ?? [])
    .map((id) => categoryMap.get(id))
    .filter(Boolean) as { name: string; color: { bg: string; text: string } }[];

  return (
    <div className="bg-white rounded-3xl p-5 shadow-card border border-warm-200">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          {post.persona && <PersonaBadge persona={post.persona} size="sm" />}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <PostTypeTag type={post.post_type} />
          <button
            onClick={onManageSave}
            className="w-7 h-7 rounded-full bg-warm-100 flex items-center justify-center text-lavender-deep hover:bg-lavender/20 transition-colors"
            aria-label="Manage save"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Category labels */}
      {postCats.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {postCats.map((cat) => (
            <CategoryPill key={cat.name} name={cat.name} color={cat.color} />
          ))}
        </div>
      )}

      {/* Content */}
      {post.title && (
        <h3 className="font-display font-semibold text-charcoal text-lg leading-snug mb-2">
          {post.title}
        </h3>
      )}
      <p className="font-sans text-charcoal/75 text-sm leading-relaxed line-clamp-4">
        {post.body}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-warm-100">
        <button
          onClick={onComment}
          className="flex items-center gap-1.5 text-xs font-sans font-medium text-charcoal/50 hover:text-charcoal transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          Reply
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function SavedPage() {
  return (
    <Suspense fallback={null}>
      <SavedPageContent />
    </Suspense>
  );
}

function SavedPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialCategory = searchParams.get("category") ?? null;

  const [categories, setCategories] = useState<SaveCategory[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(initialCategory);
  const [allPosts, setAllPosts] = useState<Post[]>([]);
  const [isLoadingPosts, setIsLoadingPosts] = useState(true);
  const [isLoadingCats, setIsLoadingCats] = useState(true);
  const [activeCommentPostId, setActiveCommentPostId] = useState<string | null>(null);
  const [resavePostId, setResavePostId] = useState<string | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  // Build a lookup map: category id → { name, color }
  const categoryMap = new Map(
    categories.map((cat, i) => [cat.id, { name: cat.name, color: categoryColor(i) }])
  );

  // Load categories
  useEffect(() => {
    async function load() {
      const res = await fetch("/api/save-categories");
      if (res.ok) {
        const json = await res.json();
        setCategories(json.categories ?? []);
      }
      setIsLoadingCats(false);
    }
    load();
  }, []);

  // Load all posts once
  useEffect(() => {
    async function load() {
      setIsLoadingPosts(true);
      const res = await fetch("/api/saved-posts");
      if (res.ok) {
        const json = await res.json();
        setAllPosts(json.posts ?? []);
      }
      setIsLoadingPosts(false);
    }
    load();
  }, []);

  // Update URL when active category changes
  useEffect(() => {
    const url = activeCategoryId ? `/saved?category=${activeCategoryId}` : "/saved";
    router.replace(url, { scroll: false });
  }, [activeCategoryId, router]);

  function handleUnsaveConfirm(saved: boolean, postId: string) {
    if (!saved) {
      setAllPosts((prev) => prev.filter((p) => p.id !== postId));
    }
  }

  // Derive displayed posts
  const displayedPosts = activeCategoryId
    ? allPosts.filter((p) => (p.category_ids ?? []).includes(activeCategoryId))
    : allPosts;

  const isLoading = isLoadingPosts || isLoadingCats;

  // Group posts by category for the "All" view
  const groupedByCategory: { category: SaveCategory | null; posts: Post[] }[] = [];
  if (!activeCategoryId && categories.length > 0) {
    for (const cat of categories) {
      const catPosts = allPosts.filter((p) => (p.category_ids ?? []).includes(cat.id));
      if (catPosts.length > 0) {
        groupedByCategory.push({ category: cat, posts: catPosts });
      }
    }
    // Uncategorised (no category_ids)
    const uncategorised = allPosts.filter((p) => !p.category_ids || p.category_ids.length === 0);
    if (uncategorised.length > 0) {
      groupedByCategory.push({ category: null, posts: uncategorised });
    }
  }

  const showGrouped = !activeCategoryId && groupedByCategory.length > 0;
  const totalCount = allPosts.length;
  const activeCategory = categories.find((c) => c.id === activeCategoryId);

  return (
    <>
      <div className="min-h-dvh bg-cream pb-24">
        {/* ── Sticky header ──────────────────────────────────────────────── */}
        <div className="sticky top-0 z-10 bg-cream/90 backdrop-blur-sm border-b border-warm-200 px-5 pt-10 pb-0">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="font-display font-bold text-3xl text-charcoal">Saved</h1>
              {!isLoading && (
                <p className="font-sans text-charcoal/50 text-sm mt-0.5">
                  {totalCount > 0
                    ? activeCategory
                      ? `${displayedPosts.length} post${displayedPosts.length !== 1 ? "s" : ""} in ${activeCategory.name}`
                      : `${totalCount} post${totalCount !== 1 ? "s" : ""} saved`
                    : "Nothing saved yet"}
                </p>
              )}
            </div>
          </div>

          {/* Category pill tabs */}
          {!isLoadingCats && categories.length > 0 && (
            <div
              ref={tabsRef}
              className="flex gap-2 pb-3 overflow-x-auto scrollbar-none -mx-5 px-5"
            >
              <button
                onClick={() => setActiveCategoryId(null)}
                className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-sans font-semibold transition-all border ${
                  activeCategoryId === null
                    ? "bg-charcoal text-white border-charcoal"
                    : "bg-white border-warm-200 text-charcoal/60"
                }`}
              >
                All
              </button>
              {categories.map((cat, i) => {
                const isActive = activeCategoryId === cat.id;
                const color = categoryColor(i);
                return (
                  <button
                    key={cat.id}
                    onClick={() => setActiveCategoryId(isActive ? null : cat.id)}
                    className="shrink-0 flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-sans font-semibold transition-all border"
                    style={isActive ? {
                      backgroundColor: color.bg,
                      color: color.text,
                      borderColor: color.bg,
                    } : {
                      backgroundColor: "white",
                      color: "rgba(26,22,18,0.6)",
                      borderColor: "rgba(0,0,0,0.1)",
                    }}
                  >
                    {cat.name}
                    <span
                      className="text-[10px] font-mono rounded-full px-1.5 py-0.5 leading-none"
                      style={isActive ? {
                        backgroundColor: color.text + "25",
                        color: color.text,
                      } : {
                        backgroundColor: "rgba(0,0,0,0.07)",
                        color: "rgba(26,22,18,0.45)",
                      }}
                    >
                      {cat.post_count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Content ────────────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Image src="/logo.png" alt="Scrollabus" width={100} height={55} className="animate-pulse" />
          </div>
        ) : totalCount === 0 ? (
          <div className="text-center py-20 px-5">
            <div className="text-5xl mb-4">🔖</div>
            <p className="font-display font-bold text-xl text-charcoal mb-2">Nothing saved yet</p>
            <p className="font-sans text-charcoal/50 text-sm max-w-xs mx-auto leading-relaxed">
              Tap the bookmark icon on any post while scrolling to save it here.
            </p>
          </div>
        ) : displayedPosts.length === 0 && activeCategoryId ? (
          <div className="text-center py-20 px-5">
            <div className="text-4xl mb-4">📂</div>
            <p className="font-sans text-charcoal/50 text-sm max-w-xs mx-auto">
              No posts in this category yet.
            </p>
          </div>
        ) : showGrouped ? (
          /* Grouped by category view */
          <div className="pt-5 space-y-8 px-5">
            {groupedByCategory.map(({ category, posts }) => {
              const catIdx = category ? categories.findIndex((c) => c.id === category.id) : -1;
              const color = category ? categoryColor(catIdx) : { bg: "#E5E0D8", text: "#6B6560" };
              return (
                <section key={category?.id ?? "uncategorised"}>
                  {/* Category header */}
                  <button
                    className="flex items-center gap-2.5 mb-3 group"
                    onClick={() => category && setActiveCategoryId(category.id)}
                  >
                    <div
                      className="flex items-center gap-2 px-3.5 py-1.5 rounded-full"
                      style={{ backgroundColor: color.bg + "40", border: `1.5px solid ${color.bg}` }}
                    >
                      <span
                        className="font-sans font-bold text-sm"
                        style={{ color: color.text }}
                      >
                        {category?.name ?? "Uncategorised"}
                      </span>
                      <span
                        className="font-mono text-[10px] rounded-full px-1.5 py-0.5 leading-none"
                        style={{ backgroundColor: color.bg, color: color.text }}
                      >
                        {posts.length}
                      </span>
                    </div>
                    {category && (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-charcoal/30 group-hover:text-charcoal/60 transition-colors -rotate-45"
                      >
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    )}
                  </button>

                  <div className="space-y-3">
                    {posts.map((post) => (
                      <PostCard
                        key={post.id}
                        post={post}
                        categories={categories}
                        categoryMap={categoryMap}
                        onComment={() => setActiveCommentPostId(post.id)}
                        onManageSave={() => setResavePostId(post.id)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          /* Filtered single-category view */
          <div className="pt-5 space-y-3 px-5">
            {displayedPosts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                categories={categories}
                categoryMap={categoryMap}
                onComment={() => setActiveCommentPostId(post.id)}
                onManageSave={() => setResavePostId(post.id)}
              />
            ))}
          </div>
        )}
      </div>

      <CommentSheet
        postId={activeCommentPostId}
        onClose={() => setActiveCommentPostId(null)}
      />

      <SaveCategorySheet
        postId={resavePostId}
        currentlySaved={true}
        onClose={() => setResavePostId(null)}
        onConfirm={(saved) => {
          if (resavePostId) handleUnsaveConfirm(saved, resavePostId);
        }}
      />
    </>
  );
}
