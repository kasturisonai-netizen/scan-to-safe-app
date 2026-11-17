export type ProductDateType = 'expiry' | 'best_before' | 'use_by' | 'none' | 'unknown';

export interface ProductRecord {
  id: string;
  ownerId?: string;
  name: string;
  brand?: string;
  category: string;
  quantity?: string;
  sourceImagePath?: string;
  createdAt: string;
  batches: ProductBatch[];
}

export interface ProductBatch {
  id: string;
  productId: string;
  batchNumber?: string;
  manufacturingDate?: string;
  dateType: ProductDateType;
  relevantDate?: string;
  quantity?: number;
  unit?: string;
  dateVerified: boolean;
  rawOcrText?: string;
}
