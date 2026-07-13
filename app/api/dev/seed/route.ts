import { seedEntries } from "@/lib/dev/seed-entries";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const count = Number(searchParams.get("count") ?? "100");
    const result = await seedEntries(count);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ダミー日記の作成に失敗しました。";
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { count?: number } | null;
    const result = await seedEntries(body?.count ?? 100);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ダミー日記の作成に失敗しました。";
    return Response.json({ error: message }, { status: 400 });
  }
}
