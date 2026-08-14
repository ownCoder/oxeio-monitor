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

# ── runtime ─────────────────────────────────────────────────────────────────
# ⭐ Caddy বেছে নেওয়া হয়েছে nginx-এর বদলে: কনফিগ ছোট, SPA-র fallback আর
#    gzip ডিফল্টে আসে, আর দরকার হলে TLS-ও এক লাইনে (deploy/README § ৬)।
FROM caddy:2-alpine AS runtime

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
