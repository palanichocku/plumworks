import Image from "next/image";

/** Official platform marks used only to identify links to their review profiles. */
export function ReviewPlatformIcon({ platform, size = 22 }: { platform: "google" | "facebook"; size?: number }) {
  return <Image
    src={platform === "google" ? "/brand/google-g.png" : "/brand/facebook-logo.svg"}
    alt=""
    aria-hidden="true"
    width={size}
    height={size}
    className="shrink-0"
  />;
}
