export interface ImageScanResult {
  rawText: string;
  productName?: string;
  brand?: string;
  quantity?: string;
  manufacturingDate?: string;
  expiryDate?: string;
  bestBeforeDate?: string;
  batchNumber?: string;
  confidence?: number;
  warnings: string[];
}

export type ImageInputSource = 'camera' | 'gallery';
