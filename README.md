# 日々の余白

認証付きのプライベート日記Webアプリです。本文・タイトルの語句検索、クラウド保存、
スマートフォン表示に対応しています。

## セットアップ

1. [Supabase](https://database.new) でプロジェクトを作成
2. SQL Editor で `supabase/schema.sql` を実行
3. `.env.example` を `.env.local` にコピーし、Project URL と Publishable key を設定
4. `npm run dev` で起動

環境変数が未設定の場合は、保存を伴わないデモモードで起動します。

## Vercelへデプロイ

```bash
npx vercel
npx vercel env add NEXT_PUBLIC_SUPABASE_URL
npx vercel env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
npx vercel --prod
```

Supabase の Authentication > URL Configuration で Site URL に本番URLを設定してください。
