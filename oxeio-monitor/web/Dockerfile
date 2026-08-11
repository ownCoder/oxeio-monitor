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

# ⚠️ `npm run build` = `tsc -b && vite build` — টাইপ ভাঙলে ইমেজই তৈরি হবে না।
#    ইচ্ছাকৃত: ভাঙা ড্যাশবোর্ড ডিপ্লয় হওয়ার চেয়ে বিল্ড থেমে যাওয়া ভালো।
RUN npm run build

# ── runtime ─────────────────────────────────────────────────────────────────
# ⭐ Caddy বেছে নেওয়া হয়েছে nginx-এর বদলে: কনফিগ ছোট, SPA-র fallback আর
#    gzip ডিফল্টে আসে, আর দরকার হলে TLS-ও এক লাইনে (deploy/README § ৬)।
FROM caddy:2-alpine AS runtime

ENV TZ=Asia/Dhaka
RUN apk add --no-cache tzdata

COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 8080
