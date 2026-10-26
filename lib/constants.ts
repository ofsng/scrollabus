// n8n webhook URLs — set in .env
export const N8N_WEBHOOKS = {
  materialToPost: process.env.N8N_WEBHOOK_MATERIAL_TO_POST ?? "",
  commentReply: process.env.N8N_WEBHOOK_COMMENT_REPLY ?? "",
} as const;

// Dify workflow API — set in .env
export const DIFY_CONFIG = {
  apiUrl: process.env.DIFY_API_URL ?? "https://api.dify.ai/v1",
  apiKey: process.env.DIFY_API_KEY ?? "",
} as const;

// GMI Cloud inference API — set in .env
export const GMI_CONFIG = {
  apiUrl: "https://api.gmi-serving.com/v1",
  apiKey: process.env.GMI_CLOUD_API_KEY ?? "",
  models: {
    fast: "deepseek-ai/DeepSeek-V3-0324",
    reasoning: "deepseek-ai/DeepSeek-R1-0528",
  },
} as const;

// All available personas in display order
export const PERSONA_CONFIG = [
  {
    slug: "lecture-bestie",
    name: "Lecture Bestie",
    emoji: "🧑‍🏫",
    accentColor: "#C9B8E8",
    tooltip:
      "Turns your material into short, friendly explanations with analogies and everyday language—best for intuition and big-picture clarity.",
  },
  {
    slug: "exam-gremlin",
    name: "Exam Gremlin",
    emoji: "😈",
    accentColor: "#D4544A",
    tooltip:
      "Surfaces exam traps, sneaky wording, and common wrong answers, then walks through the correct reasoning so you spot them under pressure.",
  },
  {
    slug: "problem-grinder",
    name: "Problem Grinder",
    emoji: "🔢",
    accentColor: "#9DBE8A",
    tooltip:
      "Produces worked examples with numbered steps and clear notation—built for practice problems and showing every line of reasoning.",
  },
  {
    slug: "doodle-prof",
    name: "Doodle Prof",
    emoji: "✏️",
    accentColor: "#F5C842",
    tooltip:
      "Describes a three-panel doodle comic for each topic—stick figures, captions, and a punchline that still teaches the concept.",
  },
  {
    slug: "meme-lord",
    name: "Meme Lord",
    emoji: "😂",
    accentColor: "#B8E86B",
    tooltip:
      "Packages ideas as classic meme templates with funny, accurate text overlays so the format reinforces what you need to remember.",
  },
  {
    slug: "study-bard",
    name: "Study Bard",
    emoji: "🎵",
    accentColor: "#7EC8E3",
    tooltip:
      "Sets your notes to music—hooks, verses, and choruses where the lyrics actually encode the facts you are trying to memorize.",
  },
] as const;

// Feed
export const FEED_PAGE_SIZE = 10;

// Post type display config
export const POST_TYPE_CONFIG = {
  concept: {
    label: "Concept",
    bgClass: "bg-lavender/20",
    borderClass: "border-lavender",
    textClass: "text-lavender-deep",
    emoji: "📖",
  },
  example: {
    label: "Example",
    bgClass: "bg-sage/20",
    borderClass: "border-sage",
    textClass: "text-sage-deep",
    emoji: "✏️",
  },
  trap: {
    label: "Watch out",
    bgClass: "bg-cherry-light/20",
    borderClass: "border-cherry",
    textClass: "text-cherry",
    emoji: "⚠️",
  },
  review: {
    label: "Review",
    bgClass: "bg-butter/20",
    borderClass: "border-butter-deep",
    textClass: "text-amber-700",
    emoji: "🔁",
  },
  recap: {
    label: "Recap",
    bgClass: "bg-cobalt-light/20",
    borderClass: "border-cobalt",
    textClass: "text-cobalt",
    emoji: "⚡",
  },
} as const;

// Media type display config
export const MEDIA_TYPE_CONFIG = {
  text:      { label: "Text",      emoji: "📝" },
  image:     { label: "Image",     emoji: "🖼️" },
  video:     { label: "Video",     emoji: "🎬" },
  audio:     { label: "Song",      emoji: "🎵" },
  slideshow: { label: "Slideshow", emoji: "📽️" },
} as const;

// Quiz display config
export const QUIZ_TYPE_CONFIG = {
  multiple_choice:  { label: "Multiple Choice", emoji: "🔘" },
  multiple_response: { label: "Select All",     emoji: "☑️" },
  free_text:        { label: "Free Response",   emoji: "✍️" },
} as const;

// How many quizzes to generate per material upload
export const QUIZZES_PER_MATERIAL = 3;

// Approximate interval (in number of posts) between quiz card insertions in the feed
export const QUIZ_INSERT_INTERVAL = { min: 4, max: 6 };

// Gemini model used for every in-app AI call; override with GEMINI_MODEL
// (e.g. "gemini-2.5-flash-lite" for higher free-tier quotas)
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
