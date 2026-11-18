import { useEffect, useState } from 'react';
import { Camera, ImagePlus, ScanText, RefreshCw, AlertTriangle, CheckCircle2, QrCode, X } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Script, TextRecognition } from '@capacitor-mlkit/text-recognition';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { createWorker } from 'tesseract.js';
import type { ImageInputSource } from './types';
import { extractDateCandidates, firstTextValue } from './dateExtraction';
import type { DateCandidate, PositionedOcrLine } from './dateExtraction';

interface Props { onImageSelected?: (file: File, source: ImageInputSource) => void; }
interface Photo { file: File; url: string; }
interface CodeDetails { text: string; format: string; gtin?: string; batch?: string; expiry?: string; bestBefore?: string; production?: string; serial?: string; }

let browserOcrWorkerPromise: ReturnType<typeof createWorker> | null = null;
async function getBrowserOcrWorker() {
  if (!browserOcrWorkerPromise) {
    browserOcrWorkerPromise = createWorker('eng', 1, {
      logger: message => {
        if (message.status === 'recognizing text') {
          // The first browser scan also downloads the OCR model; later scans reuse this worker.
        }
      },
    });
  }
  return browserOcrWorkerPromise;
}

async function prepareImageForOcr(file: File, rotation = 0): Promise<File> {
  const image = await loadImage(file);
  const maxSide = 1800;
  const rotated = rotation % 180 !== 0;
  const sourceWidth = rotated ? image.naturalHeight : image.naturalWidth;
  const sourceHeight = rotated ? image.naturalWidth : image.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) return file;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(rotation * Math.PI / 180);
  context.filter = 'grayscale(1) contrast(1.25)';
  context.drawImage(image, -image.naturalWidth * scale / 2, -image.naturalHeight * scale / 2, image.naturalWidth * scale, image.naturalHeight * scale);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not prepare photo.')), 'image/jpeg', 0.9)
  );
  return new File([blob], 'scan-' + rotation + '.jpg', { type: 'image/jpeg', lastModified: Date.now() });
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
    const reader = new BrowserMultiFormatReader();
    const regions = [
      {x:0,y:0,w:1,h:1},
      {x:0.12,y:0.12,w:0.76,h:0.76},
    ];
    for (const region of regions) {
      const canvas=document.createElement('canvas');
      canvas.width=Math.min(2400,Math.round(image.naturalWidth*region.w*2));
      canvas.height=Math.min(2400,Math.round(image.naturalHeight*region.h*2));
      const ctx=canvas.getContext('2d');
      if(!ctx) continue;
      ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
      ctx.drawImage(image,
        Math.round(image.naturalWidth*region.x),Math.round(image.naturalHeight*region.y),
        Math.round(image.naturalWidth*region.w),Math.round(image.naturalHeight*region.h),
        0,0,canvas.width,canvas.height);
      const candidate=new Image();
      candidate.src=canvas.toDataURL('image/png');
      await new Promise<void>((resolve,reject)=>{candidate.onload=()=>resolve();candidate.onerror=()=>reject(new Error('QR crop failed'));});
      try {
        const result=await reader.decodeFromImageElement(candidate);
        return parseCode(result.getText(),String(result.getBarcodeFormat()));
      } catch { /* try the next crop */ }
    }
    return null;
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
  // Keep each preview URL's lifetime independent. A combined effect revoked\n  // the remaining photo URL whenever the other photo was added or removed.\n  useEffect(()=>()=>{if(full)URL.revokeObjectURL(full.url);},[full]);\n  useEffect(()=>()=>{if(close)URL.revokeObjectURL(close.url);},[close]);

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
    try {
      const photos = [...(close ? [close] : []), ...(full ? [full] : [])];
      const nativeOcr = Capacitor.isNativePlatform();
      setOcrEngine(nativeOcr ? 'Google ML Kit (on-device)' : 'Tesseract.js (browser, one pass)');

      // Run barcode/QR decoding alongside OCR instead of making the user wait for them sequentially.
      const codeTask = Promise.all(photos.map(photo => readCode(photo.file))).then(decoded => decoded.find(Boolean) ?? null);
      const ocrTask = Promise.all(photos.map(async (photo, index) => {
        setProgress(nativeOcr ? 'Recognising text on this device…' : 'Preparing browser OCR…');
        const rotations = [0, 90, 270];
        const recognisedTexts: string[] = [];
        const positionedLines: PositionedOcrLine[] = [];
        let browserConfidence = 0;
        for (const rotation of rotations) {
          const prepared = await prepareImageForOcr(photo.file, rotation);
          if (nativeOcr) {
            const base64 = await fileToBase64(prepared);
            const name = 'scan-' + Date.now() + '-' + index + '-' + rotation + '.jpg';
            const stored = await Filesystem.writeFile({ path: name, data: base64, directory: Directory.Cache, recursive: true });
            try {
              const recognised = await TextRecognition.processImage({ path: stored.uri, script: Script.Latin });
              if (recognised.text.trim()) recognisedTexts.push(recognised.text.trim());
              if (rotation === 0) {
                for (const block of recognised.blocks ?? []) {
                  for (const line of block.lines ?? []) {
                    const box = line.boundingBox;
                    if (line.text?.trim() && box) positionedLines.push({ text: line.text.trim(), left: box.left, top: box.top, right: box.right, bottom: box.bottom });
                  }
                }
              }
            } finally {
              await Filesystem.deleteFile({ path: name, directory: Directory.Cache }).catch(() => undefined);
            }
          } else {
            const worker = await getBrowserOcrWorker();
            const result = await worker.recognize(prepared);
            if (result.data.text.trim()) recognisedTexts.push(result.data.text.trim());
            browserConfidence = Math.max(browserConfidence, Math.round(result.data.confidence));
          }
        }
        return { text: [...new Set(recognisedTexts)].join('\n'), confidence: nativeOcr ? null as number | null : browserConfidence, positionedLines };
      }));

      const [found, results] = await Promise.all([codeTask, ocrTask]);
      setCode(found);
      setCodeStatus(found ? 'A code was decoded. Review its contents below.' : 'No readable barcode or QR code was found in these photos.');
      const text = results.map(item => item.text).filter(Boolean).join('\n\n--- CLOSE-UP ---\n\n');
      setRawText(text);
      setConfidence(null);
      const positionedLines = results.flatMap(item => item.positionedLines);
      const foundDates = extractDateCandidates(text, positionedLines);
      setDates(foundDates);
      const e = foundDates.find(item => item.kind === 'expiry');
      const m = foundDates.find(item => item.kind === 'manufacturing');
      const b = foundDates.find(item => item.kind === 'best-before');
      setExpiry(e?.raw ?? found?.expiry ?? '');
      setMfg(m?.raw ?? found?.production ?? '');
      setBest(b?.raw ?? found?.bestBefore ?? '');
      const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
      setProductName(lines.find(line => line.length > 2 && !/\b(exp|mfg|manufactur|batch|lot|best before|use by|\d{2,})\b/i.test(line)) ?? '');
      setBrand(firstTextValue(text, /(?:brand)\s*[:\-]?\s*([^\n]+)/i));
      setBatch(found?.batch ?? firstTextValue(text, /(?:batch|lot)\s*(?:no\.?|number)?\s*[:#\-]?\s*([A-Z0-9\-/]+)/i));
      if (!text) setError('No readable text found. Try a sharper close-up in good light.');
      else if (!e && !b && !found?.expiry && !found?.bestBefore) setError('Text found, but no labelled expiry or best-before date was identified. Check the package manually.');
    } catch (error) {
      setError(error instanceof Error ? `Scanning could not complete: ${error.message}` : 'Scanning could not complete. Please try a clearer image.');
      setCodeStatus('Code check could not complete.');
    } finally {
      setBusy(false);
      setProgress('');
    }
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
    <div className="photo-previews">{full&&<div className="preview-wrap"><img src={full.url} alt="Full product"/><div className="preview-info"><b>Full product photo</b><p>{full.file.name||'Camera photo'}</p><button type="button" className="remove-photo" disabled={busy} onClick={()=>{URL.revokeObjectURL(full.url);setFull(null);}}><X size={13}/> Remove photo</button></div></div>}{close&&<div className="preview-wrap"><img src={close.url} alt="Date label close-up"/><div className="preview-info"><b>Date-label close-up</b><p>{close.file.name||'Camera photo'}</p><button type="button" className="remove-photo" disabled={busy} onClick={()=>{URL.revokeObjectURL(close.url);setClose(null);}}><X size={13}/> Remove photo</button></div></div>}</div>
    <button className="primary scan-submit" onClick={()=>void scan()} disabled={busy||(!full&&!close)}><ScanText size={17}/>{busy?'Scanning…':'Read dates and scan codes'}</button>
    {busy&&<div className="notice"><RefreshCw size={16} className="spin"/> {progress||'Scanning…'} Keep this page open.</div>}
    {error&&<div className="scan-warning"><AlertTriangle size={17}/><span>{error}</span></div>}
    {(rawText||code)&&!busy&&<div className="ocr-results">
      <div className="result-heading"><CheckCircle2 size={18}/><b>Scan results — verify before saving</b></div>
      <p className="confidence">{ocrEngine==='Google ML Kit (on-device)'?'Google ML Kit on-device recognition. No comparable confidence score is provided.':'Browser OCR confidence: '+(confidence??0)+'% (text recognition confidence, not date correctness).'}</p>
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
