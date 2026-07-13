"use client";

import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Download,
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

type PeriodPreset = "all" | "month" | "quarter" | "year" | "custom";

type EntryFilters = {
  query: string;
  startDate: string | null;
  endDate: string | null;
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

function getStableEntryTimestamp(date: string) {
  return `${date}T12:00:00.000+09:00`;
}

const demoEntryDate = getJstDateString();
const olderDemoEntryDate = getJstDateString(new Date(Date.now() - 86400000 * 2));

const demoEntries: Entry[] = [
  {
    id: "demo-1",
    title: "静かな朝",
    body: "いつもより少し早く起きた。窓を開けると、雨上がりの匂いがした。\n\nコーヒーを淹れて、読みかけの本を数ページ。こういう余白を大切にしたい。",
    entry_date: demoEntryDate,
    created_at: getStableEntryTimestamp(demoEntryDate),
    updated_at: getStableEntryTimestamp(demoEntryDate),
  },
  {
    id: "demo-2",
    title: "小さな発見",
    body: "帰り道、路地裏に新しい花屋を見つけた。淡い色の花がきれいだった。",
    entry_date: olderDemoEntryDate,
    created_at: getStableEntryTimestamp(olderDemoEntryDate),
    updated_at: getStableEntryTimestamp(olderDemoEntryDate),
  },
];

const isConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

const DRAFT_STORAGE_PREFIX = "hibi-no-yohaku-editor";
const GOOGLE_DRIVE_TOKEN_STORAGE_KEY = "hibi-google-drive-token";
const GOOGLE_DRIVE_REFRESH_TOKEN_STORAGE_KEY = "hibi-google-drive-refresh-token";
const GOOGLE_DRIVE_FILE_STORAGE_PREFIX = "hibi-google-drive-file";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const ENTRY_PAGE_SIZE = 30;

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

function getGoogleDriveFileStorageKey(userId: string) {
  return `${GOOGLE_DRIVE_FILE_STORAGE_PREFIX}:${userId}`;
}

function compareEntries(a: Entry, b: Entry) {
  if (a.entry_date !== b.entry_date) {
    return b.entry_date.localeCompare(a.entry_date);
  }

  return b.created_at.localeCompare(a.created_at);
}

function findEntryByDate(entries: Entry[], entryDate: string, excludeId?: string | null) {
  return (
    entries.find(
      (entry) => entry.entry_date === entryDate && entry.id !== excludeId && !entry.id.startsWith("draft-"),
    ) ?? null
  );
}

function shiftJstMonth(dateString: string, delta: number) {
  const [year, month, day] = dateString.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + delta, day, 12));
  return getJstDateString(shifted);
}

function getFilterRange(
  preset: PeriodPreset,
  customStartDate: string,
  customEndDate: string,
) {
  const today = getJstDateString();

  switch (preset) {
    case "month":
      return {
        startDate: `${today.slice(0, 7)}-01`,
        endDate: today,
      };
    case "quarter":
      return {
        startDate: shiftJstMonth(today, -3),
        endDate: today,
      };
    case "year":
      return {
        startDate: shiftJstMonth(today, -12),
        endDate: today,
      };
    case "custom":
      return {
        startDate: customStartDate || null,
        endDate: customEndDate || null,
      };
    default:
      return {
        startDate: null,
        endDate: null,
      };
  }
}

function normalizeSearchTerm(value: string) {
  return value.trim().replaceAll("%", "\\%").replaceAll("_", "\\_").replaceAll(",", " ");
}

function matchesLocalFilters(entry: Entry, filters: EntryFilters) {
  if (filters.startDate && entry.entry_date < filters.startDate) {
    return false;
  }

  if (filters.endDate && entry.entry_date > filters.endDate) {
    return false;
  }

  const needle = filters.query.trim().toLocaleLowerCase("ja");
  if (!needle) {
    return true;
  }

  return (
    entry.title.toLocaleLowerCase("ja").includes(needle) ||
    entry.body.toLocaleLowerCase("ja").includes(needle)
  );
}

function mergeVisibleEntries(params: {
  currentEntries: Entry[];
  incomingEntries: Entry[];
  persisted: PersistedEditorState | null;
  filters: EntryFilters;
  reset: boolean;
}) {
  const { currentEntries, incomingEntries, persisted, filters, reset } = params;
  const sourceEntries = reset ? (persisted?.entries ?? []) : currentEntries;
  const drafts = sourceEntries
    .filter((entry) => entry.id.startsWith("draft-"))
    .filter((entry) => matchesLocalFilters(entry, filters))
    .sort(compareEntries);
  const localById = new Map(sourceEntries.map((entry) => [entry.id, entry]));
  const mergedIncoming = incomingEntries.map((entry) => localById.get(entry.id) ?? entry);
  const existingServerEntries = reset
    ? []
    : currentEntries.filter((entry) => !entry.id.startsWith("draft-"));
  const serverEntries = reset
    ? mergedIncoming
    : [
        ...existingServerEntries,
        ...mergedIncoming.filter((entry) => !existingServerEntries.some((current) => current.id === entry.id)),
      ];

  return [...drafts, ...serverEntries];
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

function setStoredGoogleDriveToken(token: string | null) {
  if (typeof window === "undefined") return;

  if (!token) {
    window.localStorage.removeItem(GOOGLE_DRIVE_TOKEN_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(GOOGLE_DRIVE_TOKEN_STORAGE_KEY, token);
}

function getStoredGoogleDriveRefreshToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(GOOGLE_DRIVE_REFRESH_TOKEN_STORAGE_KEY);
}

function setStoredGoogleDriveRefreshToken(token: string | null) {
  if (typeof window === "undefined") return;

  if (!token) {
    window.localStorage.removeItem(GOOGLE_DRIVE_REFRESH_TOKEN_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(GOOGLE_DRIVE_REFRESH_TOKEN_STORAGE_KEY, token);
}

function setStoredGoogleDriveFileId(userId: string, fileId: string | null) {
  if (typeof window === "undefined") return;

  if (!fileId) {
    window.localStorage.removeItem(getGoogleDriveFileStorageKey(userId));
    return;
  }

  window.localStorage.setItem(getGoogleDriveFileStorageKey(userId), fileId);
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

export default function Home() {
  const supabase = useMemo(() => (isConfigured ? createClient() : null), []);
  const [entries, setEntries] = useState<Entry[]>(() => (isConfigured ? [] : demoEntries));
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    isConfigured ? null : demoEntries[0]?.id ?? null,
  );
  const [queryInput, setQueryInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("all");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(isConfigured ? null : "demo");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [loading, setLoading] = useState(isConfigured);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreEntries, setHasMoreEntries] = useState(isConfigured);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(getMonthKey(getJstDateString()));
  const calendarRef = useRef<HTMLDivElement | null>(null);
  const listEndRef = useRef<HTMLDivElement | null>(null);
  const entriesRef = useRef<Entry[]>(entries);
  const selectedIdRef = useRef<string | null>(selectedId);
  const requestSequenceRef = useRef(0);
  const loadingMoreRef = useRef(false);

  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const activeRange = useMemo(
    () => getFilterRange(periodPreset, customStartDate, customEndDate),
    [customEndDate, customStartDate, periodPreset],
  );
  const activeFilters = useMemo<EntryFilters>(
    () => ({
      query: searchQuery,
      startDate: activeRange.startDate,
      endDate: activeRange.endDate,
    }),
    [activeRange.endDate, activeRange.startDate, searchQuery],
  );

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);

  const callGoogleDriveApi = useCallback(async (path: string, init?: RequestInit) => {
    if (!supabase) {
      throw new Error("Google Drive 連携はデモモードでは使えません。");
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("Google Drive 連携を使うにはログインが必要です。");
    }

    const response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        ...init?.headers,
      },
    });

    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      throw new Error(payload?.error ?? "Google Drive 連携に失敗しました。");
    }

    return payload;
  }, [supabase]);

  const syncGoogleDriveRefreshToken = useCallback(async () => {
    const refreshToken = getStoredGoogleDriveRefreshToken();
    if (!refreshToken) {
      return false;
    }

    await callGoogleDriveApi("/api/google-drive/session", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    });
    setStoredGoogleDriveRefreshToken(null);
    return true;
  }, [callGoogleDriveApi]);

  const loadEntries = useCallback(async (currentUserId: string | null, reset = true) => {
    if (!supabase) return;
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;

    if (reset) {
      setLoading(true);
    } else {
      if (loadingMoreRef.current) return;
      setLoadingMore(true);
    }

    const persisted = readPersistedState(currentUserId);
    const currentEntries = entriesRef.current;
    const currentSelectedId = selectedIdRef.current;
    const remoteCount = reset
      ? 0
      : currentEntries.filter((entry) => !entry.id.startsWith("draft-")).length;
    const from = remoteCount;
    const to = remoteCount + ENTRY_PAGE_SIZE - 1;
    let request = supabase
      .from("diary_entries")
      .select("*")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (activeFilters.startDate) {
      request = request.gte("entry_date", activeFilters.startDate);
    }

    if (activeFilters.endDate) {
      request = request.lte("entry_date", activeFilters.endDate);
    }

    const normalizedQuery = normalizeSearchTerm(activeFilters.query);
    if (normalizedQuery) {
      request = request.or(`title.ilike.%${normalizedQuery}%,body.ilike.%${normalizedQuery}%`);
    }

    const { data, error } = await request;
    if (requestSequence !== requestSequenceRef.current) {
      return;
    }

    if (!error && data) {
      const mergedEntries = mergeVisibleEntries({
        currentEntries,
        incomingEntries: data,
        persisted,
        filters: activeFilters,
        reset,
      });
      setEntries(mergedEntries);
      setHasMoreEntries(data.length === ENTRY_PAGE_SIZE);
      const fallbackSelectedId = mergedEntries[0]?.id ?? null;

      if (reset) {
        const persistedSelectedId = persisted?.selectedId ?? null;
        setSelectedId(
          persistedSelectedId && mergedEntries.some((entry) => entry.id === persistedSelectedId)
            ? persistedSelectedId
            : fallbackSelectedId,
        );
      } else if (!currentSelectedId && fallbackSelectedId) {
        setSelectedId(fallbackSelectedId);
      }
    } else {
      setHasMoreEntries(false);
    }

    if (reset) {
      setLoading(false);
    } else {
      setLoadingMore(false);
    }
  }, [activeFilters, supabase]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchQuery(queryInput);
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [queryInput]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null);
      setUserId(data.user?.id ?? null);
      if (data.user) {
        void syncGoogleDriveRefreshToken().catch(() => {});
      }
      else setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.provider_token) {
        setStoredGoogleDriveToken(session.provider_token);
      }
      if (session?.provider_refresh_token) {
        setStoredGoogleDriveRefreshToken(session.provider_refresh_token);
        void syncGoogleDriveRefreshToken().catch(() => {});
      } else if (!session) {
        setStoredGoogleDriveToken(null);
        setStoredGoogleDriveRefreshToken(null);
        void fetch("/api/google-drive/session", { method: "DELETE" }).catch(() => {});
      }
      setUserEmail(session?.user.email ?? null);
      setUserId(session?.user.id ?? null);
      if (!session?.user) {
        setEntries([]);
        setSelectedId(null);
        setSaveMessage("");
        setHasMoreEntries(false);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, [supabase, syncGoogleDriveRefreshToken]);

  useEffect(() => {
    if (!supabase || !userId) return;
    const timeoutId = window.setTimeout(() => {
      void loadEntries(userId, true);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [activeFilters, loadEntries, supabase, userId]);

  useEffect(() => {
    if (isConfigured) return;

    const persisted = readPersistedState("demo");
    if (!persisted) return;

    const nextSelectedId = persisted.entries.some((entry) => entry.id === persisted.selectedId)
      ? persisted.selectedId
      : persisted.entries[0]?.id ?? null;
    const frameId = window.requestAnimationFrame(() => {
      setEntries(persisted.entries);
      setSelectedId(nextSelectedId);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, []);

  useEffect(() => {
    if ((isConfigured && !userId) || loading) return;

    const payload: PersistedEditorState = {
      entries,
      selectedId,
    };

    window.sessionStorage.setItem(getStorageKey(userId), JSON.stringify(payload));
  }, [entries, loading, selectedId, userId]);

  const visibleEntries = useMemo(() => {
    if (!isConfigured) {
      return entries.filter((entry) => matchesLocalFilters(entry, activeFilters));
    }

    return entries;
  }, [activeFilters, entries]);
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
  const filterSummary = useMemo(() => {
    if (searchQuery.trim()) {
      return `「${searchQuery}」の検索結果`;
    }

    switch (periodPreset) {
      case "month":
        return "今月の日記";
      case "quarter":
        return "過去3か月の日記";
      case "year":
        return "過去1年の日記";
      case "custom":
        return "指定期間の日記";
      default:
        return "最近の日記";
    }
  }, [periodPreset, searchQuery]);

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

  useEffect(() => {
    if (!isConfigured || !userId || !hasMoreEntries || loading || loadingMore || !listEndRef.current) return;

    const observer = new IntersectionObserver((observedEntries) => {
      const [entry] = observedEntries;
      if (!entry?.isIntersecting) return;
      void loadEntries(userId, false);
    }, {
      rootMargin: "120px 0px",
    });

    observer.observe(listEndRef.current);
    return () => observer.disconnect();
  }, [hasMoreEntries, loadEntries, loading, loadingMore, userId]);

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
      options: {
        redirectTo: window.location.origin,
        scopes: `${GOOGLE_DRIVE_SCOPE} openid email profile`,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });
    if (error) {
      setAuthMessage(`Google ログインを開始できませんでした: ${error.message}`);
      setAuthSubmitting(false);
    }
  }

  function createEntry() {
    const now = new Date();
    const today = getJstDateString(now);
    const existingEntry = findEntryByDate(entriesRef.current, today);

    if (existingEntry) {
      setSelectedId(existingEntry.id);
      setSaveMessage("今日はすでに日記があります。既存の日記を開きました。");
      setSidebarOpen(false);
      return;
    }

    const draft: Entry = {
      id: `draft-${crypto.randomUUID()}`,
      title: "",
      body: "",
      entry_date: today,
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
      setSaveMessage("デモモードのため、この端末内にだけ保存されます。");
      window.setTimeout(() => setSaving(false), 500);
      return;
    }
    setSaving(true);
    setSaveMessage("");
    const conflictingEntry = findEntryByDate(entriesRef.current, selected.entry_date, selected.id);

    if (conflictingEntry) {
      setSelectedId(conflictingEntry.id);
      setSaveMessage("その日付の日記はすでにあります。1日に保存できる日記は1件だけです。");
      setSaving(false);
      return;
    }

    const isDraft = selected.id.startsWith("draft-");
    let duplicateQuery = supabase
      .from("diary_entries")
      .select("*")
      .eq("entry_date", selected.entry_date)
      .limit(1);

    if (!isDraft) {
      duplicateQuery = duplicateQuery.neq("id", selected.id);
    }

    const { data: serverDuplicate, error: duplicateCheckError } = await duplicateQuery.maybeSingle();

    if (duplicateCheckError) {
      setSaveMessage(`同じ日の日記を確認できませんでした: ${duplicateCheckError.message}`);
      setSaving(false);
      return;
    }

    if (serverDuplicate) {
      setEntries((current) =>
        current.some((entry) => entry.id === serverDuplicate.id)
          ? current
          : [serverDuplicate, ...current].sort(compareEntries),
      );
      setSelectedId(serverDuplicate.id);
      setSaveMessage("その日付の日記はすでにあります。既存の日記を開きました。");
      setSaving(false);
      return;
    }

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
    if (result.error || !result.data) {
      if (result.error?.code === "23505") {
        const { data: existingEntry } = await supabase
          .from("diary_entries")
          .select("*")
          .eq("entry_date", selected.entry_date)
          .maybeSingle();

        if (existingEntry) {
          setEntries((current) =>
            current.some((entry) => entry.id === existingEntry.id)
              ? current
              : [existingEntry, ...current].sort(compareEntries),
          );
          setSelectedId(existingEntry.id);
        }
        setSaveMessage("その日付の日記はすでにあります。1日に保存できる日記は1件だけです。");
        setSaving(false);
        return;
      }
      setSaveMessage(`保存に失敗しました: ${result.error?.message ?? "不明なエラー"}`);
      setSaving(false);
      return;
    }

    const syncedEntries = entries.map((entry) => (entry.id === selected.id ? result.data : entry));
    setEntries(syncedEntries);
    setSelectedId(result.data.id);

    if (!userId) {
      setSaveMessage("保存しました。Google Drive バックアップを使うには Google ログインが必要です。");
      setSaving(false);
      return;
    }

    try {
      await syncGoogleDriveRefreshToken().catch(() => {});
      await callGoogleDriveApi("/api/google-drive/backup", {
        method: "PUT",
      });
      setSaveMessage("保存しました。Google Drive バックアップ済み");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Google Drive バックアップに失敗しました。";
      setSaveMessage(`保存しました。${message}`);
    }

    setSaving(false);
  }

  async function restoreEntriesFromGoogleDrive() {
    if (!supabase || !userId) {
      setSaveMessage("Google Drive から復元するには Google ログインが必要です。");
      return;
    }

    setRestoring(true);
    setSaveMessage("");

    try {
      await syncGoogleDriveRefreshToken().catch(() => {});
      const payload = (await callGoogleDriveApi("/api/google-drive/backup")) as {
        entries?: Entry[];
        fileId?: string | null;
      } | null;
      const backupEntries = Array.isArray(payload?.entries) ? payload.entries : [];
      if (payload?.fileId) {
        setStoredGoogleDriveFileId(userId, payload.fileId);
      }
      const backupEntryDatesSeen = new Set<string>();
      const restorableEntries = backupEntries.filter((entry) => {
        if (entry.id.startsWith("draft-") || backupEntryDatesSeen.has(entry.entry_date)) {
          return false;
        }
        backupEntryDatesSeen.add(entry.entry_date);
        return true;
      });

      if (!restorableEntries.length) {
        setSaveMessage("復元できる日記はバックアップ内にありませんでした。");
        setRestoring(false);
        return;
      }

      const backupIds = restorableEntries.map((entry) => entry.id);
      const backupEntryDates = restorableEntries.map((entry) => entry.entry_date);
      const { data: existingData, error: existingError } = await supabase
        .from("diary_entries")
        .select("id")
        .in("id", backupIds);

      const { data: existingDateData, error: existingDateError } = await supabase
        .from("diary_entries")
        .select("entry_date")
        .in("entry_date", backupEntryDates);

      if (existingError || existingDateError) {
        throw new Error(
          `既存データの確認に失敗しました: ${existingError?.message ?? existingDateError?.message}`,
        );
      }

      const existingIds = new Set((existingData ?? []).map((entry) => entry.id));
      const existingEntryDates = new Set((existingDateData ?? []).map((entry) => entry.entry_date));
      const entriesToInsert = restorableEntries.filter(
        (entry) => !existingIds.has(entry.id) && !existingEntryDates.has(entry.entry_date),
      );

      if (!entriesToInsert.length) {
        setSaveMessage("バックアップ内の日記はすべてすでに登録済みでした。");
        setRestoring(false);
        return;
      }

      const { data: insertedEntries, error: insertError } = await supabase
        .from("diary_entries")
        .insert(
          entriesToInsert.map((entry) => ({
            id: entry.id,
            user_id: userId,
            title: entry.title,
            body: entry.body,
            entry_date: entry.entry_date,
            created_at: entry.created_at,
            updated_at: entry.updated_at,
          })),
        )
        .select("*");

      if (insertError) {
        throw new Error(`復元に失敗しました: ${insertError.message}`);
      }

      await loadEntries(userId, true);
      setSaveMessage(`${insertedEntries?.length ?? entriesToInsert.length}件をGoogle Driveバックアップから復元しました。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Google Drive からの復元に失敗しました。";
      setSaveMessage(message);
    }

    setRestoring(false);
  }

  async function deleteEntry() {
    if (!selected || !window.confirm("この日記を削除しますか？")) return;
    if (supabase && !selected.id.startsWith("draft-")) {
      await supabase.from("diary_entries").delete().eq("id", selected.id);
    }
    const next = entries.filter((entry) => entry.id !== selected.id);
    setEntries(next);
    setSelectedId(next[0]?.id ?? null);
    setSaveMessage("");
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
              ? "メールアドレスでもログインできます。Google ログイン時は保存と同時に Google Drive バックアップも使えます。"
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
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="日記を検索…"
            aria-label="日記を検索"
          />
          {queryInput && <button onClick={() => setQueryInput("")}><X size={14} /></button>}
        </div>
        <div className="filter-panel">
          <div className="filter-row">
            <label htmlFor="period-preset">期間</label>
            <select
              id="period-preset"
              value={periodPreset}
              onChange={(e) => setPeriodPreset(e.target.value as PeriodPreset)}
            >
              <option value="all">すべて</option>
              <option value="month">今月</option>
              <option value="quarter">過去3か月</option>
              <option value="year">過去1年</option>
              <option value="custom">カスタム</option>
            </select>
          </div>
          {periodPreset === "custom" && (
            <div className="filter-range">
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                aria-label="開始日"
              />
              <span>〜</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                aria-label="終了日"
              />
            </div>
          )}
        </div>
        <div className="entry-count">{filterSummary} <span>{visibleEntries.length}{hasMoreEntries ? "+" : ""}</span></div>
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
          {!visibleEntries.length && !loading && <p className="empty-search">見つかりませんでした。<br />別の条件で探してみてください。</p>}
          {loadingMore && <p className="entry-loading">さらに読み込み中…</p>}
          {!loading && hasMoreEntries && <div ref={listEndRef} className="entry-list-sentinel" aria-hidden="true" />}
        </nav>
        <div className="sidebar-footer">
          <div><Cloud size={15} /><span>{isConfigured ? "クラウドに同期済み" : "デモモード"}</span></div>
          <div className="sidebar-footer-actions">
            {userEmail && (
              <button
                onClick={restoreEntriesFromGoogleDrive}
                title="Google Driveから復元"
                disabled={restoring}
              >
                <Download size={16} />
              </button>
            )}
            {userEmail && (
              <button onClick={() => supabase?.auth.signOut()} title="ログアウト"><LogOut size={16} /></button>
            )}
          </div>
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
                {saving ? <><Check size={16} /> 保存中…</> : "保存する"}
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
              placeholder=""
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
              <span>
                {saveMessage ||
                  `最終更新 ${new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date(selected.updated_at))}`}
              </span>
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
