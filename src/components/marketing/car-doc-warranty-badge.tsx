import type { WarrantyProgram } from "@/lib/marketing-warranty";

/**
 * Original Car Doc informational artwork, not an official warranty-provider logo.
 * Always display alongside provider attribution and qualification conditions.
 */
export function CarDocWarrantyBadge({ program, className = "" }: { program: WarrantyProgram; className?: string }) {
  const isThreeYear = program.id === "protection-plus";
  const years = isThreeYear ? "3" : "2";
  const miles = isThreeYear ? "36,000" : "24,000";
  const gradientId = `badge-red-${years}`;
  const metalId = `badge-metal-${years}`;

  return <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 360 400"
    role="img"
    aria-label={`Car Doc informational badge: up to ${program.duration} or ${program.miles} for qualifying repairs through ${program.title}; terms apply`}
    className={className}
  >
    <defs>
      <linearGradient id={metalId} x1="0" y1="0" x2="1" y2="0">
        <stop stopColor="#8d949e" />
        <stop offset=".18" stopColor="#f9fafb" />
        <stop offset=".45" stopColor="#a7aeb8" />
        <stop offset=".72" stopColor="#f4f4f5" />
        <stop offset="1" stopColor="#777f8b" />
      </linearGradient>
      <linearGradient id={gradientId} x1="0" y1="0" x2=".9" y2="1">
        <stop stopColor="#790d14" />
        <stop offset=".45" stopColor="#bd171c" />
        <stop offset=".7" stopColor="#a10d12" />
        <stop offset="1" stopColor="#55070c" />
      </linearGradient>
    </defs>
    <path d="M180 12 338 55V215C338 302 275 360 180 389 85 360 22 302 22 215V55Z" fill={`url(#${metalId})`} stroke="#77808d" strokeWidth="2"/>
    <path d="M180 26 323 65V215C323 291 264 346 180 372 96 346 37 291 37 215V65Z" fill="#161b23" stroke="#fff" strokeOpacity=".55" strokeWidth="2"/>
    <path d="M40 110H320V218C320 290 263 344 180 370 97 344 40 290 40 218Z" fill={`url(#${gradientId})`}/>
    <path d="M53 114H307" stroke="#ff9e93" strokeWidth="2" opacity=".65"/>
    <path d="M105 81 Q180 46 255 81" fill="none" stroke="#e83433" strokeWidth="6" strokeLinecap="round"/>
    <text x="180" y="102" fill="#fff" fontFamily="Arial,Helvetica,sans-serif" fontSize="30" fontWeight="900" textAnchor="middle" letterSpacing="3">CAR DOC</text>
    <text x="180" y="195" fill="#fff" fontFamily="Arial,Helvetica,sans-serif" fontSize="80" fontWeight="900" textAnchor="middle">{years}<tspan fontSize="37" dx="5">YEAR</tspan></text>
    <path d="M45 210H315L302 255H58Z" fill={`url(#${metalId})`} stroke="#fff" strokeWidth="2"/>
    <text x="180" y="244" fill="#111827" fontFamily="Arial,Helvetica,sans-serif" fontSize="30" fontWeight="900" textAnchor="middle">{miles}<tspan fontSize="19"> MILE</tspan></text>
    <text x="180" y="293" fill="#fff" fontFamily="Arial,Helvetica,sans-serif" fontSize="37" fontWeight="900" textAnchor="middle" letterSpacing="1">WARRANTY</text>
    <text x="180" y="321" fill="#fff" fontFamily="Arial,Helvetica,sans-serif" fontSize="14" fontWeight="700" textAnchor="middle" letterSpacing="1">QUALIFYING REPAIRS</text>
    <text x="180" y="351" fill="#fff" fontFamily="Arial,Helvetica,sans-serif" fontSize="13" fontWeight="700" textAnchor="middle" letterSpacing="1">TERMS APPLY</text>
  </svg>;
}
