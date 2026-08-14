# ⭐ ড্যাশবোর্ড প্রোডাকশনে চালানোর ইমেজ।
#
# ⚠️ এতদিন এটা ছিল না — `docker compose up -d` শুধু postgres ও api তুলত,
#    আর ড্যাশবোর্ড চালানোর একমাত্র পথ ছিল `npm run dev` (Vite-এর ডেভ
#    সার্ভার) হাতে চালিয়ে রাখা। অর্থাৎ সার্ভার PC রিবুট হলে মালিক আর
#    কোনো পাতা দেখতে পেতেন না, যতক্ষণ না কেউ টার্মিনাল খুলে কমান্ডটা
#    আবার চালাত।

# ── build ───────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# ── ভার্সন ───────────────────────────────────────────────────────────────────
# ⭐⭐ সংখ্যাটা **হাতে লেখা হয় না, git থেকে আসে** — আর সেটাই পুরো জিনিসটার
#    মূল কথা। হাতে বাড়াতে হলে একদিন কেউ ভুলবে, আর তখন পর্দার ভার্সন
#    **মিথ্যা** বলবে: মালিক ভাববেন নতুন কোড চলছে, আসলে পুরোনোটাই।
#    ⚠️ ভুল ভার্সন না-থাকা ভার্সনের চেয়ে খারাপ।
#
# ⚠️ ডিফল্ট `dev`/`local` — কেউ git ছাড়া (বা `vps-update.sh` ছাড়া) বিল্ড
#    করলে ইমেজ তবু তৈরি হয়, শুধু সৎভাবে "dev" লেখে।
ARG APP_BUILD=dev
ARG APP_COMMIT=local
ARG APP_BUILT_AT=

ENV VITE_APP_BUILD=$APP_BUILD
ENV VITE_APP_COMMIT=$APP_COMMIT
ENV VITE_APP_BUILT_AT=$APP_BUILT_AT

# ⚠️ `npm run build` = `tsc -b && vite build` — টাইপ ভাঙলে ইমেজই তৈরি হবে না।
#    ইচ্ছাকৃত: ভাঙা ড্যাশবোর্ড ডিপ্লয় হওয়ার চেয়ে বিল্ড থেমে যাওয়া ভালো।
RUN npm run build

# ── Caddy + rate-limit প্লাগইন ──────────────────────────────────────────────
# ⭐⭐ **R6 / G116** — Caddy-তে rate limit **বিল্ট-ইন নেই**, প্লাগইন লাগে।
#    তাই বাইনারিটা `xcaddy` দিয়ে নতুন করে বানানো হয়।
#
# ⚠️ এই ধাপটা বিল্ডে ~১–২ মিনিট যোগ করে আর **নেটওয়ার্ক লাগে** (প্লাগইন
#    নামায়)। বিনিময়ে যা পাওয়া যায়: লগইনের বন্যা **অ্যাপে পৌঁছানোর আগেই**
#    থামে। অ্যাপের নিজের থ্রটল (`login-throttle.service.ts`) ভুল
#    পাসওয়ার্ড **গোনে**, কিন্তু প্রতিটা চেষ্টা তবু NestJS-এ ঢোকে, DB-তে
#    ইউজার খোঁজে আর bcrypt চালায় — অর্থাৎ CPU খরচ হয়। দুটো স্তর দুটো
#    আলাদা জিনিস ঠেকায়: **প্রান্তে হার, অ্যাপে অনুমান।**
#
# ⚠️ প্লাগইনটা Caddy-র নিজের লেখক (mholt) রক্ষণাবেক্ষণ করেন, কিন্তু এখনো
#    ০.x — তাই ভার্সন **পিন করা**। পিন না করলে একদিন বিল্ড নিজে থেকেই
#    নতুন সংস্করণ টেনে আনত, আর ভাঙলে কারণ খুঁজে পাওয়া কঠিন হতো।
FROM caddy:2-builder-alpine AS caddy-build
RUN xcaddy build \
      --with github.com/mholt/caddy-ratelimit@v0.1.0

# ── runtime ─────────────────────────────────────────────────────────────────
# ⭐ Caddy বেছে নেওয়া হয়েছে nginx-এর বদলে: কনফিগ ছোট, SPA-র fallback আর
#    gzip ডিফল্টে আসে, আর দরকার হলে TLS-ও এক লাইনে (deploy/README § ৬)।
FROM caddy:2-alpine AS runtime

# ⚠️ ডিফল্ট বাইনারিটা বদলে দেওয়া হয় — নইলে `rate_limit` ডিরেক্টিভটা অচেনা
#    থেকে যেত আর Caddy **চালুই হতো না** ("unrecognized directive")।
COPY --from=caddy-build /usr/bin/caddy /usr/bin/caddy

ENV TZ=Asia/Dhaka
RUN apk add --no-cache tzdata

# ⭐ PWA-র ফাইলগুলোও এই এক লাইনেই যায় — আলাদা কিছু করতে হয় না:
#   · `public/` (manifest, favicon, icons) — Vite হুবহু `dist/`-এ কপি করে
#   · `dist/sw.js` — `vite.config.ts`-এর `oxeio-service-worker` প্লাগইন বানায়
# ⚠️ `.dockerignore`-এ কোনোদিন `public` যোগ করবেন না। করলে বিল্ড সফল হতো,
#    অ্যাপও চলত — শুধু আইকন উধাও, আর PWA **ইনস্টলই করা যেত না** (manifest
#    ছাড়া ব্রাউজার "Add to Home screen" দেখায় না)। নীরব ব্যর্থতা।
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 8080
