import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, ScanText, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { createWorker } from 'tesseract.js';
import type { ImageInputSource } from './types';
import { extractDateCandidates, firstTextValue } from './dateExtraction';
import type { DateCandidate } from './dateExtraction';

interface Props { onImageSelected?: (file: File, source: ImageInputSource) => void; }

export default function Scanner({ onImageSelected }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [rawText, setRawText] = useState('');
  const [dates, setDates] = useState<DateCandidate[]>([]);
  const [productName, setProductName] = useState('');
  const [brand, setBrand] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [manufacturingDate, setManufacturingDate] = useState('');
  const [bestBefore, setBestBefore] = useState('');
  const [confidence, setConfidence] = useState<number | null>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function readImage(file: File, source: ImageInputSource) {
    if (!file.type.startsWith('image/')) { setError('Please choose an image file.'); return; }
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    setFileName(file.name || 'Camera photograph');
    setError(''); setRawText(''); setDates([]); setConfidence(null);
    setProductName(''); setBrand(''); setBatchNumber(''); setExpiryDate(''); setManufacturingDate(''); setBestBefore('');
    onImageSelected?.(file, source);
    setBusy(true); setProgress('Preparing image recognition…');
    let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
    try {
      worker = await createWorker('eng', 1, { logger: message => {
        if (message.status === 'recognizing text') setProgress(`Reading label… ${Math.round((message.progress ?? 0) * 100)}%`);
        else if (message.status) setProgress(message.status);
      }});
      const result = await worker.recognize(file);
      const text = result.data.text.trim();
      setRawText(text);
      setConfidence(Math.round(result.data.confidence));
      const candidates = extractDateCandidates(text);
      setDates(candidates);
      const expiry = candidates.find(item => item.kind === 'expiry');
      const mfg = candidates.find(item => item.kind === 'manufacturing');
      const best = candidates.find(item => item.kind === 'best-before');
      setExpiryDate(expiry?.raw ?? '');
      setManufacturingDate(mfg?.raw ?? '');
      setBestBefore(best?.raw ?? '');
      const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
      const likelyName = lines.find(line => line.length > 2 && !/\b(exp|mfg|manufactur|batch|lot|best before|use by|\d{2,})\b/i.test(line));
      setProductName(likelyName ?? '');
      setBrand(firstTextValue(text, /(?:brand)\s*[:\-]?\s*([^\n]+)/i));
      setBatchNumber(firstTextValue(text, /(?:batch|lot)\s*(?:no\.?|number)?\s*[:#\-]?\s*([A-Z0-9\-/]+)/i));
      if (!text) setError('No readable text was found. Try a clearer, closer photo with the printed label in focus.');
      else if (!expiry && !best) setError('Text was recognised, but no expiry or best-before date was confidently labelled. Please inspect the text and enter the date yourself.');
    } catch (e) {
      setError('Image recognition could not start. Check your internet connection and try again.');
    } finally {
      if (worker) await worker.terminate();
      setBusy(false); setProgress('');
    }
  }

  function useCandidate(candidate: DateCandidate) {
    if (candidate.kind === 'expiry') setExpiryDate(candidate.raw);
    else if (candidate.kind === 'manufacturing') setManufacturingDate(candidate.raw);
    else if (candidate.kind === 'best-before') setBestBefore(candidate.raw);
    else setExpiryDate(candidate.raw);
  }

  return <section className="panel">
    <div className="section-title"><span className="step-icon"><ScanText size={20}/></span><div><h2>Scan a product image</h2><p>Photograph the printed label or choose an image from your gallery. No barcode scanning.</p></div></div>
    <div className="scan-actions">
      <button className="choice" onClick={() => cameraRef.current?.click()} disabled={busy}><Camera size={27}/><b>Take a photo</b><small>Use your phone camera</small></button>
      <button className="choice" onClick={() => galleryRef.current?.click()} disabled={busy}><ImagePlus size={27}/><b>Upload an image</b><small>Choose from your gallery</small></button>
    </div>
    <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={e => { const file=e.target.files?.[0]; if(file) void readImage(file,'camera'); e.currentTarget.value=''; }}/>
    <input ref={galleryRef} hidden type="file" accept="image/*" onChange={e => { const file=e.target.files?.[0]; if(file) void readImage(file,'gallery'); e.currentTarget.value=''; }}/>
    {preview && <div className="preview-wrap"><img src={preview} alt="Selected product label"/><div><b>{fileName}</b><p>{busy ? progress : rawText ? 'Image text recognition finished. Please verify every field.' : 'Image selected.'}</p></div></div>}
    {busy && <div className="notice"><RefreshCw size={16} className="spin"/> {progress || 'Reading image…'} Keep this page open while the label is processed.</div>}
    {error && <div className="scan-warning"><AlertTriangle size={17}/><span>{error}</span></div>}
    {rawText && !busy && <div className="ocr-results">
      <div className="result-heading"><CheckCircle2 size={18}/><b>Text recognised — verify before saving</b></div>
      <p className="confidence">OCR confidence: {confidence ?? 0}% (this measures text recognition, not date correctness).</p>
      <h3>Possible dates found</h3>
      {dates.length ? <div className="candidate-list">{dates.map((item,index)=><button type="button" className="candidate" key={`${item.raw}-${index}`} onClick={()=>useCandidate(item)}><b>{item.raw}</b><span>{item.kind === 'best-before' ? 'Best before' : item.kind === 'manufacturing' ? 'Manufacturing' : item.kind === 'expiry' ? 'Expiry' : 'Unlabelled date'}</span><small>{item.context}</small></button>)}</div> : <p className="muted">No date-like text was detected.</p>}
      <h3>Check and correct details</h3>
      <label>Product name<input value={productName} onChange={e=>setProductName(e.target.value)} placeholder="Enter product name"/></label>
      <label>Brand<input value={brand} onChange={e=>setBrand(e.target.value)} placeholder="Enter brand (if known)"/></label>
      <label>Manufacturing date<input value={manufacturingDate} onChange={e=>setManufacturingDate(e.target.value)} placeholder="As printed on the label"/></label>
      <label>Expiry date<input value={expiryDate} onChange={e=>setExpiryDate(e.target.value)} placeholder="As printed on the label"/></label>
      <label>Best-before information<input value={bestBefore} onChange={e=>setBestBefore(e.target.value)} placeholder="As printed on the label"/></label>
      <label>Batch / lot number<input value={batchNumber} onChange={e=>setBatchNumber(e.target.value)} placeholder="If visible"/></label>
      <details><summary>View all recognised text</summary><pre className="raw-ocr">{rawText}</pre></details>
      <p className="notice">Nothing is saved automatically. OCR can misread characters and dates. Check the original package and confirm the correct expiry date before adding this product to your inventory.</p>
    </div>}
  </section>;
}
