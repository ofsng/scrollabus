import { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import { splitIntoCards } from "./split";
import { bundledCategories, bundledLibraryDecks, fetchLibraryUpdates, mergeLibrary } from "./library";
import {
  loadCategoryPrefs,
  loadCustomCategories,
  loadDecks,
  loadKnownLibrary,
  loadSaved,
  newId,
  readPref,
  saveCategoryPrefs,
  saveCustomCategories,
  saveDecks,
  saveKnownLibrary,
  saveSaved,
  writePref,
  type Card,
  type Category,
  type CategoryPrefs,
  type Deck,
} from "./store";

type Tab = "feed" | "add" | "library" | "saved";
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

function textSize(card: Card) {
  const n = card.text.length + (card.action ? 120 : 0);
  if (n < 90) return 30;
  if (n < 180) return 25;
  if (n < 300) return 21;
  if (n < 450) return 19;
  return 17;
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
  header,
  empty,
}: {
  items: FeedItem[];
  positionKey: string;
  saved: Set<string>;
  onToggleSave: (cardId: string) => void;
  header?: React.ReactNode;
  empty: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [burst, setBurst] = useState<string | null>(null);

  // Restore where you left off in this feed
  useEffect(() => {
    const el = ref.current;
    if (!el || items.length === 0) return;
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
            writePref(positionKey, i);
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
          return (
            <article
              key={card.id}
              data-index={i}
              className="card"
              style={{ background: `linear-gradient(160deg, hsl(${hue} 42% 20%), hsl(${(hue + 40) % 360} 48% 9%))` }}
              onDoubleClick={() => {
                if (!isSaved) onToggleSave(card.id);
                setBurst(card.id);
                setTimeout(() => setBurst(null), 700);
              }}
            >
              <div className="card-body">
                <div className="card-deck">{deck.title}</div>
                {card.title && card.title.toLocaleLowerCase("tr") !== deck.title.toLocaleLowerCase("tr") && (
                  <h2 className="card-title">{card.title}</h2>
                )}
                <p className="card-text" style={{ fontSize: textSize(card) }}>
                  {card.text}
                </p>
                {card.action && (
                  <div className="card-action">
                    <span className="card-action-label">Bugün dene</span>
                    {card.action}
                  </div>
                )}
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
      <div className="counter">
        {index + 1} / {items.length}
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
  onUpdate,
  onToggleHidden,
  onDelete,
}: {
  category: Category;
  count: number;
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
          {count} not{category.hidden ? " · akışta gizli" : ""}
        </small>
      </span>
      <button className="icon-btn" aria-label={category.hidden ? "Akışta göster" : "Akışta gizle"} onClick={onToggleHidden}>
        <Icon d={category.hidden ? EYE_OFF : EYE} />
      </button>
      <button className="icon-btn" aria-label="Düzenle" onClick={() => setEditing(true)}>
        <Icon d={EDIT} />
      </button>
    </li>
  );
}

function CategoryManager({
  categories,
  counts,
  onAdd,
  onUpdate,
  onToggleHidden,
  onDelete,
  onClose,
}: {
  categories: Category[];
  counts: Map<string, number>;
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
            onUpdate={(n, e) => onUpdate(c.id, n, e)}
            onToggleHidden={() => onToggleHidden(c.id)}
            onDelete={() => onDelete(c.id)}
          />
        ))}
      </ul>
    </Sheet>
  );
}

// ─── Library ─────────────────────────────────────────────────────────────────

function Library({
  decks,
  categories,
  syncStatus,
  onSync,
  onOpen,
  onOptions,
  onManageCategories,
}: {
  decks: Deck[];
  categories: Category[];
  syncStatus: string;
  onSync: () => void;
  onOpen: (id: string) => void;
  onOptions: (id: string) => void;
  onManageCategories: () => void;
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

  const visible = decks
    .filter((d) => filter === null || (d.categoryId ?? "") === filter)
    .sort((a, b) => b.createdAt - a.createdAt);

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
          return (
            <li key={deck.id} className="row" style={{ borderLeftColor: `hsl(${hueFor(deck.categoryId ?? deck.id)} 60% 55%)` }}>
              <button className="row-main" onClick={() => onOpen(deck.id)}>
                <span className="row-title">{deck.title}</span>
                <span className="row-meta">
                  {cat ? categoryLabel(cat) : "Kategorisiz"} · {deck.cards.length} kart
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

  // Latest values for async sync callbacks
  const decksRef = useRef<Deck[]>([]);
  decksRef.current = decks ?? [];
  const knownRef = useRef<Set<string>>(new Set());

  function updateDecks(next: Deck[]) {
    decksRef.current = next;
    setDecks(next);
    void saveDecks(next);
  }

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
      setSyncStatus(added ? `${added} yeni okuma eklendi` : updated ? `${updated} okuma güncellendi` : "İçerikler güncel");
    } catch {
      setSyncStatus("Çevrimdışı · yeni içerik için internete bağlan");
    }
  }

  useEffect(() => {
    void Promise.all([loadDecks(), loadSaved(), loadCustomCategories(), loadKnownLibrary(), loadCategoryPrefs()]).then(
      ([stored, s, custom, known, prefs]) => {
        // Add (or refresh) the reading decks bundled with this app version
        const { decks: merged, added, updated } = mergeLibrary(stored, bundledLibraryDecks(), known);
        knownRef.current = known;
        if (added || updated) {
          void saveDecks(merged);
          void saveKnownLibrary(known);
        }
        decksRef.current = merged;
        setDecks(merged);
        setSaved(s);
        setCustomCategories(custom);
        setCategoryPrefs(prefs);
        void syncLibrary();
      }
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => writePref("source", source), [source]);
  useEffect(() => writePref("seed", seed), [seed]);

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

  const feedItems = useMemo<FeedItem[]>(() => {
    if (activeDeck) return deckItems([activeDeck]);
    const pool = activeCategory
      ? allDecks.filter((d) => d.categoryId === activeCategory.id)
      : allDecks.filter((d) => !d.categoryId || !hiddenIds.has(d.categoryId));
    return deckItems(shuffled(pool, seed));
  }, [allDecks, activeDeck, activeCategory, hiddenIds, seed]);

  const savedItems = useMemo<FeedItem[]>(
    () => allDecks.flatMap((deck) => deck.cards.filter((c) => saved.has(c.id)).map((card) => ({ card, deck }))),
    [allDecks, saved]
  );

  useEffect(() => centerActiveChips(), [tab, source]);

  function toggleSave(cardId: string) {
    const next = new Set(saved);
    if (next.has(cardId)) next.delete(cardId);
    else next.add(cardId);
    setSaved(next);
    void saveSaved(next);
  }

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
    setSource({ kind: "deck", id: deck.id });
    setTab("feed");
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
    writePref("pos:mix", 0);
    categories.forEach((c) => writePref(`pos:cat:${c.id}`, 0));
  }

  const chips = (
    <div className="topbar">
      <div className="chips">
        <button
          className={`chip ${source.kind === "mix" ? "on" : ""}`}
          onClick={() => {
            // Tapping "Karışık" again reshuffles from the top
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
    </div>
  );

  if (decks === null) return <div className="app" />;

  const feedKey = activeDeck ? `deck:${activeDeck.id}` : activeCategory ? `cat:${activeCategory.id}` : "mix";
  const optionsDeck = deckOptions ? allDecks.find((d) => d.id === deckOptions) : undefined;

  return (
    <div className="app">
      <main className="main">
        {tab === "feed" && (
          <Feed
            key={`${feedKey}:${seed}`}
            items={feedItems}
            positionKey={`pos:${feedKey}`}
            saved={saved}
            onToggleSave={toggleSave}
            header={allDecks.length > 0 ? chips : undefined}
            empty={
              <>
                <h2>Kaydıracak bir şey yok</h2>
                <p>Notlarını ekle, kart kart kaydır.</p>
                <button className="btn primary" onClick={() => setTab("add")}>
                  Not ekle
                </button>
              </>
            }
          />
        )}
        {tab === "saved" && (
          <Feed
            key="saved"
            items={savedItems}
            positionKey="pos:saved"
            saved={saved}
            onToggleSave={toggleSave}
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
            syncStatus={syncStatus}
            onSync={() => void syncLibrary()}
            onOpen={(id) => {
              setSource({ kind: "deck", id });
              setTab("feed");
            }}
            onOptions={setDeckOptions}
            onManageCategories={() => setManagingCategories(true)}
          />
        )}
      </main>

      <nav className="nav">
        {(
          [
            ["feed", HOME, "Akış"],
            ["add", PLUS, "Ekle"],
            ["library", BOOKS, "Kütüphane"],
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
      {managingCategories && (
        <CategoryManager
          categories={categories}
          counts={categoryCounts}
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
