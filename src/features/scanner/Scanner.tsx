import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, ScanText, RefreshCw, AlertTriangle, CheckCircle2, QrCode } from 'lucide-react';
import { createWorker } from 'tesseract.js';
import { BrowserMultiFormatReader } from '@zxing/browser';
import type { ImageInputSource } from './types';
import { extractDateCandidates, firstTextValue } from './dateExtraction';
import type { DateCandidate } from './dateExtraction';

interface Props { onImageSelected?: (file: File, source: ImageInputSource) => void; }
interface Photo { file: File; url: string; }
interface CodeDetails { text: string; format: string; gtin?: string; batch?: string; expiry?: string; bestBefore?: string; production?: string; serial?: string; }

function preprocess(file: File): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error('Canvas unavailable')); return; }
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i=0;i<pixels.data.length;i+=4) {
        const grey = .299*pixels.data[i]+.587*pixels.data[i+1]+.114*pixels.data[i+2];
        const adjusted = Math.max(0,Math.min(255,(grey-128)*1.4+128));
        pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=adjusted;
      }
      ctx.putImageData(pixels,0,0); URL.revokeObjectURL(url); resolve(canvas);
    };
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Image could not load'));};
    img.src=url;
  });
}

function parseCode(raw: string, format: string): CodeDetails {
  const source = raw.replace(/^\](?:C1|d2|Q3)/, '');
  const values: Record<string, string> = {};
  const known = ['01', '10', '11', '13', '15', '16', '17', '21'];
  const fixed: Record<string, number> = { '01': 14, '11': 6, '13': 6, '15': 6, '16': 6, '17': 6 };
  const save = (ai: string, value: string) => { if (value) values[ai] = value; };
  if (/\(\d{2,4}\)/.test(source)) {
    const re = /\((\d{2,4})\)([^()]*)/g;
    for (const match of source.matchAll(re)) save(match[1], match[2].trim());
  } else {
    let i = 0;
    while (i < source.length) {
      if (source.charCodeAt(i) === 29) { i++; continue; }
      const ai = known.find(candidate => source.startsWith(candidate, i));
      if (!ai) { i++; continue; }
      i += ai.length;
      if (fixed[ai]) {
        const value = source.slice(i, i + fixed[ai]);
        if (value.length !== fixed[ai]) break;
        save(ai, value); i += fixed[ai];
      } else {
        const separator = source.indexOf(String.fromCharCode(29), i);
        const value = (separator < 0 ? source.slice(i) : source.slice(i, separator)).slice(0, 20);
        save(ai, value);
        i += separator < 0 ? source.length - i : value.length;
      }
    }
  }
  const gs1Date = (value?: string) => {
    if (!value || !/^\d{6}$/.test(value)) return undefined;
    const yy = Number(value.slice(0, 2)), month = Number(value.slice(2, 4)), day = Number(value.slice(4, 6));
    if (month < 1 || month > 12 || day > 31) return undefined;
    const actualDay = day === 0 ? new Date(2000 + yy, month, 0).getDate() : day;
    return String(actualDay).padStart(2, '0') + '/' + String(month).padStart(2, '0') + '/20' + value.slice(0, 2);
  };
  return { text: raw, format, gtin: values['01'], batch: values['10'],
    production: gs1Date(values['11']), bestBefore: gs1Date(values['15']),
    expiry: gs1Date(values['17']), serial: values['21'] };
}

async function readCode(file:File):Promise<CodeDetails|null>{
  const url=URL.createObjectURL(file); const image=new Image(); image.src=url;
  try {
    await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('Image load failed'));});
    const result=await new BrowserMultiFormatReader().decodeFromImageElement(image);
    return parseCode(result.getText(),String(result.getBarcodeFormat()));
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}

export default function Scanner({onImageSelected}:Props){
  const fullCamera=useRef<HTMLInputElement>(null), fullGallery=useRef<HTMLInputElement>(null);
  const closeCamera=useRef<HTMLInputElement>(null), closeGallery=useRef<HTMLInputElement>(null);
  const [full,setFull]=useState<Photo|null>(null),[close,setClose]=useState<Photo|null>(null);
  const [busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState('');
  const [rawText,setRawText]=useState(''),[dates,setDates]=useState<DateCandidate[]>([]);
  const [productName,setProductName]=useState(''),[brand,setBrand]=useState(''),[batch,setBatch]=useState('');
  const [expiry,setExpiry]=useState(''),[mfg,setMfg]=useState(''),[best,setBest]=useState('');
  const [confidence,setConfidence]=useState<number|null>(null),[code,setCode]=useState<CodeDetails|null>(null);
  const [codeStatus,setCodeStatus]=useState('Not checked yet'),[manualFlags,setManualFlags]=useState<string[]>([]);
  useEffect(()=>()=>{if(full)URL.revokeObjectURL(full.url);if(close)URL.revokeObjectURL(close.url);},[full,close]);

  function choose(file:File,source:ImageInputSource,isClose=false){
    if(!file.type.startsWith('image/')){setError('Please choose an image file.');return;}
    const photo={file,url:URL.createObjectURL(file)};
    if(isClose)setClose(old=>{if(old)URL.revokeObjectURL(old.url);return photo;});
    else {setFull(old=>{if(old)URL.revokeObjectURL(old.url);return photo;});onImageSelected?.(file,source);}
    setError('');
  }

  async function scan(){
    if(!full){setError('Add a full product photo first.');return;}
    setBusy(true);setError('');setRawText('');setDates([]);setCode(null);setConfidence(null);setCodeStatus('Checking barcode and QR…');
    let worker:Awaited<ReturnType<typeof createWorker>>|undefined;
    try{
      const photos=[full,...(close?[close]:[])];
      const decoded=await Promise.all(photos.map(photo=>readCode(photo.file)));
      const found=decoded.find(Boolean)??null;setCode(found);
      setCodeStatus(found?'A code was decoded. Review its contents below.':'No readable barcode or QR code was found in these photos.');
      worker=await createWorker('eng',1,{logger:m=>{if(m.status==='recognizing text')setProgress(`Reading label… ${Math.round((m.progress??0)*100)}%`);}});
      const results:{text:string;confidence:number}[]=[];
      for(let i=0;i<photos.length;i++){
        setProgress(i===0?'Reading full product photo (checking rotation)…':'Reading date-label close-up (checking rotation)…');
        const base=await preprocess(photos[i].file);
        const attempts: HTMLCanvasElement[] = [];
        for (const angle of [0, 90, 180, 270]) {
          const rotated=document.createElement('canvas');
          const sideways=angle===90||angle===270;
          rotated.width=(sideways?base.height:base.width)*2;
          rotated.height=(sideways?base.width:base.height)*2;
          const ctx=rotated.getContext('2d');
          if(!ctx) continue;
          ctx.translate(rotated.width/2,rotated.height/2);
          ctx.rotate(angle*Math.PI/180);
          ctx.drawImage(base,-base.width,-base.height,base.width*2,base.height*2);
          attempts.push(rotated);
        }
        let bestResult:{text:string;confidence:number}|null=null;
        for(let j=0;j<attempts.length;j++){
          setProgress('Reading ' + (i===0?'product photo':'date close-up') + '… orientation ' + (j+1) + '/' + attempts.length);
          const result=await worker.recognize(attempts[j]);
          const candidate={text:result.data.text.trim(),confidence:result.data.confidence};
          if(!bestResult||candidate.confidence>bestResult.confidence) bestResult=candidate;
        }
        if(bestResult) results.push(bestResult);
      }
      const text=results.map(x=>x.text).filter(Boolean).join('\n\n--- CLOSE-UP ---\n\n');
      setRawText(text);setConfidence(results.length?Math.round(results.reduce((a,b)=>a+b.confidence,0)/results.length):0);
      const foundDates=extractDateCandidates(text);setDates(foundDates);
      const e=foundDates.find(x=>x.kind==='expiry'),m=foundDates.find(x=>x.kind==='manufacturing'),b=foundDates.find(x=>x.kind==='best-before');
      setExpiry(e?.raw??found?.expiry??'');setMfg(m?.raw??found?.production??'');setBest(b?.raw??found?.bestBefore??'');
      const lines=text.split(/\n+/).map(x=>x.trim()).filter(Boolean);
      setProductName(lines.find(x=>x.length>2&&!/\b(exp|mfg|manufactur|batch|lot|best before|use by|\d{2,})\b/i.test(x))??'');
      setBrand(firstTextValue(text,/(?:brand)\s*[:\-]?\s*([^\n]+)/i));
      setBatch(found?.batch??firstTextValue(text,/(?:batch|lot)\s*(?:no\.?|number)?\s*[:#\-]?\s*([A-Z0-9\-/]+)/i));
      if(!text)setError('No readable text found. Try a sharper close-up in good light.');
      else if(!e&&!b&&!found?.expiry&&!found?.bestBefore)setError('Text found, but no labelled expiry or best-before date was identified. Check the package manually.');
    }catch{setError('Scanning could not complete. Check your internet connection and try again.');setCodeStatus('Code check could not complete.');}
    finally{if(worker)await worker.terminate();setBusy(false);setProgress('');}
  }

  const mismatch=Boolean(code?.expiry&&expiry&&code.expiry!==expiry);
  const flags=['A sticker appears to cover another date or label','Printing looks scratched, erased or overwritten','Two different dates appear on the same package','Date text has unusual spacing, font or ink'];
  function applyDate(item:DateCandidate){if(item.kind==='manufacturing')setMfg(item.raw);else if(item.kind==='best-before')setBest(item.raw);else setExpiry(item.raw);}
  return <section className="panel">
    <div className="section-title"><span className="step-icon"><ScanText size={20}/></span><div><h2>Scan a product</h2><p>Take a full product photo and an optional close-up of the date. Barcode and QR checks are additional layers.</p></div></div>
    <div className="scan-actions">
      <button className="choice" onClick={()=>fullCamera.current?.click()} disabled={busy}><Camera size={25}/><b>Full product photo</b><small>Take a picture</small></button>
      <button className="choice" onClick={()=>fullGallery.current?.click()} disabled={busy}><ImagePlus size={25}/><b>Choose full photo</b><small>From gallery</small></button>
    </div>
    <input ref={fullCamera} hidden type="file" accept="image/*" capture="environment" onChange={e=>{const f=e.target.files?.[0];if(f)choose(f,'camera');e.currentTarget.value='';}}/>
    <input ref={fullGallery} hidden type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0];if(f)choose(f,'gallery');e.currentTarget.value='';}}/>
    <div className="closeup-row"><div><b>Optional: date-label close-up</b><p>Useful when the printed date is small or unclear.</p></div><div className="closeup-actions"><button type="button" onClick={()=>closeCamera.current?.click()} disabled={busy}>Camera</button><button type="button" onClick={()=>closeGallery.current?.click()} disabled={busy}>Gallery</button></div></div>
    <input ref={closeCamera} hidden type="file" accept="image/*" capture="environment" onChange={e=>{const f=e.target.files?.[0];if(f)choose(f,'camera',true);e.currentTarget.value='';}}/>
    <input ref={closeGallery} hidden type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0];if(f)choose(f,'gallery',true);e.currentTarget.value='';}}/>
    <div className="photo-previews">{full&&<div className="preview-wrap"><img src={full.url} alt="Full product"/><div><b>Full product photo</b><p>{full.file.name||'Camera photo'}</p></div></div>}{close&&<div className="preview-wrap"><img src={close.url} alt="Date label close-up"/><div><b>Date-label close-up</b><p>{close.file.name||'Camera photo'}</p></div></div>}</div>
    <button className="primary scan-submit" onClick={()=>void scan()} disabled={busy||!full}><ScanText size={17}/>{busy?'Scanning…':'Read dates and scan codes'}</button>
    {busy&&<div className="notice"><RefreshCw size={16} className="spin"/> {progress||'Scanning…'} Keep this page open.</div>}
    {error&&<div className="scan-warning"><AlertTriangle size={17}/><span>{error}</span></div>}
    {(rawText||code)&&!busy&&<div className="ocr-results">
      <div className="result-heading"><CheckCircle2 size={18}/><b>Scan results — verify before saving</b></div>
      <p className="confidence">OCR confidence: {confidence??0}% (text recognition confidence, not date correctness).</p>
      <div className="code-panel"><div className="result-heading"><QrCode size={18}/><b>Barcode / QR result</b></div><p>{codeStatus}</p>{code&&<><pre className="raw-ocr">{code.format}: {code.text}</pre><dl className="code-fields">{code.gtin&&<div><dt>GTIN</dt><dd>{code.gtin}</dd></div>}{code.batch&&<div><dt>Encoded batch</dt><dd>{code.batch}</dd></div>}{code.expiry&&<div><dt>Encoded expiry (AI 17)</dt><dd>{code.expiry}</dd></div>}{code.bestBefore&&<div><dt>Encoded best-before (AI 15)</dt><dd>{code.bestBefore}</dd></div>}{code.production&&<div><dt>Encoded production date (AI 11)</dt><dd>{code.production}</dd></div>}{code.serial&&<div><dt>Serial number</dt><dd>{code.serial}</dd></div>}</dl><p className="muted">Many ordinary barcodes contain only a product identifier. A decoded code does not prove authenticity.</p></>}</div>
      {mismatch&&<div className="scan-warning"><AlertTriangle size={17}/><span>Printed expiry and encoded expiry differ. This needs manual checking; it does not prove tampering.</span></div>}
      <h3>Possible dates found</h3>{dates.length?<div className="candidate-list">{dates.map((d,i)=><button type="button" className="candidate" key={d.raw+i} onClick={()=>applyDate(d)}><b>{d.raw}</b><span>{d.kind}</span><small>{d.context}</small></button>)}</div>:<p className="muted">No date-like text was detected.</p>}
      <h3>Check and correct details</h3>
      <label>Product name<input value={productName} onChange={e=>setProductName(e.target.value)} placeholder="Product name"/></label>
      <label>Brand<input value={brand} onChange={e=>setBrand(e.target.value)} placeholder="Brand"/></label>
      <label>Manufacturing date<input value={mfg} onChange={e=>setMfg(e.target.value)} placeholder="As printed"/></label>
      <label>Expiry date<input value={expiry} onChange={e=>setExpiry(e.target.value)} placeholder="As printed"/></label>
      <label>Best-before information<input value={best} onChange={e=>setBest(e.target.value)} placeholder="As printed"/></label>
      <label>Batch / lot number<input value={batch} onChange={e=>setBatch(e.target.value)} placeholder="If visible"/></label>
      <h3>Physical packaging inspection</h3><p className="muted">Please inspect the actual package. This checklist is not automated image-forensics.</p>
      {flags.map(flag=><label className="flag-check" key={flag}><input type="checkbox" checked={manualFlags.includes(flag)} onChange={e=>setManualFlags(old=>e.target.checked?[...old,flag]:old.filter(x=>x!==flag))}/>{flag}</label>)}
      {manualFlags.length>0&&<div className="scan-warning"><AlertTriangle size={17}/><span>Manual inspection flagged {manualFlags.length} concern(s). Keep the package and verify with the manufacturer or seller.</span></div>}
      <details><summary>View all recognised text</summary><pre className="raw-ocr">{rawText}</pre></details>
      <p className="notice">Nothing is saved automatically. OCR can misread text; many barcodes do not contain expiry dates. Confirm the date on the original package. A clean scan cannot certify a product as safe or genuine.</p>
    </div>}
  </section>;
}
