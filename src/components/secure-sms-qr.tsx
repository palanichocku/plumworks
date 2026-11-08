"use client";
import { useMemo } from "react";
import createQr from "@/lib/vendor/qrcode.mjs";

export function SecureSmsQr({ link }: { link: string }) {
 const matrix = useMemo(() => {
   const qr = createQr(0, "M");
   qr.addData(link);
   qr.make();
   const count = qr.getModuleCount();
   const cells: Array<[number, number]> = [];
   for (let y=0;y<count;y++) for(let x=0;x<count;x++) if(qr.isDark(y,x)) cells.push([x,y]);
   return { count, cells };
 }, [link]);
 const size=matrix.count+8;
 return <svg role="img" aria-label="Private customer SMS consent QR code, valid for ten minutes" viewBox={`0 0 ${size} ${size}`} className="mx-auto h-64 w-64 max-w-full rounded-lg bg-white p-2" shapeRendering="crispEdges">
  <rect width={size} height={size} fill="white" />
  {matrix.cells.map(([x,y])=><rect key={`${x}-${y}`} x={x+4} y={y+4} width={1} height={1} fill="black"/>)}
 </svg>;
}
