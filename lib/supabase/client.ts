import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const GOOGLE_DRIVE_TOKEN_STORAGE_KEY = "hibi-google-drive-token";

let browserClient: SupabaseClient | null = null;

export function createClient() {
  if (browserClient) {
    return browserClient;
  }

  browserClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );

  if (typeof window !== "undefined") {
    browserClient.auth.onAuthStateChange((event, session) => {
      if (session?.provider_token) {
        window.localStorage.setItem(GOOGLE_DRIVE_TOKEN_STORAGE_KEY, session.provider_token);
      }

      if (event === "SIGNED_OUT") {
        window.localStorage.removeItem(GOOGLE_DRIVE_TOKEN_STORAGE_KEY);
      }
    });
  }

  return browserClient;
}
