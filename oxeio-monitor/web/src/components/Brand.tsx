/** লোগোর অনুকরণে — সাদা লেখা, লাল X */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-semibold tracking-tight ${className}`}>
      o<span className="text-brand">X</span>eio
    </span>
  );
}

export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`grid size-7 flex-none place-items-center rounded-md bg-white text-[11px] font-bold tracking-tight text-black ${className}`}
    >
      o<span className="text-brand">X</span>
    </span>
  );
}
