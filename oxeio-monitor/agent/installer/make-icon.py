"""
oXeio ব্র্যান্ড আইকন → Windows `.ico`

⭐ জ্যামিতিটা `web/public/favicon.svg`-এর **হুবহু** — লাল টাইল (rx ১১২/৫১২),
   সাদা X, ৫১২ বাক্সে। ওই ফাইলটাই সব আইকনের একমাত্র উৎস, তাই সংখ্যাগুলো
   এখানে আবার "সুন্দর করে" লেখা হয়নি; স্কেল করে নেওয়া হয়েছে।

⚠️⚠️ **SVG parse করা হয় না — ইচ্ছাকৃত।** cairosvg/Inkscape এই মেশিনে নেই,
   আর একটা নতুন নির্ভরতা যোগ করলে বিল্ডটা অন্য কারো মেশিনে ভাঙত। আকৃতিটা
   মাত্র তিনটে path, তাই সরাসরি আঁকাই নিরাপদ।

⚠️ প্রতিটা মাপ **আলাদা করে ৮× সুপারস্যাম্পল করে** আঁকা হয়, একটা বড় ছবি
   ছোট করে নয়। ১৬px-এ পার্থক্যটা স্পষ্ট: ছোট করে নিলে X-এর ডাঁটি ধূসর
   হয়ে মিলিয়ে যায়।
"""

import io
import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw

# ── favicon.svg-এর সংখ্যা, ৫১২ বাক্সে ──────────────────────────────────────
BOX = 512.0
CORNER = 112.0 / BOX          # টাইলের কোণার ব্যাসার্ধ
RED = (237, 28, 36, 255)      # #ed1c24
WHITE = (255, 255, 255, 255)

# X-এর দুটো ডাঁটি — SVG-র path দুটো হুবহু
STROKES = (
    ((102, 102), (196, 102), (410, 410), (316, 410)),
    ((316, 102), (410, 102), (196, 410), (102, 410)),
)

SS = 8  # সুপারস্যাম্পল গুণক

#: ⚠️ ২৫৬ থাকতেই হবে — Windows ১০/১১-এর বড় আইকন ভিউ ওটাই চায়, আর না
#: থাকলে ৪৮px-টা টেনে বড় করে ঝাপসা দেখায়।
SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)


def render(px: int) -> Image.Image:
    """এক মাপের আইকন — নিজের মাপেই আঁকা, তারপর একবার নামানো।"""
    n = px * SS
    k = n / BOX

    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # টাইল — কোণা পর্যন্ত ভরাট, মাঝে কোনো স্বচ্ছতা নেই
    d.rounded_rectangle((0, 0, n - 1, n - 1), radius=CORNER * n, fill=RED)

    for stroke in STROKES:
        d.polygon([(x * k, y * k) for x, y in stroke], fill=WHITE)

    # ⚠️ LANCZOS — BILINEAR-এ ছোট মাপে ডাঁটির কিনারা নরম হয়ে যায়
    return img.resize((px, px), Image.LANCZOS)


def write_ico(path: Path, images: list[Image.Image]) -> None:
    """
    ICO ফাইল নিজে হাতে লেখা।

    ⚠️⚠️ Pillow-র `save(format='ICO')` ২৫৬-র বেশি মাপ ফেলে দেয় **আর**
    ছোট মাপগুলো নিজে থেকে resize করে বানায় — অর্থাৎ আমাদের আলাদা করে
    আঁকা ১৬px-টা ব্যবহারই করত না, আর পুরো কষ্টটা বৃথা যেত।
    """
    blobs = []
    for img in images:
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        blobs.append(buf.getvalue())

    header = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)

    entries = b""
    for img, blob in zip(images, blobs):
        w = 0 if img.width >= 256 else img.width
        h = 0 if img.height >= 256 else img.height
        entries += struct.pack(
            "<BBBBHHII", w, h, 0, 0, 1, 32, len(blob), offset
        )
        offset += len(blob)

    path.write_bytes(header + entries + b"".join(blobs))


def main() -> int:
    # ⚠️ Windows কনসোল ডিফল্টে cp1252 — ইউনিকোড ছাপাতে গেলে স্ক্রিপ্টটা
    #    ফাইল লেখার **পরে** ক্র্যাশ করত, আর বিল্ড ভুল করে ব্যর্থ দেখাত।
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    out = Path(sys.argv[1] if len(sys.argv) > 1 else "oxeio.ico")
    images = [render(s) for s in SIZES]
    write_ico(out, images)

    print(f"✅ {out} · {', '.join(str(s) for s in SIZES)} · {out.stat().st_size:,} bytes")

    # ⭐ চোখে দেখার জন্য একটা PNG-ও — ছোট মাপে পড়া যাচ্ছে কি না সেটা
    #    কোড পড়ে বোঝা যায় না, তাকিয়ে দেখতে হয়।
    preview = out.with_suffix(".preview.png")
    strip = Image.new("RGBA", (sum(SIZES) + 8 * len(SIZES), 256), (13, 17, 23, 255))
    x = 0
    for img, s in zip(images, SIZES):
        strip.paste(img, (x, (256 - s) // 2), img)
        x += s + 8
    strip.save(preview)
    print(f"   preview → {preview}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
