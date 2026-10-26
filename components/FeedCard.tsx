"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import type { Post } from "@/lib/types";
import { PersonaBadge } from "./PersonaBadge";
import { ActionBar } from "./ActionBar";
import { PostTypeTag } from "./PostTypeTag";
import { Sparkle, SparkleCluster } from "./Decorations";
import { SaveCategorySheet } from "./SaveCategorySheet";

interface FeedCardProps {
  post: Post;
  onOpenComments: (postId: string, personaSlug?: string) => void;
  onVisible: (postId: string, durationMs: number) => void;
  onPersonaClick?: (slug: string) => void;
}

// ─── Media sub-components ────────────────────────────────────────────────────

function ImageCardMedia({
  url,
  title,
  body,
  accentColor,
}: {
  url: string;
  title: string | null;
  body: string;
  accentColor: string;
}) {
  const [expanded, setExpanded] = useState(false);

  // Close on Escape key
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  return (
    <>
      <div className="flex-1 px-4 pb-3 flex flex-col items-center justify-center min-h-0">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
          className="relative rounded-4xl w-full mx-auto"
          style={{
            maxWidth: "min(100%, 500px)",
            background: `linear-gradient(145deg, rgba(255,255,255,0.96), ${accentColor}1a)`,
            border: `1px solid ${accentColor}55`,
            boxShadow: `0 12px 48px ${accentColor}35, 0 4px 16px rgba(26,22,18,0.07), inset 0 1px 0 rgba(255,255,255,0.85)`,
          }}
        >
          {/* Glossy top sheen */}
          <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-white/30 to-transparent z-10 pointer-events-none rounded-t-4xl" />

          {/* Sparkle accents */}
          <Sparkle size={13} color={accentColor} delay={0.2} className="absolute top-3 right-4 z-20 opacity-75" />
          <Sparkle size={8}  color={accentColor} delay={0.8} className="absolute top-7 right-10 z-20 opacity-50" />

          {/* Image — clickable to expand */}
          <button
            type="button"
            aria-label="View full image"
            onClick={() => setExpanded(true)}
            className="relative w-full overflow-hidden rounded-t-4xl block group"
            style={{ height: "min(calc(100vw - 40px), 52vh, 460px)" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={title ?? "Generated image"}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
            {/* Soft bottom fade into caption */}
            <div
              className="absolute inset-x-0 bottom-0 h-10 pointer-events-none"
              style={{ background: `linear-gradient(to top, rgba(255,255,255,0.95), transparent)` }}
            />
            {/* Expand hint pill */}
            <div
              className="absolute bottom-3 right-3 z-20 flex items-center gap-1 px-2.5 py-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200"
              style={{
                background: "rgba(255,255,255,0.75)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                border: `1px solid ${accentColor}40`,
                boxShadow: `0 2px 8px ${accentColor}30`,
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: accentColor }}>
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
              <span className="text-xs font-sans font-semibold" style={{ color: accentColor }}>Expand</span>
            </div>
          </button>

          {/* Caption */}
          {(title || body) && (
            <div className="px-4 pt-3 pb-4">
              {title && (
                <h3 className="font-display font-bold text-charcoal text-base leading-tight mb-1.5">
                  {title}
                </h3>
              )}
              <p className="font-sans text-charcoal/70 text-sm leading-snug line-clamp-2">
                {body}
              </p>
            </div>
          )}
        </motion.div>
      </div>

      {/* ── Lightbox ────────────────────────────────────────────────────── */}
      {expanded && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center"
          style={{ background: "rgba(26,22,18,0.88)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}
          onClick={() => setExpanded(false)}
        >
          {/* Close button */}
          <button
            type="button"
            aria-label="Close"
            onClick={() => setExpanded(false)}
            className="absolute top-5 right-5 w-10 h-10 rounded-full flex items-center justify-center z-10"
            style={{
              background: "rgba(255,255,255,0.15)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(255,255,255,0.25)",
              boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          {/* Full image */}
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
            className="relative rounded-3xl overflow-hidden mx-6"
            style={{
              maxWidth: "min(90vw, 560px)",
              boxShadow: `0 24px 80px ${accentColor}50, 0 8px 32px rgba(0,0,0,0.5)`,
              border: `1px solid ${accentColor}60`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={title ?? "Generated image"}
              className="w-full h-auto block"
              style={{ maxHeight: "75vh", objectFit: "contain" }}
            />
            {/* Caption overlay */}
            {(title || body) && (
              <div
                className="px-5 py-4"
                style={{
                  background: `linear-gradient(145deg, rgba(255,255,255,0.97), ${accentColor}18)`,
                }}
              >
                {title && (
                  <p className="font-display font-bold text-charcoal text-base leading-tight mb-1">
                    {title}
                  </p>
                )}
                <p className="font-sans text-charcoal/70 text-sm leading-snug">
                  {body}
                </p>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </>
  );
}

function VideoMedia({ url, isVisible }: { url: string; isVisible: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isVisible) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [isVisible]);

  return (
    <div className="relative w-full h-full bg-black">
      <video
        ref={videoRef}
        src={url}
        muted={muted}
        loop
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
      />
      <button
        type="button"
        onClick={() => setMuted((m) => !m)}
        className="absolute top-16 right-4 w-9 h-9 rounded-full bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center text-white text-lg shadow-soft"
        aria-label={muted ? "Unmute video" : "Mute video"}
      >
        {muted ? "🔇" : "🔊"}
      </button>
    </div>
  );
}

function SlideshowMedia({ url, isVisible }: { url: string; isVisible: boolean }) {
  const [frameIndex, setFrameIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [frames, setFrames] = useState<string[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [frameDurationMs, setFrameDurationMs] = useState(2500);
  const audioRef = useRef<HTMLAudioElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Parse the JSON payload stored in media_url
  useEffect(() => {
    try {
      const payload = JSON.parse(url) as { frames: string[]; audio_url: string; frame_duration_ms: number };
      setFrames(payload.frames ?? []);
      setAudioUrl(payload.audio_url ?? null);
      setFrameDurationMs(payload.frame_duration_ms ?? 2500);
    } catch {
      // Fallback: treat as a direct image URL
      setFrames([url]);
    }
  }, [url]);

  // Advance frames and manage audio based on visibility
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    const audio = audioRef.current;

    if (isVisible && frames.length > 0) {
      setFrameIndex(0);
      audio?.play().catch(() => {});
      timerRef.current = setInterval(() => {
        setFrameIndex(prev => (prev + 1) % frames.length);
      }, frameDurationMs);
    } else {
      audio?.pause();
      setFrameIndex(0);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isVisible, frames, frameDurationMs]);

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      {/* Frames with crossfade */}
      {frames.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt={`Slide ${i + 1}`}
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700"
          style={{ opacity: i === frameIndex ? 1 : 0 }}
        />
      ))}

      {/* Gradient overlay for caption readability */}
      <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />

      {/* Progress dots */}
      {frames.length > 1 && (
        <div className="absolute bottom-20 left-0 right-0 flex justify-center gap-1.5 z-10">
          {frames.map((_, i) => (
            <div
              key={i}
              className="rounded-full transition-all duration-300"
              style={{
                width:  i === frameIndex ? 16 : 6,
                height: 6,
                backgroundColor: i === frameIndex ? "white" : "rgba(255,255,255,0.45)",
              }}
            />
          ))}
        </div>
      )}

      {/* Mute/unmute button */}
      <button
        type="button"
        onClick={() => {
          const a = audioRef.current;
          if (!a) return;
          const next = !muted;
          setMuted(next);
          a.muted = next;
        }}
        className="absolute top-16 right-4 w-9 h-9 rounded-full bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center text-white text-lg shadow-soft z-10"
        aria-label={muted ? "Unmute slideshow" : "Mute slideshow"}
      >
        {muted ? "🔇" : "🔊"}
      </button>

      {/* Hidden audio element */}
      {audioUrl && (
        <audio ref={audioRef} src={audioUrl} loop muted={muted} preload="metadata" />
      )}
    </div>
  );
}

function AudioMedia({ url, title, accentColor }: { url: string; title: string | null; accentColor: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loadError, setLoadError] = useState(false);

  function togglePlay() {
    const a = audioRef.current;
    if (!a || loadError) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      a.play()
        .then(() => setPlaying(true))
        .catch(() => {
          setPlaying(false);
          setLoadError(true);
        });
    }
  }

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onEnded = () => setPlaying(false);
    const onTimeUpdate = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
    const onError = () => { setPlaying(false); setLoadError(true); };
    a.addEventListener("ended", onEnded);
    a.addEventListener("timeupdate", onTimeUpdate);
    a.addEventListener("error", onError);
    return () => {
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("timeupdate", onTimeUpdate);
      a.removeEventListener("error", onError);
    };
  }, []);

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center px-8 gap-8 relative overflow-hidden"
      style={{ background: `linear-gradient(160deg, #FFF8F0 0%, ${accentColor}28 100%)` }}
    >
      {/* Decorative background sparkles */}
      <Sparkle size={20} color={accentColor} delay={0}   className="absolute top-16 left-8 opacity-50" />
      <Sparkle size={12} color={accentColor} delay={0.6} className="absolute top-24 right-12 opacity-40" />
      <Sparkle size={16} color={accentColor} delay={1.2} className="absolute bottom-32 left-16 opacity-45" />

      {/* Album art */}
      <motion.div
        className="w-48 h-48 rounded-4xl shadow-card-hover flex items-center justify-center text-7xl relative overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${accentColor}30, ${accentColor}70)` }}
        animate={playing ? { scale: [1, 1.02, 1] } : { scale: 1 }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      >
        {/* Glossy highlight on album art */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/25 to-transparent rounded-4xl" />
        🎵
      </motion.div>

      {title && (
        <p className="font-display font-bold text-xl text-charcoal text-center leading-tight">
          {title}
        </p>
      )}

      {/* Progress bar */}
      <div className="w-full h-2 bg-warm-200 rounded-full overflow-hidden shadow-soft">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: accentColor }}
          animate={{ width: `${progress * 100}%` }}
          transition={{ duration: 0.1 }}
        />
      </div>

      {/* Play/pause button — gel style */}
      {loadError ? (
        <div className="flex flex-col items-center gap-1">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-2xl text-white relative overflow-hidden opacity-50"
            style={{ backgroundColor: accentColor }}
          >
            <span>⚠️</span>
          </div>
          <p className="text-xs text-warm-500">Unable to play audio</p>
        </div>
      ) : (
        <motion.button
          type="button"
          onClick={togglePlay}
          className="w-16 h-16 rounded-full flex items-center justify-center text-2xl text-white relative overflow-hidden"
          style={{
            backgroundColor: accentColor,
            boxShadow: `0 4px 20px ${accentColor}60, inset 0 1px 0 rgba(255,255,255,0.3)`,
          }}
          whileTap={{ scale: 0.9 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
          aria-label={playing ? "Pause" : "Play"}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-white/25 to-transparent rounded-full" />
          <span className="relative z-10">{playing ? "⏸" : "▶️"}</span>
        </motion.button>
      )}

      <audio ref={audioRef} src={url} preload="metadata" />
    </div>
  );
}

// ─── Pull-quote text rendering ────────────────────────────────────────────────

function TtsButton({
  isSpeaking,
  onTts,
  accentColor,
}: {
  isSpeaking: boolean;
  onTts: () => void;
  accentColor: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onTts}
      aria-label={isSpeaking ? "Stop reading" : "Listen to post"}
      whileTap={{ scale: 0.85 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
      className="absolute bottom-3 right-3 z-20 flex items-center gap-1.5 rounded-full px-2.5 py-1.5 transition-all duration-300"
      style={isSpeaking ? {
        background: `linear-gradient(135deg, ${accentColor}dd, ${accentColor})`,
        boxShadow: `0 2px 10px ${accentColor}60`,
        border: `1px solid ${accentColor}80`,
      } : {
        background: "rgba(255,255,255,0.7)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        border: "1px solid rgba(255,255,255,0.5)",
        boxShadow: "0 2px 8px rgba(26,22,18,0.08)",
      }}
    >
      {isSpeaking ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="white">
          <rect x="5" y="5" width="5" height="14" rx="1" />
          <rect x="14" y="5" width="5" height="14" rx="1" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: accentColor }}>
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      )}
      <span
        className="text-xs font-sans font-semibold leading-none"
        style={{ color: isSpeaking ? "white" : accentColor }}
      >
        {isSpeaking ? "Stop" : "Listen"}
      </span>
    </motion.button>
  );
}

// ─── Persona mention parser ───────────────────────────────────────────────────
// Detects @PersonaName patterns in post body and renders them as tappable links
// that filter the feed to that persona.

const PERSONA_MENTION_MAP: Record<string, string> = {
  "lecture bestie":  "lecture-bestie",
  "exam gremlin":    "exam-gremlin",
  "problem grinder": "problem-grinder",
  "doodle prof":     "doodle-prof",
  "meme lord":       "meme-lord",
  "study bard":      "study-bard",
};

const MENTION_REGEX = /@(Lecture Bestie|Exam Gremlin|Problem Grinder|Doodle Prof|Meme Lord|Study Bard)/gi;

type BodySegment = { type: "text"; text: string } | { type: "mention"; name: string; slug: string };

function parseBodySegments(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const regex = new RegExp(MENTION_REGEX.source, "gi");
  while ((match = regex.exec(body)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", text: body.slice(lastIndex, match.index) });
    }
    const name = match[1];
    const slug = PERSONA_MENTION_MAP[name.toLowerCase()] ?? null;
    if (slug) {
      segments.push({ type: "mention", name, slug });
    } else {
      segments.push({ type: "text", text: match[0] });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < body.length) {
    segments.push({ type: "text", text: body.slice(lastIndex) });
  }

  return segments;
}

function BodyWithMentions({
  body,
  accentColor,
  onPersonaClick,
}: {
  body: string;
  accentColor: string;
  onPersonaClick?: (slug: string) => void;
}) {
  const segments = parseBodySegments(body);
  const hasMentions = segments.some((s) => s.type === "mention");

  if (!hasMentions) {
    return <span className="whitespace-pre-wrap">{body}</span>;
  }

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "mention") {
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPersonaClick?.(seg.slug)}
              className="inline-flex items-center gap-0.5 font-semibold rounded-md px-1 py-0.5 transition-opacity hover:opacity-80 active:scale-95"
              style={{
                color: accentColor,
                background: `${accentColor}18`,
                border: `1px solid ${accentColor}30`,
                fontSize: "inherit",
                lineHeight: "inherit",
              }}
            >
              @{seg.name}
            </button>
          );
        }
        return <span key={i} className="whitespace-pre-wrap">{seg.text}</span>;
      })}
    </>
  );
}

function TextContent({
  title,
  body,
  accentColor,
  isTrap,
  isSpeaking,
  onTts,
  onPersonaClick,
}: {
  title: string | null;
  body: string;
  accentColor: string;
  isTrap: boolean;
  isSpeaking: boolean;
  onTts: () => void;
  onPersonaClick?: (slug: string) => void;
}) {
  const isShortQuote = !title && body.length < 120;

  if (isShortQuote) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
          className="relative rounded-4xl p-7 w-full my-auto"
          style={{
            maxWidth: "min(100%, 580px)",
            background: `linear-gradient(145deg, rgba(255,255,255,0.92), ${accentColor}22)`,
            border: `1px solid ${accentColor}40`,
            boxShadow: `0 8px 32px ${accentColor}25, inset 0 1px 0 rgba(255,255,255,0.7)`,
          }}
        >
          {/* Glossy top sheen */}
          <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/30 to-transparent rounded-t-4xl" />

          {/* Decorative quote mark */}
          <div
            className="absolute top-3 left-5 font-display text-7xl leading-none opacity-10 select-none pointer-events-none"
            style={{ color: accentColor }}
          >
            &ldquo;
          </div>

          {/* Sparkle accent */}
          <Sparkle size={14} color={accentColor} delay={0.3} className="absolute top-4 right-5 opacity-70" />

          <p className="relative z-10 font-display font-bold text-2xl text-charcoal leading-snug italic pt-2 pb-6">
            <BodyWithMentions body={body} accentColor={accentColor} onPersonaClick={onPersonaClick} />
          </p>

          <TtsButton isSpeaking={isSpeaking} onTts={onTts} accentColor={accentColor} />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 flex flex-col items-center">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
        className="relative rounded-3xl p-6 w-full my-auto"
        style={isTrap ? {
          maxWidth: "min(100%, 580px)",
          background: "linear-gradient(145deg, rgba(255,255,255,0.95), rgba(255,220,216,0.4))",
          border: "1px solid rgba(212,84,74,0.35)",
          borderLeft: "4px solid #D4544A",
          boxShadow: "0 8px 32px rgba(212,84,74,0.12), inset 0 1px 0 rgba(255,255,255,0.6)",
        } : {
          maxWidth: "min(100%, 580px)",
          background: `linear-gradient(145deg, rgba(255,255,255,0.92), ${accentColor}18)`,
          border: `1px solid ${accentColor}35`,
          boxShadow: `0 8px 32px ${accentColor}18, inset 0 1px 0 rgba(255,255,255,0.7)`,
        }}
      >
        {/* Glossy top sheen */}
        <div className="absolute inset-x-0 top-0 h-2/5 bg-gradient-to-b from-white/30 to-transparent rounded-t-3xl pointer-events-none" />

        {/* Accent dot + sparkle cluster */}
        <div className="absolute top-4 right-4 flex items-center gap-1">
          <div
            className="w-2 h-2 rounded-full opacity-50"
            style={{ backgroundColor: accentColor }}
          />
          <Sparkle size={10} color={accentColor} delay={0.5} className="opacity-60" />
        </div>

        {title && (
          <h2 className={`relative z-10 font-display font-bold text-charcoal leading-tight mb-3 ${
            title.length < 40 ? "text-2xl" : "text-xl"
          }`}>
            {title}
          </h2>
        )}

        <div className="relative z-10 font-sans text-charcoal/85 text-base leading-relaxed pb-7">
          <BodyWithMentions body={body} accentColor={accentColor} onPersonaClick={onPersonaClick} />
        </div>

        <TtsButton isSpeaking={isSpeaking} onTts={onTts} accentColor={accentColor} />
      </motion.div>
    </div>
  );
}

// ─── Main FeedCard ────────────────────────────────────────────────────────────

// Set once /api/tts fails (e.g. no ElevenLabs key) so later taps go straight to browser speech
let serverTtsUnavailable = false;

export function FeedCard({ post, onOpenComments, onVisible, onPersonaClick }: FeedCardProps) {
  const [isSaved, setIsSaved] = useState(post.is_saved ?? false);
  const [isLiked, setIsLiked] = useState(post.is_liked ?? false);
  const [saveCategoryOpen, setSaveCategoryOpen] = useState(false);
  const [commentCount, setCommentCount] = useState(post.comment_count ?? 0);
  const [isVisible, setIsVisible] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const entryTimeRef = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
        if (entry.isIntersecting) {
          entryTimeRef.current = Date.now();
        } else if (entryTimeRef.current !== null) {
          const duration = Date.now() - entryTimeRef.current;
          onVisible(post.id, duration);
          entryTimeRef.current = null;
        }
      },
      { threshold: 0.6 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [post.id, onVisible]);

  // Opens the category picker; actual save happens in the sheet
  const handleSave = useCallback(() => {
    setSaveCategoryOpen(true);
  }, []);

  const handleLike = useCallback(async () => {
    const next = !isLiked;
    setIsLiked(next);
    try {
      const res = await fetch("/api/likes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post_id: post.id }),
      });
      const json = await res.json();
      setIsLiked(json.liked);
    } catch {
      setIsLiked(!next);
    }
  }, [isLiked, post.id]);

  const handleComment = useCallback(() => {
    onOpenComments(post.id, post.persona?.slug);
  }, [onOpenComments, post.id, post.persona?.slug]);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleTts = useCallback(async () => {
    // Stop if already playing
    if (isSpeaking) {
      window.speechSynthesis?.cancel();
      audioRef.current?.pause();
      if (audioRef.current?.src) URL.revokeObjectURL(audioRef.current.src);
      audioRef.current = null;
      setIsSpeaking(false);
      return;
    }

    const text = [post.title, post.body].filter(Boolean).join(". ");

    // Free fallback: the browser's built-in voice. Called synchronously from the
    // tap whenever possible, since iOS Safari blocks speech started later.
    const speakWithBrowser = () => {
      const synth = window.speechSynthesis;
      if (!synth) {
        setIsSpeaking(false);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = navigator.language;
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      synth.cancel();
      synth.speak(utterance);
    };

    setIsSpeaking(true);
    if (serverTtsUnavailable) {
      speakWithBrowser();
      return;
    }

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        serverTtsUnavailable = true;
        throw new Error("TTS request failed");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        audioRef.current = null;
        setIsSpeaking(false);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        audioRef.current = null;
        setIsSpeaking(false);
      };

      await audio.play();
    } catch {
      speakWithBrowser();
    }
  }, [isSpeaking, post.title, post.body]);

  // Stop TTS when card scrolls out of view
  useEffect(() => {
    if (!isVisible && isSpeaking) {
      window.speechSynthesis?.cancel();
      audioRef.current?.pause();
      if (audioRef.current?.src) URL.revokeObjectURL(audioRef.current.src);
      audioRef.current = null;
      setIsSpeaking(false);
    }
  }, [isVisible, isSpeaking]);

  const isReview = post.post_type === "review";
  const isTrap = post.post_type === "trap";
  const isReactive = (post as Post & { source?: string }).source === "reactive";
  const isPulse = (post as Post & { source?: string }).source === "pulse";
  const mediaType = post.media_type ?? "text";
  const accentColor = post.persona?.accent_color ?? "#C9B8E8";
  // Images are now contained in a card; only video/slideshow stay full-bleed
  const isFullBleed = mediaType === "video" || mediaType === "slideshow";

  return (
    <div
      ref={cardRef}
      className="relative h-dvh w-full flex flex-col overflow-hidden"
      style={{ scrollSnapAlign: "start" }}
    >
      {/* ── Background ──────────────────────────────────────────────────── */}
      {isFullBleed ? (
        <div className="absolute inset-0">
          {mediaType === "video" && post.media_url && (
            <VideoMedia url={post.media_url} isVisible={isVisible} />
          )}
          {mediaType === "slideshow" && post.media_url && (
            <SlideshowMedia url={post.media_url} isVisible={isVisible} />
          )}
        </div>
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background: mediaType === "audio"
              ? undefined
              : `linear-gradient(160deg, #FFF8F0 0%, ${accentColor}14 60%, ${accentColor}28 100%)`,
          }}
        />
      )}

      {/* Subtle decorative blobs for cream-background cards (text + image) */}
      {!isFullBleed && mediaType !== "audio" && (
        <>
          <div
            className="absolute top-[-60px] right-[-60px] w-48 h-48 rounded-full pointer-events-none"
            style={{
              background: accentColor,
              filter: "blur(50px)",
              opacity: 0.18,
            }}
          />
          <div
            className="absolute bottom-20 left-[-40px] w-36 h-36 rounded-full pointer-events-none"
            style={{
              background: accentColor,
              filter: "blur(40px)",
              opacity: 0.12,
            }}
          />
        </>
      )}

      {/* Review badge overlay */}
      {isReview && (
        <div className="absolute top-4 left-4 right-16 z-10">
          <div
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full"
            style={{
              background: "linear-gradient(135deg, rgba(245,217,122,0.85), rgba(232,196,58,0.7))",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(232,196,58,0.5)",
              boxShadow: "0 2px 8px rgba(232,196,58,0.3), inset 0 1px 0 rgba(255,255,255,0.4)",
            }}
          >
            <span className="text-xs">🔁</span>
            <span className="text-xs font-sans font-semibold text-amber-800">You saw this before. Still got it?</span>
          </div>
        </div>
      )}

      {/* ── Main content layer ─────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col h-full">

        {/* Top: persona badge + post type tag */}
        <div className={`px-5 pt-14 pb-3 flex items-start justify-between gap-3 ${isFullBleed ? "drop-shadow-lg" : ""}`}>
          {post.persona ? (
            <div className="flex items-center gap-2">
              <PersonaBadge
                persona={post.persona}
                onClick={onPersonaClick ? () => onPersonaClick(post.persona!.slug) : undefined}
              />
              {/* Sparkle cluster near persona for text cards */}
              {!isFullBleed && (
                <SparkleCluster color={accentColor} className="opacity-60 hidden sm:block" />
              )}
            </div>
          ) : (
            <div />
          )}
          <PostTypeTag type={post.post_type} glass={isFullBleed} />
          {/* Reactive / Pulse source badges */}
          {(isReactive || isPulse) && (
            <div
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-sans font-bold"
              style={{
                background: isReactive
                  ? `linear-gradient(135deg, ${accentColor}30, ${accentColor}50)`
                  : "linear-gradient(135deg, rgba(255,200,50,0.25), rgba(255,150,50,0.35))",
                border: isReactive
                  ? `1px solid ${accentColor}60`
                  : "1px solid rgba(255,180,50,0.5)",
                color: isReactive ? accentColor : "#B86000",
                backdropFilter: "blur(8px)",
              }}
            >
              <span>{isReactive ? "🔥" : "📡"}</span>
              <span>{isReactive ? "By popular demand" : "Community pulse"}</span>
            </div>
          )}
        </div>

        {/* Center: media-specific content */}
        {mediaType === "audio" && post.media_url ? (
          <div className="flex-1">
            <AudioMedia url={post.media_url} title={post.title} accentColor={accentColor} />
          </div>
        ) : mediaType === "image" && post.media_url ? (
          <ImageCardMedia
            url={post.media_url}
            title={post.title}
            body={post.body}
            accentColor={accentColor}
          />
        ) : mediaType === "text" || !post.media_url ? (
          <TextContent
            title={post.title}
            body={post.body}
            accentColor={accentColor}
            isTrap={isTrap}
            isSpeaking={isSpeaking}
            onTts={handleTts}
            onPersonaClick={onPersonaClick}
          />
        ) : (
          <div className="flex-1" />
        )}

        {/* Bottom: caption (for video/slideshow) + action bar */}
        <div className={`px-5 pb-8 flex items-end justify-between ${isFullBleed ? "drop-shadow-lg" : ""}`}>
          <div className="flex-1 pr-4">
            {isFullBleed && (post.title || post.body) ? (
              // Frosted glass caption for full-bleed video/slideshow
              <div
                className="rounded-2xl px-4 py-3"
                style={{
                  background: "rgba(20, 16, 12, 0.5)",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  border: "1px solid rgba(255,255,255,0.15)",
                }}
              >
                {post.title && (
                  <p className="font-display font-bold text-white text-sm leading-tight mb-0.5">
                    {post.title}
                  </p>
                )}
                <p className="font-sans text-white/80 text-xs leading-snug line-clamp-2">
                  {post.body}
                </p>
              </div>
            ) : mediaType !== "audio" ? (
              <p className="text-xs font-sans text-charcoal/50 italic">
                {isTrap
                  ? "Reply before you peek. 👀"
                  : isReview
                  ? "Can you explain this in one sentence?"
                  : "What's your take?"}
              </p>
            ) : null}
          </div>

          <ActionBar
            commentCount={commentCount}
            isSaved={isSaved}
            isLiked={isLiked}
            onComment={handleComment}
            onSave={handleSave}
            onLike={handleLike}
            accentColor={accentColor}
          />
        </div>
      </div>

      <SaveCategorySheet
        postId={saveCategoryOpen ? post.id : null}
        currentlySaved={isSaved}
        onClose={() => setSaveCategoryOpen(false)}
        onConfirm={(saved) => setIsSaved(saved)}
      />
    </div>
  );
}
