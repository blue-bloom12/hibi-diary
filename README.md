# 日々の余白

認証付きのプライベート日記Webアプリです。本文・タイトルの語句検索、クラウド保存、
スマートフォン表示に対応しています。

## セットアップ

1. [Supabase](https://database.new) でプロジェクトを作成
2. SQL Editor で `supabase/schema.sql` を実行
3. `.env.example` を `.env.local` にコピーし、Supabase と Google OAuth の環境変数を設定
4. `npm run dev` で起動

環境変数が未設定の場合は、保存を伴わないデモモードで起動します。

Google Drive バックアップを保存し続けるには、Google OAuth クライアントの Client ID / Client Secret を
このアプリ側にも設定してください。Supabase に設定したものと同じ値を使います。

## Vercelへデプロイ

```bash
npx vercel
npx vercel env add NEXT_PUBLIC_SUPABASE_URL
npx vercel env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
npx vercel env add GOOGLE_CLIENT_ID
npx vercel env add GOOGLE_CLIENT_SECRET
npx vercel --prod
```

Supabase の Authentication > URL Configuration で Site URL に本番URLを設定してください。
