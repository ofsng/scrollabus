export type PostType = "concept" | "example" | "trap" | "review" | "recap";
export type PostSource = "n8n" | "creao" | "reactive" | "pulse";
export type MediaType = "text" | "image" | "video" | "audio" | "slideshow";

export interface SlideshowPayload {
  frames: string[];
  audio_url: string;
  frame_duration_ms: number;
}
export type SocialPlatform = "youtube" | "tiktok" | "instagram";

export const PERSONA_SLUGS = ["lecture-bestie", "exam-gremlin", "problem-grinder", "doodle-prof", "meme-lord", "study-bard"] as const;
export type DefaultPersonaSlug = typeof PERSONA_SLUGS[number];
// Accepts both built-in slugs and user-created custom slugs
export type PersonaSlug = DefaultPersonaSlug | string;

export interface Persona {
  id: string;
  slug: string;
  name: string;
  avatar_url: string | null;
  system_prompt: string;
  description: string | null;
  accent_color: string;
  role_tag: string;
  emoji: string;
  // Custom persona fields (null for default personas)
  created_by: string | null;
  is_public: boolean;
  tone: string | null;
  teaching_style: string | null;
}

export interface Material {
  id: string;
  user_id: string;
  title: string;
  raw_text: string;
  source_type: "pdf" | "text" | "link";
  created_at: string;
}

export interface Post {
  id: string;
  material_id: string | null;
  persona_id: string;
  post_type: PostType;
  title: string | null;
  body: string;
  source: PostSource;
  sort_order: number;
  media_type: MediaType;
  media_url: string | null;
  created_at: string;
  // joined
  persona?: Persona;
  is_saved?: boolean;
  is_liked?: boolean;
  comment_count?: number;
  category_ids?: string[];
}

export interface SaveCategory {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  post_count: number;
}

export interface Comment {
  id: string;
  post_id: string;
  user_id: string | null;
  persona_id: string | null;
  body: string;
  parent_comment_id: string | null;
  created_at: string;
  // joined
  persona?: Persona;
  profile?: { display_name: string | null };
}

export interface Profile {
  id: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  onboarding_completed: boolean;
  interests: string[];
  enabled_personas: string[];
  enable_av_output: boolean;
  created_at: string;
}

export interface SimilarUser {
  id: string;
  display_name: string | null;
  interests: string[];
  overlap_count: number;
}

export interface TrendingPost extends Post {
  save_count: number;
  engagement_score: number;
}

export interface ExternalContent {
  id: string;
  platform: SocialPlatform;
  external_id: string;
  title: string | null;
  description: string | null;
  thumbnail_url: string | null;
  embed_url: string;
  author_name: string | null;
  author_avatar_url: string | null;
  view_count: number;
  like_count: number;
  tags: string[];
  duration_seconds: number | null;
  published_at: string | null;
  created_at: string;
}

export interface CuratedChannel {
  id: string;
  platform: SocialPlatform;
  channel_id: string;
  channel_name: string | null;
  tags: string[];
  is_active: boolean;
  created_at: string;
}

// ─── Quiz types ───────────────────────────────────────────────────────────────

export type QuizQuestionType = "multiple_choice" | "multiple_response" | "free_text";

export interface QuizOption {
  id: string;
  text: string;
}

export interface Quiz {
  id: string;
  material_id: string;
  persona_slug: string | null;
  question_type: QuizQuestionType;
  question: string;
  options: QuizOption[] | null;
  correct_answer: string[] | { text: string };
  explanation: string;
  created_at: string;
  // Annotated server-side with the current user's response
  user_response?: QuizResponse | null;
}

export interface QuizResponse {
  id: string;
  quiz_id: string;
  user_id: string;
  answer: string[] | { text: string };
  is_correct: boolean | null;
  created_at: string;
}

export interface QuizMessage {
  id: string;
  quiz_id: string;
  user_id: string;
  persona_slug: string | null;
  role: "user" | "persona";
  body: string;
  created_at: string;
}

// ─── Unified feed item ────────────────────────────────────────────────────────

export type FeedItem =
  | { _type: "post"; data: Post }
  | { _type: "quiz"; data: Quiz };
