import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

type Entry = {
  id: string;
  title: string;
  body: string;
  entry_date: string;
  created_at: string;
  updated_at: string;
};

type BackupPayload = {
  exported_at: string;
  user: {
    id: string;
    email: string | null;
  };
  entries: Entry[];
};

const GOOGLE_DRIVE_REFRESH_COOKIE = "hibi-google-drive-refresh";

function compareEntries(a: Entry, b: Entry) {
  if (a.entry_date !== b.entry_date) {
    return b.entry_date.localeCompare(a.entry_date);
  }

  return b.created_at.localeCompare(a.created_at);
}

function buildBackupFileName(userId: string) {
  return `hibi-diary-backup-${userId}.json`;
}

function decodeRefreshCookie(value: string) {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      refreshToken?: string;
      userId?: string;
    };

    if (!decoded.refreshToken || !decoded.userId) {
      return null;
    }

    return decoded as { refreshToken: string; userId: string };
  } catch {
    return null;
  }
}

function toEntry(entry: unknown): Entry | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const value = entry as Record<string, unknown>;
  if (
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.body !== "string" ||
    typeof value.entry_date !== "string" ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    title: value.title,
    body: value.body,
    entry_date: value.entry_date,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
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

  return { token, user };
}

async function getAllDiaryEntries(token: string) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  );
  const entries: Entry[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("diary_entries")
      .select("id,title,body,entry_date,created_at,updated_at")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`日記の全件取得に失敗しました: ${error.message}`);
    }

    const pageEntries = (data ?? []).map(toEntry).filter((entry): entry is Entry => Boolean(entry));
    entries.push(...pageEntries);

    if (!data || data.length < pageSize) {
      return entries;
    }
  }
}

async function getRefreshTokenForUser(userId: string) {
  const cookieStore = await cookies();
  const encoded = cookieStore.get(GOOGLE_DRIVE_REFRESH_COOKIE)?.value;
  if (!encoded) {
    throw new Error("Google Drive バックアップを使うには Google で再ログインしてください。");
  }

  const decoded = decodeRefreshCookie(encoded);
  if (!decoded || decoded.userId !== userId) {
    throw new Error("Google Drive の連携情報が一致しません。Google で再ログインしてください。");
  }

  return decoded.refreshToken;
}

async function getGoogleAccessToken(refreshToken: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error("GOOGLE_CLIENT_ID が設定されていません。");
  }

  const form = new URLSearchParams({
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  if (process.env.GOOGLE_CLIENT_SECRET) {
    form.set("client_secret", process.env.GOOGLE_CLIENT_SECRET);
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const payload = (await response.json().catch(() => null)) as
    | { access_token?: string; error?: string; error_description?: string }
    | null;

  if (!response.ok || !payload?.access_token) {
    throw new Error(
      payload?.error_description ??
        payload?.error ??
        "Google Drive 用のアクセストークン更新に失敗しました。",
    );
  }

  return payload.access_token;
}

async function findGoogleDriveBackupFile(accessToken: string, userId: string) {
  const fileName = buildBackupFileName(userId);
  const query = [
    `name = '${fileName.replace(/'/g, "\\'")}'`,
    "trashed = false",
    "mimeType = 'application/json'",
  ].join(" and ");
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&pageSize=1&fields=files(id,name)`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error("Google Drive のバックアップファイル確認に失敗しました。");
  }

  const data = (await response.json()) as {
    files?: Array<{ id: string; name: string }>;
  };

  return data.files?.[0]?.id ?? null;
}

async function uploadGoogleDriveBackup(params: {
  accessToken: string;
  entries: Entry[];
  userEmail: string | null;
  userId: string;
}) {
  const { accessToken, entries, userEmail, userId } = params;
  const payload: BackupPayload = {
    exported_at: new Date().toISOString(),
    user: {
      id: userId,
      email: userEmail,
    },
    entries: [...entries].sort(compareEntries),
  };
  const fileId = await findGoogleDriveBackupFile(accessToken, userId);
  const metadata = {
    name: buildBackupFileName(userId),
    mimeType: "application/json",
  };
  const boundary = `hibi-diary-${crypto.randomUUID()}`;
  const body =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${JSON.stringify(payload, null, 2)}\r\n` +
    `--${boundary}--`;
  const endpoint = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id";
  const method = fileId ? "PATCH" : "POST";
  const response = await fetch(endpoint, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Google Drive への保存権限がありません。Google で再ログインしてください。");
    }

    throw new Error("Google Drive へのバックアップ保存に失敗しました。");
  }

  const data = (await response.json()) as { id?: string };
  return data.id ?? null;
}

async function downloadGoogleDriveBackup(accessToken: string, userId: string) {
  const fileId = await findGoogleDriveBackupFile(accessToken, userId);

  if (!fileId) {
    throw new Error("Google Drive にバックアップファイルが見つかりませんでした。");
  }

  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Google Drive のバックアップを読む権限がありません。Google で再ログインしてください。");
    }

    throw new Error("Google Drive のバックアップ読み込みに失敗しました。");
  }

  const payload = (await response.json()) as Partial<BackupPayload>;
  if (!Array.isArray(payload.entries)) {
    throw new Error("バックアップファイルの形式が正しくありません。");
  }

  return {
    entries: payload.entries.map(toEntry).filter((entry): entry is Entry => Boolean(entry)),
    fileId,
  };
}

export async function PUT(request: Request) {
  try {
    const { token, user } = await getAuthenticatedUser(request);
    const refreshToken = await getRefreshTokenForUser(user.id);
    const accessToken = await getGoogleAccessToken(refreshToken);
    const entries = await getAllDiaryEntries(token);

    if (!entries.length) {
      return Response.json({ error: "バックアップする日記がありません。" }, { status: 400 });
    }

    const fileId = await uploadGoogleDriveBackup({
      accessToken,
      entries,
      userEmail: user.email ?? null,
      userId: user.id,
    });

    return Response.json({ ok: true, fileId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Drive バックアップに失敗しました。";
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function GET(request: Request) {
  try {
    const { user } = await getAuthenticatedUser(request);
    const refreshToken = await getRefreshTokenForUser(user.id);
    const accessToken = await getGoogleAccessToken(refreshToken);
    const payload = await downloadGoogleDriveBackup(accessToken, user.id);
    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Drive バックアップの取得に失敗しました。";
    return Response.json({ error: message }, { status: 400 });
  }
}
