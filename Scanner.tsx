import { useRef, useState } from 'react';
import { Camera, ImagePlus, ScanText } from 'lucide-react';
import type { ImageInputSource } from './types';

interface Props { onImageSelected: (file: File, source: ImageInputSource) => void; }

export default function Scanner({ onImageSelected }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState('');
  const [fileName, setFileName] = useState('');

  function select(file: File | undefined, source: ImageInputSource) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    setPreview(URL.createObjectURL(file));
    setFileName(file.name || 'Camera photograph');
    onImageSelected(file, source);
  }

  return <section className="panel">
    <div className="section-title"><span className="step-icon"><ScanText size={20}/></span><div><h2>Scan a product image</h2><p>Photograph the printed label or choose an image from your gallery.</p></div></div>
    <div className="scan-actions">
      <button className="choice" onClick={() => cameraRef.current?.click()}><Camera size={27}/><b>Take a photo</b><small>Use your phone camera</small></button>
      <button className="choice" onClick={() => galleryRef.current?.click()}><ImagePlus size={27}/><b>Upload an image</b><small>Choose from your gallery</small></button>
    </div>
    <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={e => select(e.target.files?.[0], 'camera')}/>
    <input ref={galleryRef} hidden type="file" accept="image/*" onChange={e => select(e.target.files?.[0], 'gallery')}/>
    {preview && <div className="preview-wrap"><img src={preview} alt="Selected product label"/><div><b>{fileName}</b><p>Image selected. OCR processing will be connected in the scanner integration stage.</p></div></div>}
  </section>;
}
