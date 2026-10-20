# Oilaviy arxiv

Yopiq oilaviy rasm/video arxivi: koʻp faylli yuklash, albomlar, qidiruv, Telegram bot orqali avtomatik qabul qilish,
Gemini AI tavsiflari (ixtiyoriy) va interaktiv oila daraxti. Spetsifikatsiya: [docs/SPEC.md](docs/SPEC.md).

**Stek:** Next.js 16 (App Router, Server Actions), TypeScript, Tailwind CSS 4, Motion, PostgreSQL, sharp, ffmpeg.
Fon ishlari (rasm/video qayta ishlash, Telegram, AI) Postgres navbati orqali Next.js jarayonining ichida ishlaydi — Redis yoki alohida servis kerak emas.

## Mahalliy ishga tushirish (Windows/macOS/Linux)

Talablar: Node.js ≥ 22.12, PostgreSQL 15+ (`initdb`, `pg_ctl`, `psql` PATH’da).

```bash
npm install
```

npm 12 oʻrnatish skriptlarini bloklaydi; `package.json` dagi `allowScripts` ffmpeg-static (ffmpeg binari), esbuild va unrs-resolver uchun ruxsat beradi.

```bash
npm run db:dev
```

Loyiha ichida (`.data/pg`, port 5433, faqat localhost) alohida Postgres klasterini yaratadi va ishga tushiradi — tizim paroli kerak emas.
Oʻz Postgres’ingiz boʻlsa, bu qadamni oʻtkazib, `DATABASE_URL` ni oʻzgartiring.

```bash
cp .env.example .env.local
```

```bash
npm run db:migrate
```

```bash
npm run dev
```

<http://localhost:3000> → birinchi kirishda `/setup` sahifasida oila va egasi yaratiladi.

## Sozlamalar (`.env.local` / `.env`)

| Oʻzgaruvchi | Vazifa |
|---|---|
| `DATABASE_URL` | PostgreSQL ulanishi |
| `APP_URL` | Tashqi manzil (`https://…` boʻlsa cookie `Secure` va `__Host-` prefiksli boʻladi) |
| `STORAGE_DRIVER` | `fs` (disk) yoki `s3` (Cloudflare R2 / S3) |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | R2: endpoint `https://<account>.r2.cloudflarestorage.com`, `S3_REGION=auto` |
| `MAX_IMAGE_MB`, `MAX_VIDEO_MB` | Server tomonidagi hajm chegaralari (sukut 50 / 2048) |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | AI (ixtiyoriy). Sukut model `gemini-3.5-flash-lite` |
| `AI_DAILY_LIMIT` | Oila uchun kunlik Gemini soʻrovlari chegarasi |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` | Telegram bot |
| `TELEGRAM_LOCAL_SERVER`, `TELEGRAM_MAX_DOWNLOAD_MB`, `TELEGRAM_API_BASE` | Local Bot API server rejimi |

Sirlarni hech qachon repoga qoʻshmang: `.env*` gitignore’da (faqat `.env.example` kuzatiladi).

## Telegram

1. @BotFather → `/newbot` → token va username’ni `.env` ga yozing; `TELEGRAM_WEBHOOK_SECRET` ga tasodifiy qator (A-Z a-z 0-9 _ -) qoʻying.
2. **Dev:** `npm run dev` bilan birga:

   ```bash
   npm run telegram:poll
   ```

3. **Prod (HTTPS):** webhook’ni roʻyxatdan oʻtkazing (bir marta):

   ```bash
   npm run telegram:webhook
   ```

4. Saytda **Sozlamalar → Telegram → Ulanish kodini olish**: 10 daqiqalik bir martalik kod; bot Telegram raqamli `from.id` ni bogʻlaydi (username ishlatilmaydi).

Cheklovlar (Bot API hujjatlari, 2026-10): cloud Bot API bot uchun **20 MB** gacha yuklab olishga ruxsat beradi.
Kattaroq videolar uchun Local Bot API server: `docker compose --profile telegram-local up -d`, soʻng `.env` da
`TELEGRAM_API_BASE=http://telegram-bot-api:8081`, `TELEGRAM_LOCAL_SERVER=true`, `TELEGRAM_MAX_DOWNLOAD_MB=2000`;
botni avval cloud serverdan chiqaring (`https://api.telegram.org/bot<token>/logOut`) va webhook’ni qayta oʻrnating.
“Rasm” sifatida yuborilgan fotolarni Telegram siqadi — asl sifat uchun “Fayl” sifatida yuborish kerak (bot buni foydalanuvchiga eslatadi).

## AI (Gemini)

Oila egasi Sozlamalar → AI boʻlimida rozilik matnini tasdiqlab yoqadi. Faqat rasmlarning ≤1024px, EXIF/GPS’siz nusxasi yuboriladi.
Google AI Studio **bepul** tarifida yuborilgan maʼlumotlar Google mahsulotlarini yaxshilashda ishlatilishi va odamlar tomonidan koʻrilishi mumkin;
toʻlovli (billing yoqilgan) loyihada bunday emas — shaxsiy rasmlar uchun billing yoqilgan kalit tavsiya etiladi.
Kalit faqat serverda (`GEMINI_API_KEY`) saqlanadi va brauzerga hech qachon yuborilmaydi. AI oʻchiq/xato boʻlsa arxivning qolgan qismi toʻliq ishlaydi.

## Vercel (serverless)

Vercel’da doimiy jarayon yoʻq, shuning uchun ilova oʻzini moslaydi (`VERCEL` muhit oʻzgaruvchisi boʻyicha):
fayllar brauzerdan **toʻgʻridan-toʻgʻri R2’ga** 8 MB lik qismlarda yuboriladi (imzolangan havolalar), rasmlar ham R2’dan imzolangan havola orqali ochiladi,
fon ishlari har soʻrovdan keyin (`after()`) va kuniga bir marta cron’da bajariladi, vaqtinchalik fayllar `/tmp` da.

**Cheklovlar (Hobby tarif):** funksiya 300 s da toʻxtatiladi va `/tmp` 512 MB — shuning uchun video chegarasi sukut boʻyicha 200 MB
(`MAX_VIDEO_MB`). Uzun HEVC videolarni qayta kodlash 300 s ga sigʻmasligi mumkin. Rate-limit har instansda alohida.

1. **Baza (Neon):** Vercel → loyiha → *Storage* → *Create Database* → **Neon** → region **Frankfurt (eu-central-1)**.
   Integratsiya `DATABASE_URL` va `DATABASE_URL_UNPOOLED` ni oʻzi qoʻshadi. Migratsiyalar har build’da avtomatik bajariladi (`vercel-build`).
2. **Fayl ombori (Cloudflare R2):** dash.cloudflare.com → *R2* → *Create bucket* (masalan `oilaviy-arxiv`, public access **yoqilmaydi**).
   *R2 → Manage API tokens → Create API token*: ruxsat **Object Read & Write**, faqat shu bucket. Access Key ID va Secret’ni saqlang.
   Endpoint: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
3. **R2 CORS** (bucket → *Settings → CORS policy*), aks holda brauzer yuklay olmaydi:

   ```json
   [{ "AllowedOrigins": ["https://SAYTINGIZ.vercel.app"], "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600 }]
   ```

4. **Bucket lifecycle** (tavsiya): *Settings → Object lifecycle rules → Abort incomplete multipart uploads after 1 day*.
5. **Vercel Environment Variables** (Settings → Environment Variables), keyin *Redeploy*:

   | Oʻzgaruvchi | Qiymat |
   |---|---|
   | `APP_URL` | `https://SAYTINGIZ.vercel.app` |
   | `STORAGE_DRIVER` | `s3` |
   | `S3_ENDPOINT` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
   | `S3_REGION` | `auto` |
   | `S3_BUCKET` | bucket nomi |
   | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | R2 token kalitlari |
   | `CRON_SECRET` | 32+ belgili tasodifiy qator (cron’ni himoya qiladi) |

   Telegram/Gemini kerak boʻlsa, ularning oʻzgaruvchilarini ham qoʻshing, keyin webhook’ni `npm run telegram:webhook` bilan
   (`APP_URL` Vercel manzili boʻlgan holda) roʻyxatdan oʻtkazing.
6. Saytni oching → `/setup` da oila va egasini yarating.

## Production (bitta VPS)

```bash
cp .env.example .env
```

`.env` da `APP_URL=https://arxiv.example.uz`, `POSTGRES_PASSWORD`, R2 va bot sozlamalarini toʻldiring, keyin:

```bash
docker compose up -d --build
```

Konteyner ishga tushishda migratsiyalarni avtomatik qoʻllaydi. HTTPS uchun oldiga Caddy qoʻying (`/etc/caddy/Caddyfile`):

```
arxiv.example.uz {
	request_body {
		max_size 9MB
	}
	reverse_proxy 127.0.0.1:3000
}
```

Fayllar 8 MB lik boʻlaklarda yuklanadi, shuning uchun proksi chegarasi 9 MB yetarli. Bir nechta instans ishlatilsa, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` ni umumiy qiling va rate-limit’ni Redis/Postgres’ga koʻchiring (hozir jarayon xotirasida).

## Zaxira va tiklash

- **Maʼlumotlar bazasi** (kundalik, cron):

  ```bash
  docker compose exec -T db pg_dump -U postgres -Fc oilaviy > backup-$(date +%F).dump
  ```

  Tiklash: `docker compose exec -T db pg_restore -U postgres -d oilaviy --clean < backup.dump`
- **Fayllar:** `STORAGE_DRIVER=s3` (R2) da originallar va hosilalar bucket’da; ikkinchi nusxa uchun `rclone sync r2:bucket backup:bucket` ni rejalashtiring.
  `fs` rejimida `appdata` volume’ini (`/data/storage`) zaxiralang.
- DB va fayllarni bir vaqtda zaxiralang: DB yozuvi bor, lekin fayli yoʻq media galereyada xato sifatida koʻrinadi.

## Tekshiruvlar

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm test
```

Testlar `.env.test` (alohida `oilaviy_test` bazasi) bilan real PostgreSQL, sharp va ffmpeg’da ishlaydi. Telegram Bot API va Gemini testlarda
`127.0.0.1` dagi test-dubllar bilan almashtirilgan — ular bizning mantiqni tekshiradi, jonli servis integratsiyasini emas.

## Maʼlum cheklovlar

- HEIC dekodlash (`heic-decode`, WASM) avtomatik test qilinmagan — HEIC namunasi yaratish vositasi yoʻq edi; haqiqiy iPhone faylida tekshiring.
- R2/S3 drayveri, haqiqiy Telegram va Gemini chaqiruvlari kalitlar yoʻqligi sababli faqat kod darajasida; ishga tushirishdan oldin real kalitlar bilan sinang.
- EXIF vaqt zonasi boʻlmasa Toshkent (UTC+5) deb olinadi.
- Videolarni koʻrish nusxasi ≤1080p H.264; asl fayl oʻzgarmaydi va yuklab olinadi.
