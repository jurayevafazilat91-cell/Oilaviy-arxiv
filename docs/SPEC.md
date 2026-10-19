# Oilaviy Arxiv — spetsifikatsiya (v1)

Qabul qilingan qarorlar: bitta yopiq oila, taklif orqali kirish, email+parol, ≤30 foydalanuvchi,
rasm ≤50 MB (JPEG/PNG/WebP/HEIC), video ≤2 GB (MP4/MOV), bitta VPS + Cloudflare R2,
Gemini (tavsif, teglar, tabiiy tilda qidiruv; faqat rasm; Owner roziligi bilan),
Telegram shaxsiy chat + bir martalik kod, oila daraxti (ota-ona/farzand, turmush o'rtoq),
o'zbek tili (lotin), yorug' + qorong'i rejim.

## Arxitektura

| Qism | Tanlov | Sabab |
|---|---|---|
| Ilova | Next.js App Router + TypeScript, Server Actions | bitta kod bazasi, CSRF Origin tekshiruvi tayyor |
| UI | Tailwind CSS 4, Motion | talab qilingan; animatsiyalar `prefers-reduced-motion`ga bo'ysunadi |
| Ma'lumotlar bazasi | PostgreSQL + `postgres` drayveri, oddiy SQL migratsiyalar | ORM'siz, shaffof |
| Fon ishlari | Postgres `jobs` jadvali (`FOR UPDATE SKIP LOCKED`), Next.js jarayoni ichida (`instrumentation.ts`) | Redis yoki alohida servis kerak emas |
| Fayllar | `STORAGE_DRIVER=fs` (dev) yoki `s3` (R2) | original + hosilalar, kalitlar `f/{family}/m/{media}/{variant}` |
| Rasm | sharp (+ HEIC uchun heic-decode) | thumb 480px, preview 2048px WebP; EXIF/GPS hosilalardan olib tashlanadi |
| Video | ffmpeg | poster; faqat H.264/AAC bo'lmasa transkod (720p→1080p max) |
| AI | Gemini REST `generateContent`, model `GEMINI_MODEL` (sukut `gemini-3.5-flash-lite`) | SDK'siz |
| Telegram | Bot API webhook (`X-Telegram-Bot-Api-Secret-Token`), dev'da long polling | cloud: ≤20 MB; Local Bot API server: cheklovsiz |

Yuklash protokoli: brauzer → `POST /api/uploads` (sessiya) → 8 MB bo'laklar `PUT /api/uploads/:id?offset=N`
→ `POST /api/uploads/:id/complete` → `process_media` ishi. Qayta urinish/davom ettirish `offset` orqali,
birinchi bo'lakda magic-byte tekshiruvi (2 GB kutmasdan rad etish). Hash (SHA-256) bo'yicha dublikat.

## Rollar

| Amal | owner | admin | member | viewer |
|---|---|---|---|---|
| Ko'rish, original yuklab olish | ✓ | ✓ | ✓ | ✓ |
| Yuklash, Telegram ulash, albom yaratish, odam belgilash | ✓ | ✓ | ✓ | – |
| Media tahrir/o'chirish | hammasi | hammasi | o'ziniki | – |
| Savatdan butunlay o'chirish | ✓ | ✓ | – | – |
| A'zolar, takliflar, parol tiklash havolasi | ✓ | ✓ (owner'dan tashqari) | – | – |
| Oila daraxtini tahrirlash | ✓ | ✓ | `is_tree_editor` | – |
| AI yoqish/o'chirish (rozilik) | ✓ | – | – | – |

Tirik shaxslar: viewer faqat tug'ilgan yilni ko'radi; joy va izohlar yashiriladi.

## Foydalanuvchi yo'llari va qabul mezonlari

1. **Sozlash**: birinchi tashrif `/setup` → oila + owner. Foydalanuvchi bor bo'lsa `/setup` yopiq.
2. **Taklif**: admin rol tanlaydi → 7 kunlik bir martalik havola → yangi a'zo ro'yxatdan o'tadi. Ikkinchi marta ishlatilsa rad etiladi.
3. **Yuklash**: bir nechta fayl, har biri uchun progress, bekor qilish, qayta urinish. Holatlar: yuklanmoqda → qayta ishlanmoqda → tayyor | dublikat | xato.
   Noto'g'ri tur (masalan `.exe` nomi `.jpg` qilingan) yoki chegaradan katta fayl server tomonida rad etiladi.
   Sahifa yangilangach media saqlangan, rasm/video faqat shu oila a'zosiga beriladi (boshqa akkaunt → 404).
4. **Galereya**: oy bo'yicha guruhlangan setka, cheksiz scroll (kursor-paginatsiya), qidiruv (sarlavha, tavsif, teg, AI tavsif),
   filtr (tur, yil, albom, odam), lightbox (klaviatura ←/→/Esc, swipe), metama'lumot tahriri, yuklab olish, savatga o'chirish, tiklash.
5. **Albomlar**: yaratish, nomlash, media qo'shish/olib tashlash, muqova.
6. **Telegram**: Sozlamalar → kod (10 daqiqa, bir martalik) → `t.me/<bot>?start=KOD` → bog'lanadi (Telegram raqamli `from.id`).
   Rasm/video/fayl → "Telegram" albomi yoki `#albom-nomi`; media guruh bitta albomga. Muvaffaqiyat faqat storage + DB yozuvidan keyin (👍 reaksiya).
   Takroriy update_id e'tiborsiz qoldiriladi. `/stop` yoki saytdagi tugma bilan uzish.
7. **AI**: owner rozilik matnini o'qib yoqadi. Rasmlar uchun o'zbekcha tavsif + teglar ("AI" belgisi, tahrirlash mumkin).
   AI qidiruv so'rovni filtrlarga aylantiradi (ko'rinadigan chiplar). Gemini xatosida oddiy qidiruv ishlaydi. Kunlik limit `AI_DAILY_LIMIT`.
   Odamlarni tanish, ism, yosh, millat, qarindoshlik taxmin qilish taqiqlangan (prompt + saqlanmaydi).
8. **Oila daraxti**: odam qo'shish (to'liq bo'lmagan sanalar: `YYYY`, `YYYY-MM`, `YYYY-MM-DD`), ota-ona/farzand (biologik/asrab olingan/o'gay), turmush o'rtoq.
   O'z-o'ziga bog'lanish, dublikat, ajdodlar tsikli va 2 tadan ortiq biologik ota-ona rad etiladi. Zoom/pan (sichqoncha, sensor, klaviatura) + ro'yxat ko'rinishi.
   Rasmlarda odamlarni qo'lda belgilash; odam sahifasida uning rasmlari.

## Xavfsizlik

Server tomonida har bir amal uchun sessiya + rol + `family_id` tekshiruvi; sessiya tokeni faqat SHA-256 holida saqlanadi;
cookie `httpOnly`, `SameSite=Lax`, prod'da `Secure`; route handler mutatsiyalarida Origin tekshiruvi; login/taklif/yuklash/AI uchun rate limit;
fayl turini kontent bo'yicha aniqlash; storage kalitlari serverda yasaladi; Telegram fayl yo'li tekshiriladi va faqat sozlangan API manziliga murojaat qilinadi (SSRF yo'q);
GPS faqat originalda qoladi, UI va hosilalarda yo'q; loglarda token/parol/kalit yo'q; CSP va xavfsizlik sarlavhalari.

## Bosqichlar

1. Karkas, migratsiya, auth, rollar. 2. Yuklash, qayta ishlash, galereya, albomlar, savat. 3. Telegram. 4. AI. 5. Oila daraxti. 6. Testlar, brauzerda tekshirish, Docker, README.

## Xarajat omillari

VPS (~€5–10/oy), R2 saqlash (~$0.015/GB-oy, egress bepul), video transkod (CPU vaqti), Gemini (bepul tarif: ma'lumotlar Google tomonidan ishlatilishi mumkin; to'lovli tarif — tokenlar bo'yicha).
