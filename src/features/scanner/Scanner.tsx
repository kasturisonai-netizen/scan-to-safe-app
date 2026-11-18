import { useEffect, useState } from 'react';
import { Camera, ImagePlus, ScanText, RefreshCw, AlertTriangle, CheckCircle2, QrCode } from 'lucide-react';
import { createWorker } from 'tesseract.js';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Script, TextRecognition } from '@capacitor-mlkit/text-recognition';
import { BrowserMultiFormatReader } from '@zxing/browser';
import type { ImageInputSource } from './types';
import { extractDateCandidates, firstTextValue } from './dateExtraction';
import type { DateCandidate } from './dateExtraction';

interface Props { onImageSelected?: (file: File, source: ImageInputSource) => void; }
interface Photo { file: File; url: string; }
interface CodeDetails { text: string; format: string; gtin?: string; batch?: string; expiry?: string; bestBefore?: string; production?: string; serial?: string; }

// Keep the browser OCR worker warm between scans; worker startup is expensive on mobile.
let browserWorkerPromise: ReturnType<typeof createWorker> | null = null;
let activeOcrProgress: ((message: string) => void) | null = null;
async function getBrowserOcrWorker() {
  if (!browserWorkerPromise) {
    browserWorkerPromise = createWorker('eng', 1, {
      logger: message => {
        if (message.status === 'recognizing text') activeOcrProgress?.(`Reading label… ${Math.round((message.progress ?? 0) * 100)}%`);
      },
    }).catch(error => { browserWorkerPromise = null; throw error; });
  }
  return browserWorkerPromise;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? '');
      const comma = value.indexOf(',');
      if (comma < 0) reject(new Error('Could not prepare image for on-device OCR'));
      else resolve(value.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error('Could not read image file'));
    reader.readAsDataURL(file);
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image could not load')); };
    img.src = url;
  });
}

async function makeOcrVariants(file: File): Promise<HTMLCanvasElement[]> {
  const img = await loadImage(file);
  const scale = Math.min(3, Math.max(1.5, 2200 / Math.max(img.width, img.height)));
  const width = Math.round(img.width * scale), height = Math.round(img.height * scale);
  const base = document.createElement('canvas');
  base.width = width; base.height = height;
  const ctx = base.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height);
  const grey = new Uint8ClampedArray(width * height);
  const histogram = new Array<number>(256).fill(0);
  for (let p = 0, i = 0; p < grey.length; p++, i += 4) {
    const value = Math.max(0, Math.min(255, (0.299 * pixels.data[i] + 0.587 * pixels.data[i + 1] + 0.114 * pixels.data[i + 2] - 128) * 1.65 + 128));
    grey[p] = value; histogram[Math.round(value)]++;
  }
  // Otsu threshold creates a clean high-contrast copy for dotted thermal printing.
  const total = grey.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];
  let sumB = 0, weightB = 0, maxVariance = -1, threshold = 128;
  for (let i = 0; i < 256; i++) {
    weightB += histogram[i];
    if (!weightB) continue;
    const weightF = total - weightB;
    if (!weightF) break;
    sumB += i * histogram[i];
    const variance = weightB * weightF * Math.pow(sumB / weightB - (sum - sumB) / weightF, 2);
    if (variance > maxVariance) { maxVariance = variance; threshold = i; }
  }
  const enhanced = document.createElement('canvas');
  enhanced.width = width; enhanced.height = height;
  const ectx = enhanced.getContext('2d');
  const binary = document.createElement('canvas');
  binary.width = width; binary.height = height;
  const bctx = binary.getContext('2d');
  if (!ectx || !bctx) throw new Error('Canvas unavailable');
  const ep = ectx.createImageData(width, height);
  const bp = bctx.createImageData(width, height);
  for (let p = 0, i = 0; p < grey.length; p++, i += 4) {
    const v = grey[p], bw = v > threshold ? 255 : 0;
    ep.data[i] = ep.data[i + 1] = ep.data[i + 2] = v; ep.data[i + 3] = 255;
    bp.data[i] = bp.data[i + 1] = bp.data[i + 2] = bw; bp.data[i + 3] = 255;
  }
  ectx.putImageData(ep, 0, 0); bctx.putImageData(bp, 0, 0);
  return [enhanced, binary];
}

function rotateCanvas(source: HTMLCanvasElement, angle: number): HTMLCanvasElement {
  const sideways = angle === 90 || angle === 270;
  const canvas = document.createElement('canvas');
  canvas.width = sideways ? source.height : source.width;
  canvas.height = sideways ? source.width : source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(angle * Math.PI / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

function ocrScore(text: string, confidence: number): number {
  const lower = text.toLowerCase();
  const candidates = extractDateCandidates(text);
  const labelled = candidates.filter(x => x.kind !== 'unknown').length;
  const dateLike = candidates.length;
  const labels = (lower.match(/exp|expiry|use by|best before|mfg|manufactur|batch|lot|pkd|packed/g) ?? []).length;
  // Prefer readable date/label content over a high-confidence result that contains no useful dates.
  return confidence * 0.2 + labelled * 45 + dateLike * 12 + labels * 5 + Math.min(text.length, 1200) * 0.005;
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
  const [full,setFull]=useState<Photo|null>(null),[close,setClose]=useState<Photo|null>(null);
  const [busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState('');
  const [rawText,setRawText]=useState(''),[dates,setDates]=useState<DateCandidate[]>([]);
  const [productName,setProductName]=useState(''),[brand,setBrand]=useState(''),[batch,setBatch]=useState('');
  const [expiry,setExpiry]=useState(''),[mfg,setMfg]=useState(''),[best,setBest]=useState('');
  const [confidence,setConfidence]=useState<number|null>(null),[ocrEngine,setOcrEngine]=useState(''),[code,setCode]=useState<CodeDetails|null>(null);
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
    if(!full&&!close){setError('Add a product photo or a date-label close-up first.');return;}
    setBusy(true);setError('');setRawText('');setDates([]);setCode(null);setConfidence(null);setCodeStatus('Checking barcode and QR…');
    let worker:Awaited<ReturnType<typeof createWorker>>|undefined;
    activeOcrProgress = setProgress;
    try{
      const photos=[...(close?[close]:[]),...(full?[full]:[])];
      const decoded=await Promise.all(photos.map(photo=>readCode(photo.file)));
      const found=decoded.find(Boolean)??null;setCode(found);
      setCodeStatus(found?'A code was decoded. Review its contents below.':'No readable barcode or QR code was found in these photos.');
      const nativeOcr=Capacitor.isNativePlatform();
      setOcrEngine(nativeOcr?'Google ML Kit (on-device)':'Tesseract (browser)');
      if(!nativeOcr) worker=await getBrowserOcrWorker();
      const results:{text:string;confidence:number|null}[]=[];
      for(let i=0;i<photos.length;i++){
        const isClosePhoto=Boolean(close)&&photos[i]===close;
        if(nativeOcr){
          setProgress('Recognising text on this device…');
          const base64=await fileToBase64(photos[i].file);
          const name=`scan-${Date.now()}-${i}.jpg`;
          const stored=await Filesystem.writeFile({path:name,data:base64,directory:Directory.Cache,recursive:true});
          try {
            const recognised=await TextRecognition.processImage({path:stored.uri,script:Script.Latin});
            if(recognised.text.trim()) results.push({text:recognised.text.trim(),confidence:null});
          } finally { await Filesystem.deleteFile({path:name,directory:Directory.Cache}).catch(()=>undefined); }
          continue;
        }
        if(i>0 && results.some(item=>extractDateCandidates(item.text).some(candidate=>candidate.kind==='expiry'||candidate.kind==='best-before'))) break;
        setProgress(isClosePhoto?'Preparing date-label close-up…':'Preparing product photo…');
        const variants=await makeOcrVariants(photos[i].file);
        // Start with upright images. Only pay for rotated passes when the first readings
        // fail to identify an expiry/best-before label (common on mobile product photos).
        const upright=variants.map(variant=>rotateCanvas(variant,0));
        const rotated=variants.map(variant=>rotateCanvas(variant,90));
        const attempts=[...upright,...rotated];
        if(!worker) throw new Error('Browser OCR worker is unavailable');
        const candidates:{text:string;confidence:number;score:number}[]=[];
        for(let j=0;j<attempts.length;j++){
          if(j===2 && candidates.some(item=>extractDateCandidates(item.text).some(candidate=>candidate.kind==='expiry'||candidate.kind==='best-before'))) break;
          setProgress('Reading ' + (isClosePhoto?'date close-up':'product photo') + '… pass ' + (j+1) + '/' + attempts.length);
          const result=await worker.recognize(attempts[j]);
          const text=result.data.text.trim();
          if(text) candidates.push({text,confidence:result.data.confidence,score:ocrScore(text,result.data.confidence)});
        }
        // Keep several complementary readings: one pass may catch the date while another catches its label.
        const selected:string[]=[];
        const seen=new Set<string>();
        candidates.sort((a,b)=>b.score-a.score);
        for(const candidate of candidates){
          const key=candidate.text.toLowerCase().replace(/[^a-z0-9]/g,'');
          if(key.length<3||seen.has(key)) continue;
          seen.add(key); selected.push(candidate.text);
          if(selected.length===3) break;
        }
        if(selected.length){
          const confidence=candidates.slice(0,Math.min(3,candidates.length)).reduce((sum,item)=>sum+item.confidence,0)/Math.min(3,candidates.length);
          results.push({text:selected.join('\n--- OCR PASS ---\n'),confidence});
        }
      }
      const text=results.map(x=>x.text).filter(Boolean).join('\n\n--- CLOSE-UP ---\n\n');
      setRawText(text);const scored=results.filter((item):item is {text:string;confidence:number}=>item.confidence!==null);setConfidence(scored.length?Math.round(scored.reduce((a,b)=>a+b.confidence,0)/scored.length):null);
      const foundDates=extractDateCandidates(text);setDates(foundDates);
      const e=foundDates.find(x=>x.kind==='expiry'),m=foundDates.find(x=>x.kind==='manufacturing'),b=foundDates.find(x=>x.kind==='best-before');
      setExpiry(e?.raw??found?.expiry??'');setMfg(m?.raw??found?.production??'');setBest(b?.raw??found?.bestBefore??'');
      const lines=text.split(/\n+/).map(x=>x.trim()).filter(Boolean);
      setProductName(lines.find(x=>x.length>2&&!/\b(exp|mfg|manufactur|batch|lot|best before|use by|\d{2,})\b/i.test(x))??'');
      setBrand(firstTextValue(text,/(?:brand)\s*[:\-]?\s*([^\n]+)/i));
      setBatch(found?.batch??firstTextValue(text,/(?:batch|lot)\s*(?:no\.?|number)?\s*[:#\-]?\s*([A-Z0-9\-/]+)/i));
      if(!text)setError('No readable text found. Try a sharper close-up in good light.');
      else if(!e&&!b&&!found?.expiry&&!found?.bestBefore)setError('Text found, but no labelled expiry or best-before date was identified. Check the package manually.');
    }catch(error){setError(error instanceof Error ? `Scanning could not complete: ${error.message}` : 'Scanning could not complete. Please try a clearer image.');setCodeStatus('Code check could not complete.');}
    finally{activeOcrProgress=null;setBusy(false);setProgress('');}
  }

  const mismatch=Boolean(code?.expiry&&expiry&&code.expiry!==expiry);
  const flags=['A sticker appears to cover another date or label','Printing looks scratched, erased or overwritten','Two different dates appear on the same package','Date text has unusual spacing, font or ink'];
  function applyDate(item:DateCandidate){if(item.kind==='manufacturing')setMfg(item.raw);else if(item.kind==='best-before')setBest(item.raw);else setExpiry(item.raw);}
  return <section className="panel">
    <div className="section-title"><span className="step-icon"><ScanText size={20}/></span><div><h2>Scan a product</h2><p>Take a full product photo and an optional close-up of the date. Barcode and QR checks are additional layers.</p></div></div>
    <div className="scan-actions">
      <label className="choice file-choice">
        <input className="file-input-overlay" type="file" accept="image/*" capture="environment" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)choose(f,'camera');e.currentTarget.value='';}}/>
        <Camera size={25}/><b>Full product photo</b><small>Take a picture</small>
      </label>
      <label className="choice file-choice">
        <input className="file-input-overlay" type="file" accept="image/*" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)choose(f,'gallery');e.currentTarget.value='';}}/>
        <ImagePlus size={25}/><b>Choose full photo</b><small>From gallery</small>
      </label>
    </div>
    <div className="closeup-row"><div><b>Optional: date-label close-up</b><p>Useful when the printed date is small or unclear.</p></div><div className="closeup-actions">
      <label className="file-action">Camera<input type="file" accept="image/*" capture="environment" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)choose(f,'camera',true);e.currentTarget.value='';}}/></label>
      <label className="file-action">Gallery<input type="file" accept="image/*" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)choose(f,'gallery',true);e.currentTarget.value='';}}/></label>
    </div></div>
    <div className="photo-previews">{full&&<div className="preview-wrap"><img src={full.url} alt="Full product"/><div><b>Full product photo</b><p>{full.file.name||'Camera photo'}</p></div></div>}{close&&<div className="preview-wrap"><img src={close.url} alt="Date label close-up"/><div><b>Date-label close-up</b><p>{close.file.name||'Camera photo'}</p></div></div>}</div>
    <button className="primary scan-submit" onClick={()=>void scan()} disabled={busy||(!full&&!close)}><ScanText size={17}/>{busy?'Scanning…':'Read dates and scan codes'}</button>
    {busy&&<div className="notice"><RefreshCw size={16} className="spin"/> {progress||'Scanning…'} Keep this page open.</div>}
    {error&&<div className="scan-warning"><AlertTriangle size={17}/><span>{error}</span></div>}
    {(rawText||code)&&!busy&&<div className="ocr-results">
      <div className="result-heading"><CheckCircle2 size={18}/><b>Scan results — verify before saving</b></div>
      <p className="confidence">{ocrEngine==='Google ML Kit (on-device)'?'Google ML Kit on-device recognition. No comparable confidence score is provided.':'OCR confidence: '+(confidence??0)+'% (text recognition confidence, not date correctness).'}</p>
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
