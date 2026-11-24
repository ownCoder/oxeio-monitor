# কাজের স্থায়ী নির্দেশনা

## কাজ শেষে documentation — মালিকের নির্দেশ, ২৭ সেপ্টেম্বর ২০২৬

- প্রতিটি কাজ শেষ হলে সংশ্লিষ্ট docs আপডেট করতে হবে; আলাদা করে মনে করানোর অপেক্ষা নয়।
- `docs/current-state.md` হবে অন্য PC বা নতুন session থেকে কাজ ধরার প্রথম নথি। এতে latest deployed build/commit, শেষ পরিবর্তন, যাচাই, বাকি কাজ এবং source কোথায় আছে লিখতে হবে।
- Implementation, tested এবং deployed অবস্থা আলাদা করে লিখতে হবে। Local-only পরিবর্তনকে live বলা যাবে না।
- সংশ্লিষ্ট feature/build/deployment record ও README-এর current status মিলিয়ে রাখতে হবে। পুরোনো release record ঐতিহাসিক প্রমাণ হিসেবে রাখতে হবে।
- কোন shared location-এ docs সংরক্ষিত হয়েছে তা যাচাই করে জানাতে হবে। Local file বদলানো মানেই অন্য PC sync হয়েছে নয়; GitHub push বা PC sync না হলে তা হয়েছে বলা যাবে না।
- বর্তমান handoff-এর shared copy VPS `/opt/oxeio/docs/current-state.md`। অন্য PC থেকে শুরুতে এই নথি ও live release source মিলিয়ে নিতে হবে; পুরোনো checkout থেকে deploy করা যাবে না।
- Password, private key বা অন্য secret documentation-এ লেখা যাবে না।

## Browser — মালিকের নির্দেশ, ২৭ সেপ্টেম্বর ২০২৬

- সব browser কাজের জন্য **Google Chrome** ব্যবহার করতে হবে।
- **Internal / in-app browser ব্যবহার করা যাবে না।** Local preview, UI পরীক্ষা, screenshot এবং browser দিয়ে অন্য সাইটে কাজ করার ক্ষেত্রেও একই নির্দেশ প্রযোজ্য।
- মালিক জানিয়েছেন, তাঁর Google Chrome-এ ChatGPT extension ইনস্টল করা আছে। Browser কাজের সময় সেই Chrome connection ব্যবহার করতে হবে। এই নথি extension-এর সংযোগ পরীক্ষা করা হয়েছে এমন দাবি করে না।
- Chrome বা extension-এর সংযোগ পাওয়া না গেলে আগে সেই সংযোগের সমস্যা সমাধান করতে হবে; নিজে থেকে internal browser-এ যাওয়া যাবে না। সমাধান করতে ব্যবহারকারীর পদক্ষেপ দরকার হলে নির্দিষ্ট প্রয়োজনটি জানাতে হবে।
- পরবর্তী কাজ ও session-এ এই পছন্দ বহাল থাকবে, যতক্ষণ মালিক নতুন নির্দেশ না দেন।
