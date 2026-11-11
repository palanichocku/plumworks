"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { HistoricalDescriptionCombobox } from "@/components/historical-description-combobox";
import { applyOutTheDoorPricing, previewOutTheDoorPricing, type QuotedLine, type OutTheDoorPreview } from "@/app/(app)/repair-orders/out-the-door-actions";

type Entry = QuotedLine & { key: number };
const currency = (value: number | string) => Number(value).toLocaleString("en-US", { style:"currency", currency:"USD" });
const initial: Entry[] = [
  {key:1,kind:"part",description:"",quotedPrice:""},
  {key:2,kind:"labor",description:"",quotedPrice:""},
];
export function OutTheDoorPricing({ repairOrderId }: { repairOrderId:string }) {
  const router=useRouter();
  const [open,setOpen]=useState(false);
  const [rows,setRows]=useState<Entry[]>(initial);
  const [nextKey,setNextKey]=useState(3);
  const [preview,setPreview]=useState<OutTheDoorPreview|null>(null);
  const [error,setError]=useState("");
  const [pending,startTransition]=useTransition();
  const reviewRef=useRef<HTMLDivElement>(null);
  const calculateRef=useRef<HTMLButtonElement>(null);
  const [mounted,setMounted]=useState(false);
  useEffect(()=>setMounted(true),[]);
  useEffect(()=>{
    if(!preview)return;
    const priorOverflow=document.body.style.overflow;
    const lastActive=document.activeElement instanceof HTMLElement?document.activeElement:null;
    document.body.style.overflow="hidden";
    reviewRef.current?.focus();
    const handleKey=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){
        event.preventDefault();
        if(!pending){setPreview(null);calculateRef.current?.focus();}
      }
      if(event.key!=="Tab"||!reviewRef.current)return;
      const elements=Array.from(reviewRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(element=>element.getClientRects().length>0);
      if(!elements.length)return;
      const first=elements[0],last=elements[elements.length-1];
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===reviewRef.current)){
        event.preventDefault();last.focus();
      }else if(!event.shiftKey&&document.activeElement===last){
        event.preventDefault();first.focus();
      }
    };
    document.addEventListener("keydown",handleKey);
    return ()=>{
      document.body.style.overflow=priorOverflow;
      document.removeEventListener("keydown",handleKey);
      if(lastActive?.isConnected)lastActive.focus();
    };
  },[preview,pending]);
  const invalidate=()=>{setPreview(null);setError("");};
  const update=(key:number,field:"description"|"quotedPrice",value:string)=>{
    setRows(old=>old.map(row=>row.key===key?{...row,[field]:value}:row));invalidate();
  };
  const add=(kind:"part"|"labor")=>{
    setRows(old=>[...old,{key:nextKey,kind,description:"",quotedPrice:""}]);
    setNextKey(n=>n+1);invalidate();
  };
  const remove=(key:number)=>{setRows(old=>old.filter(r=>r.key!==key));invalidate();};
  const data=()=>rows.map(({kind,description,quotedPrice})=>({kind,description,quotedPrice}));
  const valid=rows.length>0&&rows.every(r=>r.quotedPrice!==""&&Number.isFinite(Number(r.quotedPrice))&&Number(r.quotedPrice)>=0)&&rows.some(r=>Number(r.quotedPrice)>0);
  const total=rows.reduce((sum,row)=>sum+(Number(row.quotedPrice)||0),0);
  return <section className="w-full min-w-0 rounded-2xl border border-slate-300 bg-white px-4 py-4 shadow-sm sm:px-5">
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
          <div className="min-w-0">
            <HistoricalDescriptionCombobox kind={kind} rowKey={`out-the-door-${row.key}`}
              label="Description (optional — edit now or later)"
              value={row.description} onChange={value=>update(row.key,"description",value)}
              placeholder={kind==="part"?"Part description":"Labor description"}
              inputClass="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950"
              multiline autoGrow />
          </div>
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
      <button ref={calculateRef} type="button" disabled={pending||!valid} onClick={()=>startTransition(async()=>{
        invalidate();const result=await previewOutTheDoorPricing(repairOrderId,data());
        if(result.ok)setPreview(result.preview);else setError(result.message);
      })} className="min-h-11 w-full rounded-lg bg-brand-primary px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
        {pending?"Calculating…":"Calculate & Review"}
      </button>
      {mounted&&preview&&createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 md:p-5" role="presentation">
          <div ref={reviewRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="otd-review-title"
            aria-describedby="otd-review-description"
            className="flex h-[100dvh] w-full min-w-0 flex-col overflow-hidden bg-white text-slate-950 shadow-2xl outline-none md:h-auto md:max-h-[90dvh] md:max-w-5xl md:rounded-2xl md:border md:border-slate-300">
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
              <div className="min-w-0">
                <h2 id="otd-review-title" className="text-lg font-bold sm:text-xl">Review Out-the-Door Pricing</h2>
                <p id="otd-review-description" className="mt-1 text-sm text-slate-600">Review the exact RO lines and charges before saving. No changes are made until you confirm.</p>
              </div>
              <button type="button" aria-label="Back to editing quote" disabled={pending}
                onClick={()=>setPreview(null)}
                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-slate-300 text-xl text-slate-700 hover:bg-slate-50 disabled:opacity-50">×</button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6" data-otd-review-scroll>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-slate-900">Lines to be created</h3>
                <span className="text-xs font-semibold text-slate-600">{preview.lines.length} {preview.lines.length===1?"item":"items"}</span>
              </div>
              <div className="hidden grid-cols-[minmax(0,1fr)_140px_140px] gap-3 rounded-t-lg bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700 sm:grid">
                <span>Description</span><span className="text-right">Quoted price</span><span className="text-right">RO amount</span>
              </div>
              <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 sm:rounded-t-none">
                {preview.lines.map((line,i)=><div key={i} className="grid min-w-0 gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_140px_140px] sm:items-center sm:gap-3">
                  <div className="min-w-0">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{line.kind==="part"?"Part":"Labor"}</span>
                    <p className="break-words text-sm font-medium text-slate-900">{line.description}</p>
                  </div>
                  <div className="flex items-center justify-between text-sm sm:block sm:text-right">
                    <span className="text-xs text-slate-500 sm:hidden">Quoted price</span>
                    <span className="tabular-nums">{currency(line.quotedPrice)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm sm:block sm:text-right">
                    <span className="text-xs text-slate-500 sm:hidden">RO amount</span>
                    <span className="font-semibold tabular-nums">{currency(line.priceBeforeFees)}</span>
                  </div>
                </div>)}
              </div>
              <dl className="ml-auto mt-5 max-w-md space-y-2 rounded-lg bg-slate-50 p-4 text-sm">
                <div className="flex justify-between gap-3"><dt>Parts before tax</dt><dd className="tabular-nums">{currency(preview.partsTotal)}</dd></div>
                <div className="flex justify-between gap-3"><dt>Labor before supplies</dt><dd className="tabular-nums">{currency(preview.laborTotal)}</dd></div>
                <div className="flex justify-between gap-3"><dt>Shop supplies</dt><dd className="tabular-nums">{currency(preview.shopSupplies)}</dd></div>
                <div className="flex justify-between gap-3"><dt>Tax</dt><dd className="tabular-nums">{currency(preview.tax)}</dd></div>
              </dl>
              <p className="mt-4 text-xs leading-5 text-slate-600">Generated lines use quantity 1 or labor hours 1. Descriptions can be edited later. Changing quantities, rates, or supplies eligibility can change the final estimate.</p>
              {error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}
            </div>
            <footer className="shrink-0 border-t border-slate-200 bg-white px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_16px_rgba(15,23,42,0.07)] sm:px-6 sm:pt-4">
              <div className="flex items-center justify-between gap-3 pb-3">
                <span className="font-semibold text-slate-700">Out-the-door total</span>
                <strong className="text-xl font-bold tabular-nums text-slate-950 sm:text-2xl">{currency(preview.total)}</strong>
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" disabled={pending} onClick={()=>setPreview(null)}
                  className="min-h-11 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50">Back to Edit</button>
                <button type="button" disabled={pending} onClick={()=>startTransition(async()=>{
                  const result=await applyOutTheDoorPricing(repairOrderId,data(),preview);
                  if(!result.ok){setError(result.message);setPreview(null);return;}
                  setRows(initial);setNextKey(3);setPreview(null);setOpen(false);setError("");router.refresh();
                })} className="min-h-11 rounded-lg bg-brand-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                  {pending?"Saving…":"Create RO Lines & Save"}
                </button>
              </div>
            </footer>
          </div>
        </div>,document.body
      )}
      {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}
    </div>}
  </section>;
}
