import { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import { splitIntoCards } from "./split";
import { bundledCategories, bundledDecksNotIn, fetchNewLibraryDecks } from "./library";
import {
  loadCustomCategories,
  loadDecks,
  loadKnownLibrary,
  loadSaved,
  newId,
  readPref,
  saveCustomCategories,
  saveDecks,
  saveKnownLibrary,
  saveSaved,
  writePref,
  type Card,
  type Category,
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

function textSize(text: string) {
  const n = text.length;
  if (n < 90) return 30;
  if (n < 180) return 25;
  if (n < 300) return 21;
  return 18;
}

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });

// Scrolls each chip strip sideways so its selected chip is visible
function centerActiveChips() {
  document.querySelectorAll<HTMLElement>(".chips .chip.on").forEach((chip) => {
    const strip = chip.parentElement!;
    strip.scrollLeft = chip.offsetLeft - (strip.clientWidth - chip.clientWidth) / 2;
  });
}

const categoryLabel = (c: Category) => (c.emoji ? `${c.emoji} ${c.name}` : c.name);

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
                <p className="card-text" style={{ fontSize: textSize(card.text) }}>
                  {card.text}
                </p>
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

function CategorySelect({
  value,
  categories,
  onChange,
  className = "field",
}: {
  value: string;
  categories: Category[];
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Kategorisiz</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {categoryLabel(c)}
        </option>
      ))}
    </select>
  );
}

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
      <CategorySelect value={categoryId} categories={categories} onChange={setCategoryId} />
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
      <button className="btn ghost" onClick={() => fileRef.current?.click()}>
        PDF veya TXT dosyası seç
      </button>
      {status && <p className="hint">{status}</p>}
      <button className="btn primary" disabled={cardCount === 0} onClick={submit}>
        {cardCount ? `${cardCount} karta böl ve kaydır` : "Kartlara böl ve kaydır"}
      </button>
    </div>
  );
}

// ─── Library ─────────────────────────────────────────────────────────────────

function Library({
  decks,
  categories,
  syncStatus,
  onSync,
  onOpen,
  onDelete,
  onMove,
  onAddCategory,
  onDeleteCategory,
}: {
  decks: Deck[];
  categories: Category[];
  syncStatus: string;
  onSync: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (deckId: string, categoryId: string) => void;
  onAddCategory: (name: string) => void;
  onDeleteCategory: (id: string) => void;
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

  const visible = decks
    .filter((d) => filter === null || (d.categoryId ?? "") === filter)
    .sort((a, b) => b.createdAt - a.createdAt);
  const activeCategory = categories.find((c) => c.id === filter);

  return (
    <div className="screen page">
      <div className="page-head">
        <h1>Kütüphane</h1>
        <button className="sync" onClick={onSync}>
          <Icon d={REFRESH} /> {syncStatus}
        </button>
      </div>

      <div className="chips strip">
        <button className={`chip ${filter === null ? "on" : ""}`} onClick={() => setFilter(null)}>
          Tümü · {decks.length}
        </button>
        <button
          className="chip add"
          onClick={() => {
            const name = window.prompt("Yeni kategori adı")?.trim();
            if (name) onAddCategory(name);
          }}
        >
          <Icon d={PLUS} /> Kategori
        </button>
        {categories.map((c) => (
          <button key={c.id} className={`chip ${filter === c.id ? "on" : ""}`} onClick={() => setFilter(c.id)}>
            {categoryLabel(c)} · {counts.get(c.id) ?? 0}
          </button>
        ))}
        {(counts.get("") ?? 0) > 0 && (
          <button className={`chip ${filter === "" ? "on" : ""}`} onClick={() => setFilter("")}>
            Kategorisiz · {counts.get("")}
          </button>
        )}
      </div>

      {activeCategory?.custom && (
        <button
          className="link-danger"
          onClick={() => {
            if (window.confirm(`"${activeCategory.name}" kategorisi silinsin mi? İçindeki notlar silinmez, kategorisiz kalır.`)) {
              onDeleteCategory(activeCategory.id);
              setFilter(null);
            }
          }}
        >
          Bu kategoriyi sil
        </button>
      )}

      {visible.length === 0 && <p className="hint">Burada henüz not yok. Ekle sekmesinden not ekleyebilirsin.</p>}
      <ul className="list">
        {visible.map((deck) => (
          <li key={deck.id} className="row" style={{ borderLeftColor: `hsl(${hueFor(deck.categoryId ?? deck.id)} 60% 55%)` }}>
            <div className="row-main">
              <button className="row-open" onClick={() => onOpen(deck.id)}>
                <span className="row-title">{deck.title}</span>
                <span className="row-meta">
                  {deck.cards.length} kart · {deck.fromLibrary ? "Okuma" : "Notum"} · {formatDate(deck.createdAt)}
                </span>
              </button>
              <CategorySelect
                className="row-select"
                value={deck.categoryId ?? ""}
                categories={categories}
                onChange={(id) => onMove(deck.id, id)}
              />
            </div>
            <button
              className="icon-btn"
              aria-label="Sil"
              onClick={() => {
                if (window.confirm(`"${deck.title}" silinsin mi?`)) onDelete(deck.id);
              }}
            >
              <Icon d={TRASH} />
            </button>
          </li>
        ))}
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
  const [libraryCategories, setLibraryCategories] = useState<Category[]>(() =>
    readPref<Category[]>("libraryCategories", bundledCategories)
  );
  const [source, setSource] = useState<FeedSource>(() => readPref<FeedSource>("source", { kind: "mix" }));
  const [seed, setSeed] = useState(() => readPref<number>("seed", Date.now() % 100000));
  const [syncStatus, setSyncStatus] = useState("Yeni içerik");

  // Latest decks for async sync callbacks
  const decksRef = useRef<Deck[]>([]);
  decksRef.current = decks ?? [];

  async function syncLibrary(known: Set<string>) {
    setSyncStatus("Kontrol ediliyor…");
    try {
      const { categories, decks: incoming } = await fetchNewLibraryDecks(known);
      setLibraryCategories(categories);
      writePref("libraryCategories", categories);
      if (incoming.length > 0) {
        incoming.forEach((d) => known.add(d.id));
        void saveKnownLibrary(known);
        updateDecks([...decksRef.current, ...incoming]);
      }
      setSyncStatus(incoming.length ? `${incoming.length} yeni okuma` : "Güncel");
    } catch {
      setSyncStatus("Çevrimdışı");
    }
  }

  useEffect(() => {
    void Promise.all([loadDecks(), loadSaved(), loadCustomCategories(), loadKnownLibrary()]).then(([d, s, c, known]) => {
      // First launch (or app update): add the reading decks bundled with the app
      const bundled = bundledDecksNotIn(known);
      bundled.forEach((deck) => known.add(deck.id));
      const all = [...d, ...bundled];
      if (bundled.length) {
        void saveDecks(all);
        void saveKnownLibrary(known);
      }
      decksRef.current = all;
      setDecks(all);
      setSaved(s);
      setCustomCategories(c);
      void syncLibrary(known);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => writePref("source", source), [source]);
  useEffect(() => writePref("seed", seed), [seed]);

  // Android back button: leave sub-screens first, then exit
  const tabRef = useRef(tab);
  tabRef.current = tab;
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handle = NativeApp.addListener("backButton", () => {
      if (tabRef.current !== "feed") setTab("feed");
      else void NativeApp.exitApp();
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }, []);

  const allDecks = useMemo(() => decks ?? [], [decks]);
  const categories = useMemo(() => [...libraryCategories, ...customCategories], [libraryCategories, customCategories]);
  const activeDeck = source.kind === "deck" ? allDecks.find((d) => d.id === source.id) : undefined;
  const activeCategory = source.kind === "category" ? categories.find((c) => c.id === source.id) : undefined;
  const feedCategories = categories.filter((c) => allDecks.some((d) => d.categoryId === c.id));

  const feedItems = useMemo<FeedItem[]>(() => {
    if (activeDeck) return deckItems([activeDeck]);
    const pool = activeCategory ? allDecks.filter((d) => d.categoryId === activeCategory.id) : allDecks;
    return deckItems(shuffled(pool, seed));
  }, [allDecks, activeDeck, activeCategory, seed]);

  const savedItems = useMemo<FeedItem[]>(
    () => allDecks.flatMap((deck) => deck.cards.filter((c) => saved.has(c.id)).map((card) => ({ card, deck }))),
    [allDecks, saved]
  );

  function updateDecks(next: Deck[]) {
    decksRef.current = next;
    setDecks(next);
    void saveDecks(next);
  }

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

  function moveDeck(deckId: string, categoryId: string) {
    updateDecks(allDecks.map((d) => (d.id === deckId ? { ...d, categoryId: categoryId || undefined } : d)));
  }

  function addCategory(name: string) {
    const next = [...customCategories, { id: `custom-${newId()}`, name, custom: true }];
    setCustomCategories(next);
    void saveCustomCategories(next);
  }

  function deleteCategory(id: string) {
    const next = customCategories.filter((c) => c.id !== id);
    setCustomCategories(next);
    void saveCustomCategories(next);
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

  useEffect(() => centerActiveChips(), [tab, source]);

  if (decks === null) return <div className="app" />;

  const feedKey = activeDeck ? `deck:${activeDeck.id}` : activeCategory ? `cat:${activeCategory.id}` : "mix";

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
            onSync={() => void loadKnownLibrary().then(syncLibrary)}
            onOpen={(id) => {
              setSource({ kind: "deck", id });
              setTab("feed");
            }}
            onDelete={deleteDeck}
            onMove={moveDeck}
            onAddCategory={addCategory}
            onDeleteCategory={deleteCategory}
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
    </div>
  );
}
