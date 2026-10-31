import { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import { splitIntoCards } from "./split";
import { bundledCategories, bundledLibraryDecks, fetchLibraryUpdates, mergeLibrary } from "./library";
import { generationErrorMessage, writeDeckOnDevice } from "./generate";
import {
  DEFAULT_REMINDER,
  allowExactReminders,
  exactRemindersAllowed,
  onReminderTapped,
  remindersSupported,
  scheduleReminders,
  type ReminderSettings,
  type ReminderStatus,
} from "./reminders";
import {
  loadCategoryPrefs,
  loadCustomCategories,
  loadDecks,
  loadGeminiKey,
  loadKnownLibrary,
  loadRead,
  loadSaved,
  newId,
  readPref,
  saveCategoryPrefs,
  saveCustomCategories,
  saveDecks,
  saveGeminiKey,
  saveKnownLibrary,
  saveRead,
  saveSaved,
  writePref,
  type Card,
  type Category,
  type CategoryPrefs,
  type Deck,
} from "./store";

type Tab = "feed" | "add" | "library" | "history" | "saved";

// A card counts as read once it has stayed on screen this long
const READ_AFTER_MS = 2500;
// On-device generation for the user's own categories: at most this many per launch
const AUTO_GENERATE_PER_LAUNCH = 3;
type FeedSource = { kind: "mix" } | { kind: "category"; id: string } | { kind: "deck"; id: string };

interface FeedItem {
  card: Card;
  deck: Deck;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hueFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

// Deterministic shuffle so the mixed feed keeps its order (and your place) between launches
function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = seed || 1;
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Decks are shuffled, but each deck's cards stay together and in order
const deckItems = (decks: Deck[]): FeedItem[] => decks.flatMap((deck) => deck.cards.map((card) => ({ card, deck })));

// Reading sizes cycled by the "Aa" button; one steady size is easier on the eyes
// than sizes that jump from card to card
const READING_SIZES = [17, 19, 21, 23];

const paragraphs = (text: string) => text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

function CardText({ card }: { card: Card }) {
  return (
    <>
      {card.title && <h2 className="card-title">{card.title}</h2>}
      <div className="card-text">
        {paragraphs(card.text).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {card.action && (
        <div className="card-action">
          <span className="card-action-label">Bugün dene</span>
          {card.action}
        </div>
      )}
    </>
  );
}

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });

const categoryLabel = (c: Category) => (c.emoji ? `${c.emoji} ${c.name}` : c.name);

// Scrolls each chip strip sideways so its selected chip is visible
function centerActiveChips() {
  document.querySelectorAll<HTMLElement>(".chips .chip.on").forEach((chip) => {
    const strip = chip.parentElement!;
    strip.scrollLeft = chip.offsetLeft - (strip.clientWidth - chip.clientWidth) / 2;
  });
}

// ─── Icons ───────────────────────────────────────────────────────────────────

const Icon = ({ d, filled = false }: { d: string; filled?: boolean }) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const HEART = "M12 21s-7.5-4.6-9.5-9.2C1.2 8.6 3.3 5 6.8 5c2 0 3.6 1.1 5.2 3 1.6-1.9 3.2-3 5.2-3 3.5 0 5.6 3.6 4.3 6.8C19.5 16.4 12 21 12 21z";
const HOME = "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z";
const PLUS = "M12 5v14M5 12h14";
const BOOKS = "M4 4h4v16H4zM10 4h4v16h-4zM16 5l3.5-1 3 15.5-3.5 1z";
const TRASH = "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3";
const SHUFFLE = "M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5";
const REFRESH = "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5";
const MORE = "M5 12h.01M12 12h.01M19 12h.01";
const CLOSE = "M6 6l12 12M18 6 6 18";
const EDIT = "M4 20h4L19 9l-4-4L4 16zM14 6l4 4";
const EYE = "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z";
const EYE_OFF = "M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2";
const TAGS = "M3 12V4h8l10 10-8 8zM7.5 7.5h.01";
const CHECK = "M5 12l5 5L20 7";
const CLOCK = "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2";
const BELL = "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0";
const TEXT_SIZE = "M3 19 8 5l5 14M4.8 14h6.4M14 19l3.5-9 3.5 9M15.2 16h4.6";
const SPARK = "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z";

// ─── Bottom sheet ────────────────────────────────────────────────────────────

// Open sheets, newest last; the Android back button closes the top one first
const openSheets: (() => void)[] = [];

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const close = () => closeRef.current();
    openSheets.push(close);
    return () => {
      openSheets.splice(openSheets.indexOf(close), 1);
    };
  }, []);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Kapat" onClick={onClose}>
            <Icon d={CLOSE} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

// Two-step delete so a stray tap never removes anything
function ConfirmDelete({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <div className="confirm">
      <button className="btn danger" onClick={onConfirm}>
        Evet, sil
      </button>
      <button className="btn ghost" onClick={() => setArmed(false)}>
        Vazgeç
      </button>
    </div>
  ) : (
    <button className="btn outline-danger" onClick={() => setArmed(true)}>
      <Icon d={TRASH} /> {label}
    </button>
  );
}

// ─── Feed ────────────────────────────────────────────────────────────────────

function Feed({
  items,
  positionKey,
  saved,
  onToggleSave,
  onRead,
  header,
  empty,
  textScale,
}: {
  items: FeedItem[];
  // Remembers the scroll position; feeds that drop read cards start at the top instead
  positionKey?: string;
  saved: Set<string>;
  onToggleSave: (cardId: string) => void;
  onRead?: (cardId: string) => void;
  header?: React.ReactNode;
  empty: React.ReactNode;
  // Changes when the reading size changes, to re-check which cards overflow
  textScale?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [burst, setBurst] = useState<string | null>(null);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  // A card counts as read once it has stayed on screen for a moment
  useEffect(() => {
    const id = items[index]?.card.id;
    if (!id || !onReadRef.current) return;
    const timer = setTimeout(() => onReadRef.current?.(id), READ_AFTER_MS);
    return () => clearTimeout(timer);
  }, [index, items]);

  // Long cards at large sizes scroll inside the card; fade their bottom edge so
  // it is clear there is more to read
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mark = () =>
      el.querySelectorAll<HTMLElement>(".card-body").forEach((body) => {
        const more = body.scrollHeight > body.clientHeight + 2;
        const atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 4;
        body.classList.toggle("has-more", more && !atEnd);
      });
    mark();
    el.addEventListener("scroll", mark, { capture: true, passive: true });
    window.addEventListener("resize", mark);
    return () => {
      el.removeEventListener("scroll", mark, { capture: true });
      window.removeEventListener("resize", mark);
    };
  }, [items, textScale]);

  // Restore where you left off in this feed
  useEffect(() => {
    const el = ref.current;
    if (!el || items.length === 0 || !positionKey) return;
    const saved = Math.min(readPref<number>(positionKey, 0), items.length - 1);
    (el.children[saved] as HTMLElement | undefined)?.scrollIntoView({ block: "start" });
    setIndex(saved);
  }, [positionKey, items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const i = Number((entry.target as HTMLElement).dataset.index);
            setIndex(i);
            if (positionKey) writePref(positionKey, i);
          }
        }
      },
      { root: el, threshold: 0.6 }
    );
    Array.from(el.children).forEach((c) => observer.observe(c));
    return () => observer.disconnect();
  }, [items, positionKey]);

  if (items.length === 0) {
    return (
      <div className="screen">
        {header}
        <div className="empty">{empty}</div>
      </div>
    );
  }

  return (
    <div className="screen">
      {header}
      <div className="feed" ref={ref}>
        {items.map(({ card, deck }, i) => {
          const hue = hueFor(deck.categoryId ?? deck.id);
          const isSaved = saved.has(card.id);
          const part = deck.cards.indexOf(card) + 1;
          return (
            <article
              key={card.id}
              data-index={i}
              className="card"
              style={{ background: `linear-gradient(180deg, hsl(${hue} 16% 12%), hsl(${hue} 12% 8%))` }}
              onDoubleClick={() => {
                if (!isSaved) onToggleSave(card.id);
                setBurst(card.id);
                setTimeout(() => setBurst(null), 700);
              }}
            >
              <div className="card-body">
                <div className="card-deck">
                  <span>{deck.title}</span>
                  {deck.cards.length > 1 && (
                    <span className="card-part">
                      {part} / {deck.cards.length}
                    </span>
                  )}
                </div>
                <CardText
                  card={
                    card.title?.toLocaleLowerCase("tr") === deck.title.toLocaleLowerCase("tr") ? { ...card, title: undefined } : card
                  }
                />
              </div>
              <div className="more-hint" aria-hidden="true">
                devamı ↓
              </div>
              {burst === card.id && (
                <div className="burst">
                  <Icon d={HEART} filled />
                </div>
              )}
              <div className="card-side">
                <button
                  className={`round ${isSaved ? "on" : ""}`}
                  onClick={() => onToggleSave(card.id)}
                  aria-label={isSaved ? "Kaydedilenlerden çıkar" : "Kaydet"}
                >
                  <Icon d={HEART} filled={isSaved} />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

// ─── Add ─────────────────────────────────────────────────────────────────────

function AddScreen({
  categories,
  onCreate,
}: {
  categories: Category[];
  onCreate: (title: string, text: string, categoryId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [categoryId, setCategoryId] = useState(() => readPref<string>("lastCategory", ""));
  const [status, setStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cardCount = useMemo(() => (text.trim() ? splitIntoCards(text).length : 0), [text]);

  async function handleFile(file: File) {
    setStatus("Dosya okunuyor…");
    try {
      let content: string;
      if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
        const { pdfToText } = await import("./pdf");
        content = await pdfToText(file, (p, n) => setStatus(`PDF okunuyor… ${p}/${n}`));
      } else {
        content = await file.text();
      }
      if (!content.trim()) {
        setStatus("Bu dosyada okunabilir metin yok (taranmış PDF olabilir).");
        return;
      }
      setText(content);
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
      setStatus(null);
    } catch {
      setStatus("Dosya okunamadı. Başka bir dosya dene.");
    }
  }

  function submit() {
    const fallback = text.trim().split("\n")[0].slice(0, 40).trim() || "Not";
    writePref("lastCategory", categoryId);
    onCreate(title.trim() || fallback, text, categoryId);
    setTitle("");
    setText("");
  }

  return (
    <div className="screen page">
      <h1>Not ekle</h1>
      <input className="field" placeholder="Başlık (isteğe bağlı)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <select className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
        <option value="">Kategorisiz</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {categoryLabel(c)}
          </option>
        ))}
      </select>
      <textarea
        className="field area"
        placeholder="Notlarını buraya yapıştır…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf,text/plain,.txt,.md"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
      <button className="btn ghost dashed" onClick={() => fileRef.current?.click()}>
        PDF veya TXT dosyası seç
      </button>
      {status && <p className="hint">{status}</p>}
      <button className="btn primary" disabled={cardCount === 0} onClick={submit}>
        {cardCount ? `${cardCount} karta böl ve kaydır` : "Kartlara böl ve kaydır"}
      </button>
    </div>
  );
}

// ─── Deck options ────────────────────────────────────────────────────────────

function DeckSheet({
  deck,
  categories,
  onMove,
  onRename,
  onDelete,
  onClose,
}: {
  deck: Deck;
  categories: Category[];
  onMove: (categoryId: string) => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(deck.title);
  const current = deck.categoryId ?? "";

  return (
    <Sheet title={deck.title} onClose={onClose}>
      <p className="sheet-label">Kategori</p>
      <div className="pick-grid">
        {[{ id: "", name: "Kategorisiz" } as Category, ...categories].map((c) => (
          <button key={c.id} className={`pick ${current === c.id ? "on" : ""}`} onClick={() => onMove(c.id)}>
            {categoryLabel(c)}
          </button>
        ))}
      </div>

      <p className="sheet-label">Ad</p>
      <div className="inline-form">
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button
          className="btn primary small"
          disabled={!title.trim() || title.trim() === deck.title}
          onClick={() => onRename(title.trim())}
        >
          Kaydet
        </button>
      </div>

      <ConfirmDelete label="Bu notu sil" onConfirm={onDelete} />
    </Sheet>
  );
}

// ─── Category manager ────────────────────────────────────────────────────────

function CategoryRow({
  category,
  count,
  generating,
  generateBusy,
  onGenerate,
  onUpdate,
  onToggleHidden,
  onDelete,
}: {
  category: Category;
  count: number;
  generating: boolean;
  // True while any category is being written, so only one runs at a time
  generateBusy: boolean;
  // Undefined when no Gemini key is set
  onGenerate?: () => void;
  onUpdate: (name: string, emoji: string) => void;
  onToggleHidden: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [emoji, setEmoji] = useState(category.emoji ?? "");

  if (editing) {
    return (
      <li className="cat-row editing">
        <div className="inline-form">
          <input className="field emoji" value={emoji} maxLength={4} placeholder="🙂" onChange={(e) => setEmoji(e.target.value)} />
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
          <button
            className="icon-btn on"
            aria-label="Kaydet"
            disabled={!name.trim()}
            onClick={() => {
              onUpdate(name.trim(), emoji.trim());
              setEditing(false);
            }}
          >
            <Icon d={CHECK} />
          </button>
        </div>
        {category.custom && <ConfirmDelete label="Kategoriyi sil (notlar kalır)" onConfirm={onDelete} />}
      </li>
    );
  }

  return (
    <li className={`cat-row ${category.hidden ? "dim" : ""}`}>
      <span className="cat-emoji">{category.emoji || "•"}</span>
      <span className="cat-name">
        {category.name}
        <small>
          {generating ? "Yeni okuma yazılıyor… (yarım dakika sürebilir)" : `${count} not${category.hidden ? " · akışta gizli" : ""}`}
        </small>
      </span>
      {onGenerate && (
        <button className={`icon-btn ${generating ? "spin" : ""}`} aria-label="Bu kategori için yeni okuma üret" disabled={generateBusy} onClick={onGenerate}>
          <Icon d={SPARK} />
        </button>
      )}
      <button className="icon-btn" aria-label={category.hidden ? "Akışta göster" : "Akışta gizle"} onClick={onToggleHidden}>
        <Icon d={category.hidden ? EYE_OFF : EYE} />
      </button>
      <button className="icon-btn" aria-label="Düzenle" onClick={() => setEditing(true)}>
        <Icon d={EDIT} />
      </button>
    </li>
  );
}

function GeneratorSettings({
  apiKey,
  autoGenerate,
  onSaveKey,
  onToggleAuto,
}: {
  apiKey: string;
  autoGenerate: boolean;
  onSaveKey: (key: string) => void;
  onToggleAuto: () => void;
}) {
  const [editing, setEditing] = useState(!apiKey);
  const [draft, setDraft] = useState("");

  if (!editing) {
    return (
      <div className="gen-box">
        <p className="gen-ok">
          <Icon d={CHECK} /> Gemini anahtarı kayıtlı
        </p>
        <label className="toggle">
          <input type="checkbox" checked={autoGenerate} onChange={onToggleAuto} />
          <span>Kendi kategorilerime her gün otomatik yeni okuma yaz</span>
        </label>
        <p className="hint small">✨ ile istediğin kategoriye hemen yeni okuma yazdırabilirsin.</p>
        <button className="link-btn" onClick={() => setEditing(true)}>
          Anahtarı değiştir veya kaldır
        </button>
      </div>
    );
  }

  return (
    <div className="gen-box">
      <p className="hint small">
        Hazır kategoriler her gün GitHub'dan yeni okuma alır. Kendi eklediğin kategorilere de içerik yazılması için ücretsiz Gemini
        anahtarını gir; anahtar yalnızca bu telefonda saklanır.
      </p>
      <div className="inline-form">
        <input
          className="field"
          type="password"
          autoComplete="off"
          placeholder={apiKey ? "Yeni anahtar" : "Gemini API anahtarı"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          className="btn primary small"
          disabled={!draft.trim()}
          onClick={() => {
            onSaveKey(draft.trim());
            setDraft("");
            setEditing(false);
          }}
        >
          Kaydet
        </button>
      </div>
      <a className="link-btn" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
        Anahtarı nereden alırım? (aistudio.google.com/apikey)
      </a>
      {apiKey && (
        <div className="confirm">
          <button
            className="btn outline-danger"
            onClick={() => {
              onSaveKey("");
              setEditing(true);
            }}
          >
            Anahtarı kaldır
          </button>
          <button className="btn ghost" onClick={() => setEditing(false)}>
            Vazgeç
          </button>
        </div>
      )}
    </div>
  );
}

function CategoryManager({
  categories,
  counts,
  apiKey,
  autoGenerate,
  generatingId,
  onSaveKey,
  onToggleAuto,
  onGenerate,
  onAdd,
  onUpdate,
  onToggleHidden,
  onDelete,
  onClose,
}: {
  categories: Category[];
  counts: Map<string, number>;
  apiKey: string;
  autoGenerate: boolean;
  generatingId: string | null;
  onSaveKey: (key: string) => void;
  onToggleAuto: () => void;
  onGenerate: (id: string) => void;
  onAdd: (name: string, emoji: string) => void;
  onUpdate: (id: string, name: string, emoji: string) => void;
  onToggleHidden: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");

  return (
    <Sheet title="Kategoriler" onClose={onClose}>
      <p className="sheet-label">İçerik üretimi</p>
      <GeneratorSettings apiKey={apiKey} autoGenerate={autoGenerate} onSaveKey={onSaveKey} onToggleAuto={onToggleAuto} />

      <p className="sheet-label">Yeni kategori</p>
      <div className="inline-form">
        <input className="field emoji" value={emoji} maxLength={4} placeholder="🙂" onChange={(e) => setEmoji(e.target.value)} />
        <input className="field" value={name} placeholder="Kategori adı" onChange={(e) => setName(e.target.value)} />
        <button
          className="btn primary small"
          disabled={!name.trim()}
          onClick={() => {
            onAdd(name.trim(), emoji.trim());
            setName("");
            setEmoji("");
          }}
        >
          Ekle
        </button>
      </div>

      <p className="sheet-label">Tüm kategoriler</p>
      <p className="hint small">Göz simgesiyle bir kategoriyi akıştan gizleyebilirsin; notları kütüphanede kalır.</p>
      <ul className="cat-list">
        {categories.map((c) => (
          <CategoryRow
            key={c.id}
            category={c}
            count={counts.get(c.id) ?? 0}
            generating={generatingId === c.id}
            generateBusy={!!generatingId}
            onGenerate={apiKey ? () => onGenerate(c.id) : undefined}
            onUpdate={(n, e) => onUpdate(c.id, n, e)}
            onToggleHidden={() => onToggleHidden(c.id)}
            onDelete={() => onDelete(c.id)}
          />
        ))}
      </ul>
    </Sheet>
  );
}

// ─── History ─────────────────────────────────────────────────────────────────

function dayLabel(ms: number) {
  const day = new Date(ms);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (day.toDateString() === today.toDateString()) return "Bugün";
  if (day.toDateString() === yesterday.toDateString()) return "Dün";
  return day.toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "long" });
}

const HISTORY_PAGE = 100;

function History({
  entries,
  onOpen,
  onClear,
}: {
  entries: { item: FeedItem; readAt: number }[];
  onOpen: (item: FeedItem) => void;
  onClear: () => void;
}) {
  const [limit, setLimit] = useState(HISTORY_PAGE);
  const shown = entries.slice(0, limit);
  const groups: { label: string; items: typeof shown }[] = [];
  for (const entry of shown) {
    const label = dayLabel(entry.readAt);
    if (groups[groups.length - 1]?.label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push(entry);
  }

  return (
    <div className="screen page">
      <div className="page-head">
        <div>
          <h1>Geçmiş</h1>
          <p className="hint small">{entries.length ? `${entries.length} kart okudun` : ""}</p>
        </div>
      </div>

      {entries.length === 0 && (
        <p className="hint">
          Akışta okuduğun kartlar burada birikir ve akışta bir daha karşına çıkmaz. Bir kart birkaç saniye ekranda kalınca okundu
          sayılır.
        </p>
      )}

      {groups.map((group) => (
        <section key={group.label} className="history-group">
          <p className="sheet-label">{group.label}</p>
          <ul className="list">
            {group.items.map(({ item, readAt }) => (
              <li key={item.card.id} className="row" style={{ borderLeftColor: `hsl(${hueFor(item.deck.categoryId ?? item.deck.id)} 60% 55%)` }}>
                <button className="row-main" onClick={() => onOpen(item)}>
                  <span className="row-title">{item.card.title || item.card.text.slice(0, 60)}</span>
                  <span className="row-meta">
                    {item.deck.title} · {new Date(readAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {entries.length > limit && (
        <button className="btn ghost" onClick={() => setLimit(limit + HISTORY_PAGE)}>
          Daha fazla göster
        </button>
      )}
      {entries.length > 0 && (
        <div className="history-clear">
          <ConfirmDelete label="Tümünü okunmadı yap" onConfirm={onClear} />
          <p className="hint small">Kartlar akışa geri döner; notların silinmez.</p>
        </div>
      )}
    </div>
  );
}

function CardSheet({
  item,
  isSaved,
  onToggleSave,
  onUnread,
  onOpenDeck,
  onClose,
}: {
  item: FeedItem;
  isSaved: boolean;
  onToggleSave: () => void;
  onUnread: () => void;
  onOpenDeck: () => void;
  onClose: () => void;
}) {
  const { card, deck } = item;
  return (
    <Sheet title={deck.title} onClose={onClose}>
      <div className="reading sheet-reading">
        <CardText card={card} />
      </div>
      <div className="sheet-actions">
        <button className={`btn ghost ${isSaved ? "saved" : ""}`} onClick={onToggleSave}>
          <Icon d={HEART} filled={isSaved} /> {isSaved ? "Kaydedildi" : "Kaydet"}
        </button>
        <button className="btn ghost" onClick={onUnread}>
          Okunmadı yap
        </button>
      </div>
      <button className="btn ghost" onClick={onOpenDeck}>
        Notun tamamını aç
      </button>
    </Sheet>
  );
}

// ─── Reminder ────────────────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, "0");

function ReminderSheet({
  settings,
  status,
  exact,
  onChange,
  onAllowExact,
  onClose,
}: {
  settings: ReminderSettings;
  status: ReminderStatus | null;
  exact: boolean;
  onChange: (next: ReminderSettings) => void;
  onAllowExact: () => void;
  onClose: () => void;
}) {
  const time = `${pad2(settings.hour)}:${pad2(settings.minute)}`;
  return (
    <Sheet title="Hatırlatıcı" onClose={onClose}>
      {!remindersSupported() && <p className="hint small">Bildirimler yalnızca telefondaki uygulamada çalışır.</p>}
      <label className="toggle">
        <input type="checkbox" checked={settings.enabled} onChange={() => onChange({ ...settings, enabled: !settings.enabled })} />
        <span>Her gün okuma hatırlatıcısı</span>
      </label>
      <label className="time-row">
        <span>Saat</span>
        <input
          className="field time"
          type="time"
          value={time}
          disabled={!settings.enabled}
          onChange={(e) => {
            const [h, m] = e.target.value.split(":").map(Number);
            if (Number.isFinite(h) && Number.isFinite(m)) onChange({ ...settings, hour: h, minute: m });
          }}
        />
      </label>
      {status === "scheduled" && <p className="hint small">Her gün {time}'da okunmamış bir yazıyı hatırlatacağım.</p>}
      {status === "denied" && (
        <p className="hint small">
          Bildirim izni kapalı. Telefonun Ayarlar → Uygulamalar → Scrollabus → Bildirimler bölümünden izin verip uygulamayı yeniden
          aç.
        </p>
      )}
      {status === "scheduled" && !exact && (
        <>
          <p className="hint small">Android hatırlatmayı birkaç dakika geç gösterebilir. Tam saatinde gelmesi için izin verebilirsin.</p>
          <button className="btn ghost" onClick={onAllowExact}>
            Tam saatinde gelsin
          </button>
        </>
      )}
    </Sheet>
  );
}

// ─── Library ─────────────────────────────────────────────────────────────────

function Library({
  decks,
  categories,
  read,
  syncStatus,
  onSync,
  onOpen,
  onOptions,
  onManageCategories,
  onReminder,
}: {
  decks: Deck[];
  categories: Category[];
  read: Map<string, number>;
  syncStatus: string;
  onSync: () => void;
  onOpen: (id: string) => void;
  onOptions: (id: string) => void;
  onManageCategories: () => void;
  onReminder: () => void;
}) {
  const [filter, setFilter] = useState<string | null>(() => readPref<string | null>("libraryFilter", null));
  useEffect(() => {
    writePref("libraryFilter", filter);
    centerActiveChips();
  }, [filter]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of decks) m.set(d.categoryId ?? "", (m.get(d.categoryId ?? "") ?? 0) + 1);
    return m;
  }, [decks]);
  const byId = new Map(categories.map((c) => [c.id, c]));

  const isDone = (d: Deck) => d.cards.length > 0 && d.cards.every((c) => read.has(c.id));
  // Newest first, but decks you have finished sink to the bottom
  const visible = decks
    .filter((d) => filter === null || (d.categoryId ?? "") === filter)
    .sort((a, b) => Number(isDone(a)) - Number(isDone(b)) || b.createdAt - a.createdAt);

  return (
    <div className="screen page">
      <div className="page-head">
        <div>
          <h1>Kütüphane</h1>
          <p className="hint small">{syncStatus}</p>
        </div>
        <div className="head-actions">
          <button className="pill-btn round-pill" aria-label="Yeni içerikleri kontrol et" onClick={onSync}>
            <Icon d={REFRESH} />
          </button>
          <button className="pill-btn round-pill" aria-label="Hatırlatıcı" onClick={onReminder}>
            <Icon d={BELL} />
          </button>
          <button className="pill-btn" onClick={onManageCategories}>
            <Icon d={TAGS} /> Kategoriler
          </button>
        </div>
      </div>

      <div className="chips strip">
        <button className={`chip ${filter === null ? "on" : ""}`} onClick={() => setFilter(null)}>
          Tümü · {decks.length}
        </button>
        {categories
          .filter((c) => (counts.get(c.id) ?? 0) > 0)
          .map((c) => (
            <button key={c.id} className={`chip ${filter === c.id ? "on" : ""}`} onClick={() => setFilter(c.id)}>
              {categoryLabel(c)} · {counts.get(c.id)}
            </button>
          ))}
        {(counts.get("") ?? 0) > 0 && (
          <button className={`chip ${filter === "" ? "on" : ""}`} onClick={() => setFilter("")}>
            Kategorisiz · {counts.get("")}
          </button>
        )}
      </div>

      {visible.length === 0 && <p className="hint">Burada henüz not yok.</p>}
      <ul className="list">
        {visible.map((deck) => {
          const cat = deck.categoryId ? byId.get(deck.categoryId) : undefined;
          const readCount = deck.cards.filter((c) => read.has(c.id)).length;
          const progress =
            readCount === 0 ? `${deck.cards.length} kart` : readCount === deck.cards.length ? "✓ Okundu" : `${readCount}/${deck.cards.length} okundu`;
          return (
            <li
              key={deck.id}
              className={`row ${readCount === deck.cards.length && readCount > 0 ? "done" : ""}`}
              style={{ borderLeftColor: `hsl(${hueFor(deck.categoryId ?? deck.id)} 60% 55%)` }}
            >
              <button className="row-main" onClick={() => onOpen(deck.id)}>
                <span className="row-title">{deck.title}</span>
                <span className="row-meta">
                  {deck.generated ? "✨ " : ""}
                  {cat ? categoryLabel(cat) : "Kategorisiz"} · {progress}
                  {deck.fromLibrary ? "" : ` · ${formatDate(deck.createdAt)}`}
                </span>
              </button>
              <button className="icon-btn" aria-label="Seçenekler" onClick={() => onOptions(deck.id)}>
                <Icon d={MORE} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

export function App() {
  const [tab, setTab] = useState<Tab>("feed");
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [read, setRead] = useState<Map<string, number>>(new Map());
  const [customCategories, setCustomCategories] = useState<Category[]>([]);
  const [categoryPrefs, setCategoryPrefs] = useState<CategoryPrefs>({});
  const [libraryCategories, setLibraryCategories] = useState<Category[]>(() =>
    readPref<Category[]>("libraryCategories", bundledCategories)
  );
  const [source, setSource] = useState<FeedSource>(() => readPref<FeedSource>("source", { kind: "mix" }));
  const [seed, setSeed] = useState(() => readPref<number>("seed", Date.now() % 100000));
  const [syncStatus, setSyncStatus] = useState("");
  const [deckOptions, setDeckOptions] = useState<string | null>(null);
  const [managingCategories, setManagingCategories] = useState(false);
  const [historyItem, setHistoryItem] = useState<FeedItem | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [autoGenerate, setAutoGenerate] = useState(() => readPref<boolean>("autoGenerate", true));
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; deckId?: string } | null>(null);
  const [sizeIndex, setSizeIndex] = useState(() => readPref<number>("readingSize", 1));
  const [reminder, setReminder] = useState<ReminderSettings>(() => readPref("reminder", DEFAULT_REMINDER));
  const [reminderStatus, setReminderStatus] = useState<ReminderStatus | null>(null);
  const [exactReminders, setExactReminders] = useState(true);
  const [showReminder, setShowReminder] = useState(false);
  // Bumped to rebuild the feed on purpose (e.g. after writing new content from its empty state)
  const [feedNonce, setFeedNonce] = useState(0);

  // Latest values for async callbacks
  const decksRef = useRef<Deck[]>([]);
  decksRef.current = decks ?? [];
  const knownRef = useRef<Set<string>>(new Set());
  const readRef = useRef(read);
  readRef.current = read;
  const generatingRef = useRef(false);

  function updateDecks(next: Deck[]) {
    decksRef.current = next;
    setDecks(next);
    void saveDecks(next);
  }

  function updateRead(next: Map<string, number>) {
    readRef.current = next;
    setRead(next);
    void saveRead(next);
  }

  function showToast(text: string, deckId?: string) {
    setToast({ text, deckId });
  }
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.deckId ? 6000 : 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  async function syncLibrary() {
    setSyncStatus("Kontrol ediliyor…");
    try {
      const known = knownRef.current;
      const byId = new Map(decksRef.current.map((d) => [d.id, d]));
      const { categories, decks: incoming } = await fetchLibraryUpdates((id, version) => {
        const have = byId.get(id);
        return have ? !!have.fromLibrary && (have.version ?? 1) < version : !known.has(id);
      });
      setLibraryCategories(categories);
      writePref("libraryCategories", categories);
      const { decks: merged, added, updated } = mergeLibrary(decksRef.current, incoming, known);
      if (added || updated) {
        updateDecks(merged);
        void saveKnownLibrary(known);
      }
      const status = added ? `${added} yeni okuma eklendi` : updated ? `${updated} okuma güncellendi` : "İçerikler güncel";
      setSyncStatus(status);
      return status;
    } catch {
      setSyncStatus("Çevrimdışı · yeni içerik için internete bağlan");
      return "İnternet bağlantısı yok";
    }
  }

  useEffect(() => {
    void Promise.all([
      loadDecks(),
      loadSaved(),
      loadCustomCategories(),
      loadKnownLibrary(),
      loadCategoryPrefs(),
      loadRead(),
      loadGeminiKey(),
    ]).then(([stored, s, custom, known, prefs, readLog, key]) => {
      // Add (or refresh) the reading decks bundled with this app version
      const { decks: merged, added, updated } = mergeLibrary(stored, bundledLibraryDecks(), known);
      knownRef.current = known;
      if (added || updated) {
        void saveDecks(merged);
        void saveKnownLibrary(known);
      }
      decksRef.current = merged;
      readRef.current = readLog;
      setRead(readLog);
      setDecks(merged);
      setSaved(s);
      setCustomCategories(custom);
      setCategoryPrefs(prefs);
      setApiKey(key);
      void syncLibrary();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => writePref("source", source), [source]);
  useEffect(() => writePref("seed", seed), [seed]);
  useEffect(() => writePref("autoGenerate", autoGenerate), [autoGenerate]);
  useEffect(() => writePref("readingSize", sizeIndex), [sizeIndex]);

  // Daily reminder: (re)schedule on launch and whenever its settings change,
  // each day suggesting a different unread reading, newest first
  async function refreshReminders(settings: ReminderSettings) {
    const unread = decksRef.current
      .filter((d) => d.fromLibrary || d.generated)
      .filter((d) => d.cards.some((c) => !readRef.current.has(c.id)))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((d) => d.title);
    try {
      setReminderStatus(await scheduleReminders(settings, unread));
      setExactReminders(await exactRemindersAllowed());
    } catch {
      setReminderStatus(null);
    }
  }
  useEffect(() => {
    writePref("reminder", reminder);
    if (decks !== null) void refreshReminders(reminder);
  }, [reminder, decks === null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onReminderTapped(() => setTab("feed")), []);

  // Android back button: close a sheet, then leave sub-screens, then exit
  const tabRef = useRef(tab);
  tabRef.current = tab;
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handle = NativeApp.addListener("backButton", () => {
      if (openSheets.length) openSheets[openSheets.length - 1]();
      else if (tabRef.current !== "feed") setTab("feed");
      else void NativeApp.exitApp();
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }, []);

  const allDecks = useMemo(() => decks ?? [], [decks]);
  const categories = useMemo<Category[]>(
    () =>
      [...libraryCategories, ...customCategories].map((c) => ({
        ...c,
        name: categoryPrefs[c.id]?.name ?? c.name,
        emoji: categoryPrefs[c.id]?.emoji ?? c.emoji,
        hidden: !!categoryPrefs[c.id]?.hidden,
      })),
    [libraryCategories, customCategories, categoryPrefs]
  );
  const hiddenIds = useMemo(() => new Set(categories.filter((c) => c.hidden).map((c) => c.id)), [categories]);
  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of allDecks) if (d.categoryId) m.set(d.categoryId, (m.get(d.categoryId) ?? 0) + 1);
    return m;
  }, [allDecks]);

  const activeDeck = source.kind === "deck" ? allDecks.find((d) => d.id === source.id) : undefined;
  const activeCategory = source.kind === "category" ? categories.find((c) => c.id === source.id) : undefined;
  const feedCategories = categories.filter((c) => !c.hidden && (categoryCounts.get(c.id) ?? 0) > 0);
  const feedKey = activeDeck ? `deck:${activeDeck.id}` : activeCategory ? `cat:${activeCategory.id}` : "mix";

  // The feed is built from a snapshot taken when it is (re)opened: read cards
  // leave and new decks join then, so cards never shift under your thumb
  const snapshotDeps = [tab, feedKey, seed, decks === null, feedNonce];
  const readSnapshot = useMemo(() => new Set(readRef.current.keys()), snapshotDeps); // eslint-disable-line react-hooks/exhaustive-deps
  const feedDecks = useMemo(() => decksRef.current, snapshotDeps); // eslint-disable-line react-hooks/exhaustive-deps

  const feedPool = useMemo<FeedItem[]>(() => {
    if (activeDeck) return deckItems([activeDeck]);
    const pool = activeCategory
      ? feedDecks.filter((d) => d.categoryId === activeCategory.id)
      : feedDecks.filter((d) => !d.categoryId || !hiddenIds.has(d.categoryId));
    return deckItems(shuffled(pool, seed));
  }, [feedDecks, activeDeck, activeCategory, hiddenIds, seed]);
  // A deck opened on purpose shows every card; the endless feeds skip read ones
  const feedItems = useMemo(
    () => (activeDeck ? feedPool : feedPool.filter((it) => !readSnapshot.has(it.card.id))),
    [feedPool, activeDeck, readSnapshot]
  );

  const savedItems = useMemo<FeedItem[]>(
    () => allDecks.flatMap((deck) => deck.cards.filter((c) => saved.has(c.id)).map((card) => ({ card, deck }))),
    [allDecks, saved]
  );

  const historyEntries = useMemo(() => {
    const byCard = new Map<string, FeedItem>();
    for (const deck of allDecks) for (const card of deck.cards) byCard.set(card.id, { card, deck });
    return [...read]
      .flatMap(([id, readAt]) => {
        const item = byCard.get(id);
        return item ? [{ item, readAt }] : [];
      })
      .sort((a, b) => b.readAt - a.readAt);
  }, [allDecks, read]);

  useEffect(() => centerActiveChips(), [tab, source]);

  function markRead(cardId: string) {
    if (readRef.current.has(cardId)) return;
    const next = new Map(readRef.current);
    next.set(cardId, Date.now());
    updateRead(next);
  }

  function markUnread(cardId: string) {
    const next = new Map(readRef.current);
    next.delete(cardId);
    updateRead(next);
  }

  function toggleSave(cardId: string) {
    const next = new Set(saved);
    if (next.has(cardId)) next.delete(cardId);
    else next.add(cardId);
    setSaved(next);
    void saveSaved(next);
  }

  function openDeck(id: string) {
    setSource({ kind: "deck", id });
    setTab("feed");
  }

  async function generateFor(categoryId: string, auto = false) {
    const category = categories.find((c) => c.id === categoryId);
    if (!apiKey || !category || generatingRef.current) return false;
    generatingRef.current = true;
    setGeneratingId(categoryId);
    try {
      const deck = await writeDeckOnDevice(apiKey, category, decksRef.current);
      updateDecks([...decksRef.current, deck]);
      showToast(`✨ ${category.emoji ?? ""} ${category.name}: "${deck.title}" eklendi`, deck.id);
      return true;
    } catch (err) {
      showToast(`${auto ? "Otomatik içerik yazılamadı: " : ""}${generationErrorMessage(err)}`);
      return false;
    } finally {
      generatingRef.current = false;
      setGeneratingId(null);
    }
  }

  // Once a day, write a fresh reading for each of the user's own categories
  const autoRanRef = useRef(false);
  useEffect(() => {
    if (decks === null || !apiKey || !autoGenerate || autoRanRef.current) return;
    autoRanRef.current = true;
    const today = new Date().toISOString().slice(0, 10);
    const due = customCategories
      .filter((c) => !categoryPrefs[c.id]?.hidden && readPref<string>(`autogen:${c.id}`, "") !== today)
      .slice(0, AUTO_GENERATE_PER_LAUNCH);
    void (async () => {
      for (const c of due) {
        writePref(`autogen:${c.id}`, today);
        if (!(await generateFor(c.id, true))) break;
      }
    })();
  }, [decks === null, apiKey, autoGenerate]); // eslint-disable-line react-hooks/exhaustive-deps

  function createDeck(title: string, text: string, categoryId: string) {
    const deck: Deck = {
      id: newId(),
      title,
      createdAt: Date.now(),
      categoryId: categoryId || undefined,
      cards: splitIntoCards(text).map((c) => ({ ...c, id: newId() })),
    };
    updateDecks([deck, ...allDecks]);
    writePref(`pos:deck:${deck.id}`, 0);
    openDeck(deck.id);
  }

  function patchDeck(id: string, patch: Partial<Deck>) {
    updateDecks(allDecks.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function deleteDeck(id: string) {
    const deck = allDecks.find((d) => d.id === id);
    updateDecks(allDecks.filter((d) => d.id !== id));
    if (deck) {
      const next = new Set(saved);
      deck.cards.forEach((c) => next.delete(c.id));
      setSaved(next);
      void saveSaved(next);
    }
    if (source.kind === "deck" && source.id === id) setSource({ kind: "mix" });
  }

  function updatePrefs(id: string, patch: CategoryPrefs[string]) {
    const next = { ...categoryPrefs, [id]: { ...categoryPrefs[id], ...patch } };
    setCategoryPrefs(next);
    void saveCategoryPrefs(next);
  }

  function addCategory(name: string, emoji: string) {
    const next = [...customCategories, { id: `custom-${newId()}`, name, emoji: emoji || undefined, custom: true }];
    setCustomCategories(next);
    void saveCustomCategories(next);
  }

  function deleteCategory(id: string) {
    const next = customCategories.filter((c) => c.id !== id);
    setCustomCategories(next);
    void saveCustomCategories(next);
    const prefs = { ...categoryPrefs };
    delete prefs[id];
    setCategoryPrefs(prefs);
    void saveCategoryPrefs(prefs);
    updateDecks(allDecks.map((d) => (d.categoryId === id ? { ...d, categoryId: undefined } : d)));
    if (source.kind === "category" && source.id === id) setSource({ kind: "mix" });
  }

  function reshuffle() {
    setSeed(Math.floor(Math.random() * 100000) + 1);
  }

  const chips = (
    <div className="topbar">
      <div className="topbar-row">
        <div className="chips">
          <button
            className={`chip ${source.kind === "mix" ? "on" : ""}`}
            onClick={() => {
              // Tapping "Karışık" again reshuffles
              if (source.kind === "mix") reshuffle();
              setSource({ kind: "mix" });
            }}
          >
            <Icon d={SHUFFLE} /> Karışık
          </button>
          {activeDeck && <button className="chip on">{activeDeck.title}</button>}
          {feedCategories.map((c) => (
            <button
              key={c.id}
              className={`chip ${activeCategory?.id === c.id ? "on" : ""}`}
              onClick={() => setSource({ kind: "category", id: c.id })}
            >
              {categoryLabel(c)}
            </button>
          ))}
        </div>
        <button
          className="aa-btn"
          aria-label="Yazı boyutu"
          onClick={() => {
            const next = (sizeIndex + 1) % READING_SIZES.length;
            setSizeIndex(next);
            showToast(`Yazı boyutu: ${["Küçük", "Orta", "Büyük", "Çok büyük"][next]}`);
          }}
        >
          <Icon d={TEXT_SIZE} />
        </button>
      </div>
    </div>
  );

  if (decks === null) return <div className="app" />;

  const optionsDeck = deckOptions ? allDecks.find((d) => d.id === deckOptions) : undefined;

  const feedEmpty =
    allDecks.length === 0 ? (
      <>
        <h2>Kaydıracak bir şey yok</h2>
        <p>Notlarını ekle, kart kart kaydır.</p>
        <button className="btn primary" onClick={() => setTab("add")}>
          Not ekle
        </button>
      </>
    ) : (
      <>
        <h2>Hepsini okudun 🎉</h2>
        <p>
          {activeCategory ? `${categoryLabel(activeCategory)} kategorisinde` : "Akışta"} okunmamış kart kalmadı. Yeni içerikler her
          sabah gelir.
        </p>
        <div className="empty-actions">
          {activeCategory && apiKey && (
            <button
              className="btn primary"
              disabled={!!generatingId}
              onClick={() => void generateFor(activeCategory.id).then((ok) => ok && setFeedNonce((n) => n + 1))}
            >
              <Icon d={SPARK} /> {generatingId ? "Yazılıyor…" : "Bu kategoriye yeni okuma yaz"}
            </button>
          )}
          <button
            className="btn ghost"
            onClick={() =>
              void syncLibrary().then((status) => {
                showToast(status);
                setFeedNonce((n) => n + 1);
              })
            }
          >
            <Icon d={REFRESH} /> Yeni içerik var mı bak
          </button>
          <button className="btn ghost" onClick={() => setTab("history")}>
            <Icon d={CLOCK} /> Geçmişe git
          </button>
        </div>
      </>
    );

  return (
    <div className="app" style={{ "--reading-size": `${READING_SIZES[sizeIndex] ?? 19}px` } as React.CSSProperties}>
      <main className="main">
        {tab === "feed" && (
          <Feed
            key={`${feedKey}:${seed}:${feedNonce}:${readSnapshot.size}`}
            items={feedItems}
            positionKey={activeDeck ? `pos:${feedKey}` : undefined}
            saved={saved}
            onToggleSave={toggleSave}
            onRead={markRead}
            textScale={sizeIndex}
            header={allDecks.length > 0 ? chips : undefined}
            empty={feedEmpty}
          />
        )}
        {tab === "saved" && (
          <Feed
            key="saved"
            items={savedItems}
            positionKey="pos:saved"
            saved={saved}
            onToggleSave={toggleSave}
            textScale={sizeIndex}
            empty={
              <>
                <h2>Kaydedilen kart yok</h2>
                <p>Akışta bir karta çift dokun ya da kalbe bas.</p>
              </>
            }
          />
        )}
        {tab === "add" && <AddScreen categories={categories} onCreate={createDeck} />}
        {tab === "library" && (
          <Library
            decks={allDecks}
            categories={categories}
            read={read}
            syncStatus={syncStatus}
            onSync={() => void syncLibrary()}
            onOpen={openDeck}
            onOptions={setDeckOptions}
            onManageCategories={() => setManagingCategories(true)}
            onReminder={() => setShowReminder(true)}
          />
        )}
        {tab === "history" && (
          <History entries={historyEntries} onOpen={setHistoryItem} onClear={() => updateRead(new Map())} />
        )}
      </main>

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.deckId && (
            <button
              onClick={() => {
                openDeck(toast.deckId!);
                setManagingCategories(false);
                setToast(null);
              }}
            >
              Oku
            </button>
          )}
        </div>
      )}

      <nav className="nav">
        {(
          [
            ["feed", HOME, "Akış"],
            ["add", PLUS, "Ekle"],
            ["library", BOOKS, "Kütüphane"],
            ["history", CLOCK, "Geçmiş"],
            ["saved", HEART, "Kaydedilenler"],
          ] as const
        ).map(([id, icon, label]) => (
          <button key={id} className={`nav-btn ${tab === id ? "on" : ""}`} onClick={() => setTab(id)}>
            <Icon d={icon} filled={id === "saved" && tab === id} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {optionsDeck && (
        <DeckSheet
          key={optionsDeck.id}
          deck={optionsDeck}
          categories={categories}
          onMove={(categoryId) => patchDeck(optionsDeck.id, { categoryId: categoryId || undefined })}
          onRename={(title) => patchDeck(optionsDeck.id, { title, renamed: true })}
          onDelete={() => {
            deleteDeck(optionsDeck.id);
            setDeckOptions(null);
          }}
          onClose={() => setDeckOptions(null)}
        />
      )}
      {historyItem && (
        <CardSheet
          item={historyItem}
          isSaved={saved.has(historyItem.card.id)}
          onToggleSave={() => toggleSave(historyItem.card.id)}
          onUnread={() => {
            markUnread(historyItem.card.id);
            setHistoryItem(null);
            showToast("Kart akışa geri döndü");
          }}
          onOpenDeck={() => {
            setHistoryItem(null);
            openDeck(historyItem.deck.id);
          }}
          onClose={() => setHistoryItem(null)}
        />
      )}
      {showReminder && (
        <ReminderSheet
          settings={reminder}
          status={reminderStatus}
          exact={exactReminders}
          onChange={setReminder}
          onAllowExact={() => void allowExactReminders().then(() => refreshReminders(reminder))}
          onClose={() => setShowReminder(false)}
        />
      )}
      {managingCategories && (
        <CategoryManager
          categories={categories}
          counts={categoryCounts}
          apiKey={apiKey}
          autoGenerate={autoGenerate}
          generatingId={generatingId}
          onSaveKey={(key) => {
            setApiKey(key);
            void saveGeminiKey(key);
          }}
          onToggleAuto={() => setAutoGenerate(!autoGenerate)}
          onGenerate={(id) => void generateFor(id)}
          onAdd={addCategory}
          onUpdate={(id, name, emoji) => updatePrefs(id, { name, emoji: emoji || undefined })}
          onToggleHidden={(id) => updatePrefs(id, { hidden: !hiddenIds.has(id) })}
          onDelete={deleteCategory}
          onClose={() => setManagingCategories(false)}
        />
      )}
    </div>
  );
}
