"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyOutTheDoorPricing, previewOutTheDoorPricing, type QuotedLine, type OutTheDoorPreview } from "@/app/(app)/repair-orders/out-the-door-actions";

type Entry = QuotedLine & { key: number };
const currency = (value: number | string) => Number(value).toLocaleString("en-US", { style:"currency", currency:"USD" });
const initial: Entry[] = [
  {key:1,kind:"part",description:"Part 1",quotedPrice:""},
  {key:2,kind:"labor",description:"Labor 1",quotedPrice:""},
];
export function OutTheDoorPricing({ repairOrderId }: { repairOrderId:string }) {
  const router=useRouter();
  const [open,setOpen]=useState(false);
  const [rows,setRows]=useState<Entry[]>(initial);
  const [nextKey,setNextKey]=useState(3);
  const [preview,setPreview]=useState<OutTheDoorPreview|null>(null);
  const [error,setError]=useState("");
  const [pending,startTransition]=useTransition();
  const invalidate=()=>{setPreview(null);setError("");};
  const update=(key:number,field:"description"|"quotedPrice",value:string)=>{
    setRows(old=>old.map(row=>row.key===key?{...row,[field]:value}:row));invalidate();
  };
  const add=(kind:"part"|"labor")=>{
    const number=rows.filter(r=>r.kind===kind).length+1;
    setRows(old=>[...old,{key:nextKey,kind,description:`${kind==="part"?"Part":"Labor"} ${number}`,quotedPrice:""}]);
    setNextKey(n=>n+1);invalidate();
  };
  const remove=(key:number)=>{setRows(old=>old.filter(r=>r.key!==key));invalidate();};
  const data=()=>rows.map(({kind,description,quotedPrice})=>({kind,description,quotedPrice}));
  const valid=rows.length>0&&rows.every(r=>r.quotedPrice!==""&&Number.isFinite(Number(r.quotedPrice))&&Number(r.quotedPrice)>=0)&&rows.some(r=>Number(r.quotedPrice)>0);
  const total=rows.reduce((sum,row)=>sum+(Number(row.quotedPrice)||0),0);
  return <section className="mt-4 w-full min-w-0 border-t border-slate-200 px-4 py-4 sm:px-5">
    <button type="button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}
      className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-left text-sm font-semibold text-slate-900 hover:border-brand-primary hover:bg-brand-subtle focus-visible:outline-2 focus-visible:outline-brand-primary">
      <span>Out-the-Door Pricing</span>
      <span className="text-lg text-brand-primary" aria-hidden="true">{open?"−":"+"}</span>
    </button>
    {open&&<div className="mt-3 min-w-0 space-y-4">
      <p className="text-xs leading-5 text-slate-600">Add parts and labor at the prices promised to the customer. Part prices include tax; labor prices include shop supplies and applicable tax. PlumWorks will create the RO lines after your review.</p>
      {(["part","labor"] as const).map(kind=><div key={kind} className="min-w-0 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900">{kind==="part"?"Parts (tax included)":"Labor (supplies included)"}</h3>
          <button type="button" disabled={pending||rows.length>=30} onClick={()=>add(kind)}
            className="min-h-9 rounded-lg border border-brand-primary bg-white px-3 py-1.5 text-sm font-semibold text-brand-primary hover:bg-brand-subtle disabled:opacity-40">+ Add {kind==="part"?"Part":"Labor"}</button>
        </div>
        {rows.filter(r=>r.kind===kind).length===0&&<p className="text-xs text-slate-500">No {kind} items yet.</p>}
        {rows.filter(r=>r.kind===kind).map((row,index)=><div key={row.key} className="min-w-0 rounded-lg border border-slate-200 bg-white p-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600">{kind==="part"?"Part":"Labor"} {index+1}</span>
            <button type="button" onClick={()=>remove(row.key)} disabled={pending} className="rounded px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50">Remove</button>
          </div>
          <label className="block text-xs font-semibold text-slate-700">Description (editable later)
            <input value={row.description} onChange={e=>update(row.key,"description",e.target.value)} maxLength={500}
              className="mt-1 block min-h-10 w-full min-w-0 rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-950"/>
          </label>
          <label className="mt-2 block text-xs font-semibold text-slate-700">Out-the-door price ($)
            <input type="number" inputMode="decimal" min="0" max="10000" step="0.01" placeholder="0.00" value={row.quotedPrice}
              onChange={e=>update(row.key,"quotedPrice",e.target.value)}
              className="mt-1 block min-h-10 w-full min-w-0 rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-950"/>
          </label>
        </div>)}
      </div>)}
      <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white p-3">
        <span className="text-sm font-bold text-slate-800">Promised total</span>
        <span className="text-lg font-bold tabular-nums text-slate-950">{currency(total)}</span>
      </div>
      <button type="button" disabled={pending||!valid} onClick={()=>startTransition(async()=>{
        invalidate();const result=await previewOutTheDoorPricing(repairOrderId,data());
        if(result.ok)setPreview(result.preview);else setError(result.message);
      })} className="min-h-11 w-full rounded-lg bg-brand-primary px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
        {pending?"Calculating…":"Calculate & Review"}
      </button>
      {preview&&<div className="space-y-3 rounded-xl border border-slate-300 bg-white p-3 text-sm">
        <h3 className="font-bold text-slate-900">Review the RO lines to be created</h3>
        <dl className="space-y-2">
          {preview.lines.map((line,i)=><div key={i} className="flex justify-between gap-3 border-b border-slate-100 pb-2">
            <dt className="min-w-0 break-words text-slate-700">{line.description}<span className="block text-xs text-slate-500">{line.kind==="part"?"Part":"Labor"} · quoted {currency(line.quotedPrice)}</span></dt>
            <dd className="shrink-0 font-medium tabular-nums">{currency(line.priceBeforeFees)}</dd>
          </div>)}
          <div className="flex justify-between"><dt>Parts before tax</dt><dd>{currency(preview.partsTotal)}</dd></div>
          <div className="flex justify-between"><dt>Labor before supplies</dt><dd>{currency(preview.laborTotal)}</dd></div>
          <div className="flex justify-between"><dt>Shop supplies</dt><dd>{currency(preview.shopSupplies)}</dd></div>
          <div className="flex justify-between"><dt>Tax</dt><dd>{currency(preview.tax)}</dd></div>
          <div className="flex justify-between border-t border-slate-300 pt-2 font-bold"><dt>Final estimate</dt><dd>{currency(preview.total)}</dd></div>
        </dl>
        <p className="text-xs text-slate-600">All generated lines use quantity 1 or labor hours 1. You can edit descriptions afterward. Changing quantities, rates, or eligibility later may change the final total.</p>
        <button type="button" disabled={pending} onClick={()=>startTransition(async()=>{
          const result=await applyOutTheDoorPricing(repairOrderId,data(),preview);
          if(!result.ok){setError(result.message);setPreview(null);return;}
          setRows(initial);setNextKey(3);setPreview(null);setOpen(false);setError("");router.refresh();
        })} className="min-h-11 w-full rounded-lg bg-brand-primary px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
          {pending?"Saving…":"Create RO Lines & Save"}
        </button>
      </div>}
      {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}
    </div>}
  </section>;
}
