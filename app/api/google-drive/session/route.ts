import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

const GOOGLE_DRIVE_REFRESH_COOKIE = "hibi-google-drive-refresh";

function encodeRefreshCookie(value: { refreshToken: string; userId: string }) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

async function getAuthenticatedUser(request: Request) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;

  if (!token) {
    throw new Error("認証情報が見つかりません。");
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw new Error("ログイン状態を確認できませんでした。");
  }

  return user;
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    const body = (await request.json()) as { refreshToken?: string };
    const refreshToken = body.refreshToken?.trim();

    if (!refreshToken) {
      return Response.json({ error: "Google Drive 用の更新トークンが見つかりません。" }, { status: 400 });
    }

    const cookieStore = await cookies();
    cookieStore.set({
      name: GOOGLE_DRIVE_REFRESH_COOKIE,
      value: encodeRefreshCookie({
        refreshToken,
        userId: user.id,
      }),
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 180,
    });

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Drive 連携の保存に失敗しました。";
    return Response.json({ error: message }, { status: 401 });
  }
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(GOOGLE_DRIVE_REFRESH_COOKIE);
  return Response.json({ ok: true });
}
