# ── deps ────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci && npx prisma generate

# ── build ───────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ── runtime ─────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
ENV TZ=Asia/Dhaka

# ⭐ একই ভার্সন ওয়েবের সাথে — `/health` এটা ফেরত দেয়, আর ড্যাশবোর্ড দুটো
#    মিলিয়ে দেখে। ⚠️ অর্ধেক ডিপ্লয় (নতুন ওয়েব, পুরোনো api) নইলে সম্পূর্ণ
#    নীরব থাকত, আর "ফিক্সটা তো বসিয়েছি, কাজ করছে না কেন" প্রশ্নের উত্তর
#    খুঁজতে ঘণ্টা যেত।
ARG APP_BUILD=dev
ARG APP_COMMIT=local
ENV APP_BUILD=$APP_BUILD
ENV APP_COMMIT=$APP_COMMIT
WORKDIR /app

# ⭐⭐ `postgresql16-client` — রাতের ব্যাকআপের `pg_dump` (K02)।
#
# ⚠️⚠️ এটা না থাকায় ব্যাকআপ **কোনোদিন একবারও চলেনি**, আর ব্যর্থতাটা ছিল
# প্রায় নীরব: অ্যালার্ট উঠত ঠিকই, কিন্তু ৪৬টা খোলা অ্যালার্টের ভিড়ে
# "The nightly backup failed" আলাদা করে কেউ পড়েনি (১৫ আগস্ট ধরা পড়ে)।
#
# ⚠️ **মেজর ভার্সন মিলতে হবে** — সার্ভার Postgres ১৬, তাই ক্লায়েন্টও ১৬।
# পুরোনো `pg_dump` নতুন সার্ভার দেখলে সরাসরি অস্বীকার করে ("server version
# mismatch"), আর তখন ব্যর্থতাটা আবার রোজ রাতে ফিরে আসত।
#
# ⭐ বিকল্প ছিল হোস্টের docker সকেট api কনটেইনারে খুলে দেওয়া
# (`BACKUP_DOCKER_CONTAINER`) — নেওয়া হয়নি: ওটা কার্যত হোস্টে root-সমান
# ক্ষমতা, আর এখানে দরকার কেবল একটা ক্লায়েন্ট বাইনারি (~২ MB) যা
# নেটওয়ার্ক দিয়েই ডাম্প নিতে পারে।
RUN apk add --no-cache tzdata dumb-init postgresql16-client

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force

# generated prisma client + query engine (prisma CLI নেই prod deps-এ)
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist

# স্ক্রিনশট এখানে mount হয় — node ইউজারের লেখার অধিকার লাগবে
RUN mkdir -p /data/storage && chown -R node:node /data/storage
USER node

EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
