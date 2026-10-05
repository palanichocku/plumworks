import Image from "next/image";

/** Official platform marks used only to identify links to their review profiles. */
export function ReviewPlatformIcon({ platform, size = 22 }: { platform: "google" | "facebook"; size?: number }) {
  return <span aria-hidden="true" className="inline-block shrink-0 overflow-hidden" style={{ width: size, height: size }}>
    <Image
      src={platform === "google" ? "/brand/google-g.png" : "/brand/facebook-logo.svg"}
      alt=""
      width={size}
      height={size}
      className={platform === "google" ? "scale-[3]" : undefined}
    />
  </span>;
}
