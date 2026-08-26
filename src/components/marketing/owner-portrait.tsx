import Image from "next/image";

type OwnerPortraitProps = {
  name: string;
  imageUrl?: string | null;
  imageAlt?: string | null;
  compact?: boolean;
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "Owner";
}

export function OwnerPortrait({ name, imageUrl, imageAlt, compact = false }: OwnerPortraitProps) {
  if (imageUrl) {
    return <Image src={imageUrl} alt={imageAlt || `${name}, owner`} width={compact ? 96 : 240} height={compact ? 120 : 300} sizes={compact ? "96px" : "(min-width: 768px) 240px, 100vw"} className={compact ? "h-[120px] w-24 shrink-0 rounded-xl object-cover" : "h-auto w-full object-contain"} />;
  }
  return <div data-owner-placeholder aria-label={`${name} portrait placeholder`} className={compact ? "flex h-[120px] w-24 shrink-0 items-center justify-center rounded-xl bg-slate-200 text-2xl font-black tracking-wider text-slate-600" : "flex min-h-52 w-full items-center justify-center bg-slate-100 text-5xl font-black tracking-wider text-slate-500 md:min-h-[300px]"}>{initials(name)}</div>;
}
