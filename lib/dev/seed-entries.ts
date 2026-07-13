import { createClient } from "@/lib/supabase/server";

function getJstDateString(date: Date) {
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
    throw new Error("JST日付の生成に失敗しました。");
  }

  return `${year}-${month}-${day}`;
}

function buildEntries(count: number) {
  const total = Math.max(1, Math.min(count, 200));

  return Array.from({ length: total }, (_value, index) => {
    const date = new Date();
    date.setDate(date.getDate() - index);

    return {
      title: "",
      body: [
        `確認用ダミー日記 ${String(index + 1).padStart(3, "0")}`,
        "一覧・検索・期間フィルタ確認用のテストデータです。",
        `キーワード: りんご ねこ そら ${index % 7}`,
      ].join("\n"),
      entry_date: getJstDateString(date),
    };
  });
}

export async function seedEntries(count: number) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("この機能はローカル開発専用です。");
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error("ログイン中のユーザーを確認できませんでした。");
  }

  const payload = buildEntries(count);
  const { data: existingEntries, error: existingError } = await supabase
    .from("diary_entries")
    .select("entry_date")
    .in("entry_date", payload.map((entry) => entry.entry_date));

  if (existingError) {
    throw new Error(existingError.message);
  }

  const existingDates = new Set((existingEntries ?? []).map((entry) => entry.entry_date));
  const entriesToInsert = payload.filter((entry) => !existingDates.has(entry.entry_date));
  const { data, error } = entriesToInsert.length
    ? await supabase.from("diary_entries").insert(entriesToInsert).select("id, entry_date")
    : { data: [], error: null };

  if (error) {
    throw new Error(error.message);
  }

  return {
    created: data?.length ?? entriesToInsert.length,
    skipped: payload.length - entriesToInsert.length,
    firstDate: payload[0]?.entry_date ?? null,
    lastDate: payload.at(-1)?.entry_date ?? null,
  };
}
