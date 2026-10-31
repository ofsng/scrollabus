import { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import { splitIntoCards } from "./split";
import { loadDecks, loadSaved, newId, readPref, saveDecks, saveSaved, writePref, type Card, type Deck } from "./store";

type Tab = "feed" | "add" | "library" | "saved";
type FeedSource = { kind: "mix" } | { kind: "deck"; id: string };

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

function textSize(text: string) {
  const n = text.length;
  if (n < 90) return 30;
  if (n < 180) return 25;
  if (n < 300) return 21;
  return 18;
}

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });

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
          const hue = hueFor(deck.id);
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

function AddScreen({ onCreate }: { onCreate: (title: string, text: string) => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
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
    const fallback = text.trim().split("\n")[0].slice(0, 40) || "Not";
    onCreate(title.trim() || fallback, text);
    setTitle("");
    setText("");
  }

  return (
    <div className="screen page">
      <h1>Not ekle</h1>
      <input className="field" placeholder="Başlık (isteğe bağlı)" value={title} onChange={(e) => setTitle(e.target.value)} />
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

function Library({ decks, onOpen, onDelete }: { decks: Deck[]; onOpen: (id: string) => void; onDelete: (id: string) => void }) {
  return (
    <div className="screen page">
      <h1>Kütüphane</h1>
      {decks.length === 0 && <p className="hint">Henüz not yok. Ekle sekmesinden başla.</p>}
      <ul className="list">
        {decks.map((deck) => (
          <li key={deck.id} className="row" style={{ borderLeftColor: `hsl(${hueFor(deck.id)} 60% 55%)` }}>
            <button className="row-main" onClick={() => onOpen(deck.id)}>
              <span className="row-title">{deck.title}</span>
              <span className="row-meta">
                {deck.cards.length} kart · {formatDate(deck.createdAt)}
              </span>
            </button>
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
  const [source, setSource] = useState<FeedSource>(() => readPref<FeedSource>("source", { kind: "mix" }));
  const [seed, setSeed] = useState(() => readPref<number>("seed", Date.now() % 100000));

  useEffect(() => {
    void Promise.all([loadDecks(), loadSaved()]).then(([d, s]) => {
      setDecks(d);
      setSaved(s);
    });
  }, []);

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

  const allDecks = decks ?? [];
  const activeDeck = source.kind === "deck" ? allDecks.find((d) => d.id === source.id) : undefined;

  const feedItems = useMemo<FeedItem[]>(() => {
    if (activeDeck) return activeDeck.cards.map((card) => ({ card, deck: activeDeck }));
    return shuffled(
      allDecks.flatMap((deck) => deck.cards.map((card) => ({ card, deck }))),
      seed
    );
  }, [allDecks, activeDeck, seed]);

  const savedItems = useMemo<FeedItem[]>(
    () => allDecks.flatMap((deck) => deck.cards.filter((c) => saved.has(c.id)).map((card) => ({ card, deck }))),
    [allDecks, saved]
  );

  function updateDecks(next: Deck[]) {
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

  function createDeck(title: string, text: string) {
    const deck: Deck = {
      id: newId(),
      title,
      createdAt: Date.now(),
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

  const chips = (
    <div className="topbar">
      <div className="chips">
        <button
          className={`chip ${source.kind === "mix" ? "on" : ""}`}
          onClick={() => {
            if (source.kind === "mix") {
              // Tapping "Karışık" again reshuffles from the top
              setSeed(Math.floor(Math.random() * 100000) + 1);
              writePref("pos:mix", 0);
            }
            setSource({ kind: "mix" });
          }}
        >
          <Icon d={SHUFFLE} /> Karışık
        </button>
        {allDecks.map((deck) => (
          <button
            key={deck.id}
            className={`chip ${activeDeck?.id === deck.id ? "on" : ""}`}
            onClick={() => setSource({ kind: "deck", id: deck.id })}
          >
            {deck.title}
          </button>
        ))}
      </div>
    </div>
  );

  if (decks === null) return <div className="app" />;

  return (
    <div className="app">
      <main className="main">
        {tab === "feed" && (
          <Feed
            key={`${activeDeck ? activeDeck.id : "mix"}:${seed}`}
            items={feedItems}
            positionKey={activeDeck ? `pos:deck:${activeDeck.id}` : "pos:mix"}
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
        {tab === "add" && <AddScreen onCreate={createDeck} />}
        {tab === "library" && (
          <Library
            decks={allDecks}
            onOpen={(id) => {
              setSource({ kind: "deck", id });
              setTab("feed");
            }}
            onDelete={deleteDeck}
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
