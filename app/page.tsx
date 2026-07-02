"use client";

import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  KeyRound,
  LogOut,
  Menu,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Entry = {
  id: string;
  title: string;
  body: string;
  entry_date: string;
  created_at: string;
  updated_at: string;
};

type PersistedEditorState = {
  entries: Entry[];
  selectedId: string | null;
};

function getJstDateString(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Failed to format JST date");
  }

  return `${year}-${month}-${day}`;
}

const demoEntries: Entry[] = [
  {
    id: "demo-1",
    title: "静かな朝",
    body: "いつもより少し早く起きた。窓を開けると、雨上がりの匂いがした。\n\nコーヒーを淹れて、読みかけの本を数ページ。こういう余白を大切にしたい。",
    entry_date: getJstDateString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "demo-2",
    title: "小さな発見",
    body: "帰り道、路地裏に新しい花屋を見つけた。淡い色の花がきれいだった。",
    entry_date: getJstDateString(new Date(Date.now() - 86400000 * 2)),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const isConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

const DRAFT_STORAGE_PREFIX = "hibi-no-yohaku-editor";

function formatDate(date: string, withYear = true) {
  return new Intl.DateTimeFormat("ja-JP", {
    ...(withYear ? { year: "numeric" } : {}),
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T12:00:00`));
}

function getStorageKey(userId: string | null) {
  return `${DRAFT_STORAGE_PREFIX}:${userId ?? "demo"}`;
}

function compareEntries(a: Entry, b: Entry) {
  if (a.entry_date !== b.entry_date) {
    return b.entry_date.localeCompare(a.entry_date);
  }

  return b.created_at.localeCompare(a.created_at);
}

function getMonthKey(date: string) {
  return date.slice(0, 7);
}

function shiftMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + delta, 1, 12));
  const nextYear = shifted.getUTCFullYear();
  const nextMonth = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  return `${nextYear}-${nextMonth}`;
}

function formatMonthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1, 12)));
}

function buildCalendarDays(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const firstDay = new Date(Date.UTC(year, monthNumber - 1, 1, 12));
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0, 12)).getUTCDate();
  const leadingBlankDays = firstDay.getUTCDay();
  const cells: Array<string | null> = Array.from({ length: leadingBlankDays }, () => null);

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${month}-${String(day).padStart(2, "0")}`);
  }

  return cells;
}

function readPersistedState(userId: string | null): PersistedEditorState | null {
  if (typeof window === "undefined") return null;

  const raw = window.sessionStorage.getItem(getStorageKey(userId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PersistedEditorState;
    if (!Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function mergeEntriesWithPersistedState(
  serverEntries: Entry[],
  persisted: PersistedEditorState | null,
) {
  if (!persisted) {
    return { entries: serverEntries, selectedId: serverEntries[0]?.id ?? null };
  }

  const persistedById = new Map(persisted.entries.map((entry) => [entry.id, entry]));
  const mergedEntries = serverEntries.map((entry) => persistedById.get(entry.id) ?? entry);
  const draftEntries = persisted.entries.filter((entry) => entry.id.startsWith("draft-"));
  const entries = [...draftEntries, ...mergedEntries];
  const fallbackSelectedId = entries[0]?.id ?? null;
  const selectedId = entries.some((entry) => entry.id === persisted.selectedId)
    ? persisted.selectedId
    : fallbackSelectedId;

  return { entries, selectedId };
}

export default function Home() {
  const supabase = useMemo(() => (isConfigured ? createClient() : null), []);
  const [entries, setEntries] = useState<Entry[]>(() => {
    if (isConfigured) return [];

    return readPersistedState("demo")?.entries ?? demoEntries;
  });
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (isConfigured) return null;

    const persisted = readPersistedState("demo");
    if (!persisted) return demoEntries[0].id;

    return persisted.entries.some((entry) => entry.id === persisted.selectedId)
      ? persisted.selectedId
      : persisted.entries[0]?.id ?? null;
  });
  const [query, setQuery] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(isConfigured ? null : "demo");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [loading, setLoading] = useState(isConfigured);
  const [saving, setSaving] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(getMonthKey(getJstDateString()));
  const calendarRef = useRef<HTMLDivElement | null>(null);

  const selected = entries.find((entry) => entry.id === selectedId) ?? null;

  const loadEntries = useCallback(async (currentUserId: string | null) => {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("diary_entries")
      .select("*")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (!error && data) {
      const persisted = readPersistedState(currentUserId);
      const merged = mergeEntriesWithPersistedState(data, persisted);
      setEntries(merged.entries);
      setSelectedId(merged.selectedId);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null);
      setUserId(data.user?.id ?? null);
      if (data.user) loadEntries(data.user.id);
      else setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user.email ?? null);
      setUserId(session?.user.id ?? null);
      if (session?.user) loadEntries(session.user.id);
      else {
        setEntries([]);
        setSelectedId(null);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, [loadEntries, supabase]);

  useEffect(() => {
    if ((isConfigured && !userId) || loading) return;

    const payload: PersistedEditorState = {
      entries,
      selectedId,
    };

    window.sessionStorage.setItem(getStorageKey(userId), JSON.stringify(payload));
  }, [entries, loading, selectedId, userId]);

  const visibleEntries = entries.filter((entry) => {
    const needle = query.trim().toLocaleLowerCase("ja");
    return (
      !needle ||
      entry.title.toLocaleLowerCase("ja").includes(needle) ||
      entry.body.toLocaleLowerCase("ja").includes(needle)
    );
  });
  const navigableEntries = visibleEntries.some((entry) => entry.id === selectedId)
    ? [...visibleEntries].sort(compareEntries)
    : [...entries].sort(compareEntries);
  const selectedIndex = navigableEntries.findIndex((entry) => entry.id === selectedId);
  const previousEntry = selectedIndex >= 0 ? navigableEntries[selectedIndex + 1] ?? null : null;
  const nextEntry = selectedIndex > 0 ? navigableEntries[selectedIndex - 1] : null;
  const entriesByDate = useMemo(() => {
    const sorted = [...entries].sort(compareEntries);
    return new Map(sorted.map((entry) => [entry.entry_date, entry]));
  }, [entries]);
  const calendarDays = useMemo(() => buildCalendarDays(calendarMonth), [calendarMonth]);

  useEffect(() => {
    if (!calendarOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!calendarRef.current) return;
      if (calendarRef.current.contains(event.target as Node)) return;
      setCalendarOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [calendarOpen]);

  async function handleEmailAuth(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !authEmail || !authPassword) return;
    setAuthSubmitting(true);
    setAuthMessage("送信中…");
    if (authMode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: authPassword,
      });
      setAuthMessage(error ? `ログインできませんでした: ${error.message}` : "");
      setAuthSubmitting(false);
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email: authEmail,
      password: authPassword,
      options: { emailRedirectTo: window.location.origin },
    });

    if (error) {
      setAuthMessage(`登録できませんでした: ${error.message}`);
    } else if (data.session) {
      setAuthMessage("");
    } else {
      setAuthMessage("確認メールを送りました。メール内のリンクを開くと登録が完了します。");
    }
    setAuthSubmitting(false);
  }

  async function signInWithGoogle() {
    if (!supabase) return;
    setAuthSubmitting(true);
    setAuthMessage("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setAuthMessage(`Google ログインを開始できませんでした: ${error.message}`);
      setAuthSubmitting(false);
    }
  }

  function createEntry() {
    const now = new Date();
    const draft: Entry = {
      id: `draft-${crypto.randomUUID()}`,
      title: "",
      body: "",
      entry_date: getJstDateString(now),
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
    setEntries((current) => [draft, ...current]);
    setSelectedId(draft.id);
    setSidebarOpen(false);
  }

  function updateSelected(patch: Partial<Entry>) {
    if (!selectedId) return;
    setEntries((current) =>
      current.map((entry) =>
        entry.id === selectedId
          ? {
              ...entry,
              ...patch,
              updated_at: new Date().toISOString(),
            }
          : entry,
      ),
    );
  }

  async function saveEntry() {
    if (!selected || (!selected.title.trim() && !selected.body.trim())) return;
    if (!supabase) {
      setSaving(true);
      window.setTimeout(() => setSaving(false), 500);
      return;
    }
    setSaving(true);
    const isDraft = selected.id.startsWith("draft-");
    const payload = {
      title: selected.title.trim(),
      body: selected.body,
      entry_date: selected.entry_date,
    };
    const result = isDraft
      ? await supabase.from("diary_entries").insert(payload).select().single()
      : await supabase
          .from("diary_entries")
          .update(payload)
          .eq("id", selected.id)
          .select()
          .single();
    if (!result.error && result.data) {
      setEntries((current) =>
        current.map((entry) => (entry.id === selected.id ? result.data : entry)),
      );
      setSelectedId(result.data.id);
    }
    setSaving(false);
  }

  async function deleteEntry() {
    if (!selected || !window.confirm("この日記を削除しますか？")) return;
    if (supabase && !selected.id.startsWith("draft-")) {
      await supabase.from("diary_entries").delete().eq("id", selected.id);
    }
    const next = entries.filter((entry) => entry.id !== selected.id);
    setEntries(next);
    setSelectedId(next[0]?.id ?? null);
  }

  function selectPreviousEntry() {
    if (!previousEntry) return;
    setSelectedId(previousEntry.id);
  }

  function selectNextEntry() {
    if (!nextEntry) return;
    setSelectedId(nextEntry.id);
  }

  function toggleCalendar() {
    if (!calendarOpen && selected) {
      setCalendarMonth(getMonthKey(selected.entry_date));
    }
    setCalendarOpen((current) => !current);
  }

  function selectEntryByDate(date: string) {
    const entry = entriesByDate.get(date);
    if (!entry) return;
    setSelectedId(entry.id);
    setCalendarOpen(false);
  }

  function jumpToToday() {
    const today = getJstDateString();
    setCalendarMonth(getMonthKey(today));
    const todayEntry = entriesByDate.get(today);
    if (todayEntry) {
      setSelectedId(todayEntry.id);
      setCalendarOpen(false);
    }
  }

  if (isConfigured && !userEmail && !loading) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="brand-mark"><BookOpen size={22} /></div>
          <p className="eyebrow">YOUR PRIVATE SPACE</p>
          <h1>日々の余白</h1>
          <p className="auth-copy">言葉にすると、一日はもう少し大切になる。</p>
          <div className="auth-tabs" role="tablist" aria-label="認証モード">
            <button
              className={`auth-tab ${authMode === "signin" ? "active" : ""}`}
              type="button"
              onClick={() => {
                setAuthMode("signin");
                setAuthMessage("");
              }}
            >
              ログイン
            </button>
            <button
              className={`auth-tab ${authMode === "signup" ? "active" : ""}`}
              type="button"
              onClick={() => {
                setAuthMode("signup");
                setAuthMessage("");
              }}
            >
              新規登録
            </button>
          </div>
          <form onSubmit={handleEmailAuth}>
            <label htmlFor="email">メールアドレス</label>
            <input
              id="email"
              type="email"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
            <label htmlFor="password">パスワード</label>
            <div className="password-field">
              <KeyRound size={16} />
              <input
                id="password"
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="8文字以上のパスワード"
                minLength={8}
                required
              />
            </div>
            <button className="primary-button" type="submit" disabled={authSubmitting}>
              {authSubmitting
                ? "送信中…"
                : authMode === "signin"
                  ? "メールアドレスでログイン"
                  : "新規登録する"}
            </button>
          </form>
          <div className="auth-divider"><span>または</span></div>
          <button className="oauth-button" type="button" onClick={signInWithGoogle}>
            <span>Google アカウントで続ける</span>
            <ArrowRight size={16} />
          </button>
          {authMessage && <p className="auth-message">{authMessage}</p>}
          <p className="fine-print">
            {authMode === "signin"
              ? "メールアドレスとパスワードでログインできます。Google ログインにも対応しています。"
              : "新規登録後、Supabase の設定によっては確認メールの承認が必要です。"}
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <button className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="メニュー">
        <Menu size={20} />
      </button>
      {sidebarOpen && <button className="scrim" onClick={() => setSidebarOpen(false)} aria-label="閉じる" />}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <div className="brand">
            <div className="brand-mark small"><BookOpen size={17} /></div>
            <div><strong>日々の余白</strong><span>MY JOURNAL</span></div>
          </div>
          <button className="close-mobile" onClick={() => setSidebarOpen(false)}><X size={20} /></button>
        </div>
        <button className="new-entry" onClick={createEntry}><Plus size={17} /> 新しい日記を書く</button>
        <div className="search-box">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="日記を検索…"
            aria-label="日記を検索"
          />
          {query && <button onClick={() => setQuery("")}><X size={14} /></button>}
        </div>
        <div className="entry-count">{query ? `「${query}」の検索結果` : "最近の日記"} <span>{visibleEntries.length}</span></div>
        <nav className="entry-list">
          {visibleEntries.map((entry) => (
            <button
              key={entry.id}
              className={`entry-item ${selectedId === entry.id ? "active" : ""}`}
              onClick={() => { setSelectedId(entry.id); setSidebarOpen(false); }}
            >
              <time>{formatDate(entry.entry_date, false)}</time>
              {entry.title.trim() ? <strong>{entry.title}</strong> : null}
              <p>{entry.body || ""}</p>
            </button>
          ))}
          {!visibleEntries.length && <p className="empty-search">見つかりませんでした。<br />別の言葉で探してみてください。</p>}
        </nav>
        <div className="sidebar-footer">
          <div><Cloud size={15} /><span>{isConfigured ? "クラウドに同期済み" : "デモモード"}</span></div>
          {userEmail && (
            <button onClick={() => supabase?.auth.signOut()} title="ログアウト"><LogOut size={16} /></button>
          )}
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="date-navigation">
            <button aria-label="前の日" onClick={selectPreviousEntry} disabled={!previousEntry}>
              <ChevronLeft size={18} />
            </button>
            <div className="calendar-trigger-wrap" ref={calendarRef}>
              <button
                type="button"
                className={`calendar-trigger ${calendarOpen ? "active" : ""}`}
                aria-label="カレンダーを開く"
                aria-expanded={calendarOpen}
                onClick={toggleCalendar}
              >
                <CalendarDays size={16} />
              </button>
              {calendarOpen && (
                <div className="calendar-popover">
                  <div className="calendar-popover-header">
                    <button
                      type="button"
                      aria-label="前の月"
                      onClick={() => setCalendarMonth((current) => shiftMonth(current, -1))}
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <strong>{formatMonthLabel(calendarMonth)}</strong>
                    <button
                      type="button"
                      aria-label="次の月"
                      onClick={() => setCalendarMonth((current) => shiftMonth(current, 1))}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <div className="calendar-actions">
                    <button type="button" className="calendar-today" onClick={jumpToToday}>
                      今日
                    </button>
                  </div>
                  <div className="calendar-weekdays">
                    {["日", "月", "火", "水", "木", "金", "土"].map((weekday) => (
                      <span key={weekday}>{weekday}</span>
                    ))}
                  </div>
                  <div className="calendar-grid">
                    {calendarDays.map((date, index) => {
                      if (!date) {
                        return <span key={`blank-${index}`} className="calendar-day blank" />;
                      }

                      const hasEntry = entriesByDate.has(date);
                      const isSelected = selected?.entry_date === date;

                      return (
                        <button
                          key={date}
                          type="button"
                          className={`calendar-day${hasEntry ? " has-entry" : ""}${isSelected ? " selected" : ""}`}
                          disabled={!hasEntry}
                          onClick={() => selectEntryByDate(date)}
                        >
                          {Number(date.slice(-2))}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <span>{selected ? formatDate(selected.entry_date) : "日記"}</span>
            <button aria-label="次の日" onClick={selectNextEntry} disabled={!nextEntry}>
              <ChevronRight size={18} />
            </button>
          </div>
          {selected && (
            <div className="actions">
              <button className="delete-button" onClick={deleteEntry} aria-label="削除"><Trash2 size={17} /></button>
              <button className="save-button" onClick={saveEntry}>
                {saving ? <><Check size={16} /> 保存しました</> : "保存する"}
              </button>
            </div>
          )}
        </header>

        {selected ? (
          <article className="editor">
            <div className="editor-date">
              <input
                type="date"
                value={selected.entry_date}
                onChange={(e) => updateSelected({ entry_date: e.target.value })}
              />
            </div>
            <input
              className="title-input"
              value={selected.title}
              onChange={(e) => updateSelected({ title: e.target.value })}
              placeholder="タイトル"
              aria-label="タイトル"
            />
            <div className="rule" />
            <textarea
              className="body-input"
              value={selected.body}
              onChange={(e) => updateSelected({ body: e.target.value })}
              placeholder={"今日はどんな一日でしたか？\n\n心に残ったことを、自由に書いてみましょう。"}
              aria-label="本文"
            />
            <footer className="editor-footer">
              <span>{selected.body.length} 文字</span>
              <span>最終更新 {new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date(selected.updated_at))}</span>
            </footer>
          </article>
        ) : (
          <div className="empty-state">
            <div className="brand-mark"><BookOpen size={22} /></div>
            <h2>今日を残しておきましょう</h2>
            <p>何気ない一日も、あとから読み返すと大切な物語になります。</p>
            <button className="primary-button compact" onClick={createEntry}><Plus size={17} /> 日記を書く</button>
          </div>
        )}
      </section>
    </main>
  );
}
