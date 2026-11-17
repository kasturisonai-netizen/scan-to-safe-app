export type ProductCategory =
  | 'Food'
  | 'Medicine'
  | 'Personal Care'
  | 'Household'
  | 'Other';

export type ExpiryStatus =
  | 'Fresh'
  | 'Expiring Soon'
  | 'Expired'
  | 'Unknown';

export interface ProductBatch {
  id: string;
  productId: string;
  quantity: number;
  manufacturingDate?: string;
  expiryDate?: string;
  batchNumber?: string;
  createdAt: string;
}

export interface ProductRecord {
  id: string;
  name: string;
  brand?: string;
  category: ProductCategory;
  imageUrl?: string;
  purchaseDate?: string;
  purchasePrice?: number;
  purchaseStore?: string;
  notes?: string;
  batches: ProductBatch[];
  createdAt: string;
  updatedAt: string;
}

export interface ImageScanResult {
  productName?: string;
  brand?: string;
  category?: ProductCategory;
  quantity?: number;
  manufacturingDate?: string;
  expiryDate?: string;
  bestBefore?: string;
  batchNumber?: string;
  confidence: number;
  warnings: string[];
}
