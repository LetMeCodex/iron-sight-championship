# Backend setup (Phase 1)

Is guide ke steps ek baar follow karne hain. Total time lagbhag 30–40 minute lagega.

## Architecture: kaun kya karta hai

```
Browser (athlete / admin)
   │  sirf /api/* ko call karta hai — database ko kabhi direct nahi chhoota
   ▼
Vercel functions (api/*.js) ── service_role key ──► Supabase Postgres
   │                                                 (RLS on, anon ko koi access nahi)
   └── secret key ──► Razorpay  ◄── webhook ── Razorpay (payment confirm)
```

- **Fee server decide karta hai**, browser nahi. Fees `events` table mein hoti hain, aur admin unhe "Events & Fees" tab se badal sakta hai.
- **Seat lock:** Order banne se pehle relay mein lane 30 minute ke liye hold ho jaati hai. Do log kabhi same lane nahi le sakte, kyunki Postgres advisory lock lagta hai.
- **Payment ko teen jagah se confirm kiya jaata hai.** Teeno Razorpay API se amount aur status khud check karte hain:
  1. Browser se `/api/verify-payment`
  2. Razorpay webhook se `/api/razorpay-webhook` (yeh tab bhi kaam karta hai jab student ne payment ke baad browser band kar diya ho)
  3. Admin panel ke "Sync payments with Razorpay" button se, aur roz chalne wale cron (`/api/cron`) se
- Agar hold expire ho gaya aur relay bhar gayi, phir bhi payment aa gaya: entry **paid** ho jaati hai aur `NO LANE` flag lagta hai. Admin use doosri lane de deta hai. Paisa kabhi "kho" nahi jaata.

## Step 1: Supabase project

1. https://supabase.com par login karke **New project** banao. Region **Mumbai (ap-south-1)** chuno aur strong DB password rakho.
2. **SQL Editor → New query** kholo. [`supabase/schema.sql`](supabase/schema.sql) ka poora content paste karke **Run** karo.
3. Ek nayi query mein [`supabase/seed.sql`](supabase/seed.sql) paste karke **Run** karo. Isse 70 events (circular wali fees ke saath), 6 relays aur default settings ban jaayengi.
4. **Project Settings → API** se do cheezein copy karo:
   - Project URL → `SUPABASE_URL`
   - `service_role` secret → `SUPABASE_SERVICE_ROLE_KEY` (**anon key nahi**)

> **Free plan ke baare mein:** 7 din tak koi activity na ho toh project pause ho jaata hai. Daily cron (`vercel.json`) isse active rakhta hai. Phir bhi registration aur tournament ke dino ke liye **Pro plan ($25/month)** lena behtar hai: pause nahi hoga aur daily backup bhi milega.

## Step 2: Razorpay

1. Pehle **Test mode** mein kaam karo. **Account & Settings → API Keys** se `rzp_test_...` key aur secret lo.
2. **Webhooks → Add new webhook** banao:
   - URL: `https://<your-domain>/api/razorpay-webhook`
   - Secret: koi bhi random string (yahi `RAZORPAY_WEBHOOK_SECRET` banegi)
   - Events: `payment.captured`, `payment.failed`, `order.paid`
3. Live jaane se pehle KYC poora karo, **Live** keys generate karo, aur live mode mein bhi webhook dobara banao (test aur live ke webhooks alag hote hain).

## Step 3: Vercel environment variables

**Project → Settings → Environment Variables** mein [`.env.example`](.env.example) ki saari keys daalo:

| Key | Value |
|---|---|
| `SUPABASE_URL` | Step 1 wala URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Step 1 wala service_role secret |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Step 2 wali keys |
| `RAZORPAY_WEBHOOK_SECRET` | Step 2 wala webhook secret |
| `ADMIN_PASSWORD` | Admin login ka strong password |
| `ADMIN_SESSION_SECRET` | 32+ characters ki random string |
| `CRON_SECRET` | Random string |

Random string banane ke liye:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Keys add karne ke baad **Redeploy** zaroor karo, warna nayi keys apply nahi hongi.

## Step 4: Live test (test mode mein)

1. `/admin` kholo, password se login karo, aur **Settings** check karo: dates, match days, deadline.
2. **Events & Fees** mein fees circular se match karo.
3. `/register` se ek registration karo. Razorpay test mode ka UPI `success@razorpay` ya test card use karo.
4. Check karo:
   - Success screen par `NSC-2026-xxx`, bib number aur lane dikh rahi hai
   - `/track-booking` par mobile number daalne se pass mil raha hai
   - Admin → Athletes mein entry **PAID** dikh rahi hai
5. Ek baar payment ke beech mein browser band karke dekho. 1–2 minute baad webhook entry ko paid kar dega.
6. Admin → Results mein ek score daalo. Woh `/live-scoring` par dikhna chahiye.

## Local testing (bina internet ke DB / Razorpay)

```bash
npm install
```

```bash
npm test
```

`npm test` fake database aur fake Razorpay ke saath SQL aur API tests chalata hai. `npm run test:ui` Edge mein asli pages bhi test karta hai. Kisi bhi code change ke baad aur tournament se pehle yeh zaroor chalao.

## Admin panel mein kya-kya hai

- **Overview:** paid entries, revenue, relay-wise seats, `NO LANE` alert, aur "Sync payments with Razorpay" button
- **Athletes:** search aur filter, walk-in entry, edit, mark paid (cash/UPI), cancel, delete, Excel import/export aur template
- **Results:** category-wise series entry (S1–S6, 10x, status, rank override), Excel import/export, aur public site par results dikhana ya chhupana
- **Events & Fees / Relays:** category, fee, age limit, active/inactive, relay timing aur seats
- **Settings:** registration open/close, deadline, maintenance mode, match days, venue, helpline, notice bar aur rules
- **Backup & Logs:** full JSON backup (restore ho sakta hai), Excel backup, restore, printable roster (day/relay/lane), admin activity aur payment logs
