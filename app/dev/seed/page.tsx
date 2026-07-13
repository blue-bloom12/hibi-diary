"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type SeedState =
  | { status: "loading" }
  | {
      status: "success";
      created: number;
      skipped: number;
      firstDate: string | null;
      lastDate: string | null;
    }
  | {
      status: "error";
      message: string;
    };

export default function DevSeedPage() {
  const calledRef = useRef(false);
  const [state, setState] = useState<SeedState>({ status: "loading" });

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    const count = new URLSearchParams(window.location.search).get("count") ?? "100";

    void fetch(`/api/dev/seed?count=${encodeURIComponent(count)}`)
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | {
              created?: number;
              skipped?: number;
              error?: string;
              firstDate?: string | null;
              lastDate?: string | null;
            }
          | null;

        if (!response.ok) {
          throw new Error(payload?.error ?? "ダミー日記の作成に失敗しました。");
        }

        setState({
          status: "success",
          created: payload?.created ?? 0,
          skipped: payload?.skipped ?? 0,
          firstDate: payload?.firstDate ?? null,
          lastDate: payload?.lastDate ?? null,
        });
      })
      .catch((error) => {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "ダミー日記の作成に失敗しました。",
        });
      });
  }, []);

  return (
    <main style={{ padding: "32px", fontFamily: "sans-serif", lineHeight: 1.7 }}>
      <h1>
        {state.status === "loading"
          ? "ダミー日記を作成中です"
          : state.status === "success"
            ? "ダミー日記を作成しました"
            : "作成に失敗しました"}
      </h1>
      {state.status === "loading" ? <p>ローカルAPIを呼び出しています…</p> : null}
      {state.status === "success" ? (
        <>
          <p>作成件数: {state.created}件</p>
          <p>同じ日付のためスキップ: {state.skipped}件</p>
          <p>最新日付: {state.firstDate ?? "-"}</p>
          <p>最古日付: {state.lastDate ?? "-"}</p>
        </>
      ) : null}
      {state.status === "error" ? <p>{state.message}</p> : null}
      <p>
        一覧確認に戻る: <Link href="/">http://localhost:3000/</Link>
      </p>
    </main>
  );
}
