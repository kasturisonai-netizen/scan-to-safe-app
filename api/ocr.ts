import vision from '@google-cloud/vision';

type OcrRequest = {
  imageBase64?: string;
  mimeType?: string;
};

let visionClient: InstanceType<typeof vision.ImageAnnotatorClient> | undefined;

function getVisionClient() {
  if (visionClient) return visionClient;
  const raw = process.env.GOOGLE_CLOUD_CREDENTIALS_JSON;
  if (!raw) throw new Error('Cloud OCR is not configured on the server.');
  const credentials = JSON.parse(raw);
  visionClient = new vision.ImageAnnotatorClient({
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID || credentials.project_id,
    credentials,
  });
  return visionClient;
}

export default async function handler(req: any, res: any) {
  const allowedOrigin = process.env.APP_ORIGIN;
  const origin = req.headers.origin;

  if (allowedOrigin && origin && origin !== allowedOrigin) {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin || origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Use POST to submit one product image.' });
  }

  try {
    const body = (req.body || {}) as OcrRequest;
    const imageBase64 = body.imageBase64?.replace(/^data:image\\/[^;]+;base64,/, '');
    const mimeType = body.mimeType || 'image/jpeg';
    if (!imageBase64 || !/^image\\/(jpeg|png|webp)$/i.test(mimeType)) {
      return res.status(400).json({ error: 'A JPEG, PNG or WebP image is required.' });
    }
    if (imageBase64.length > 5_500_000) {
      return res.status(413).json({ error: 'Image is too large. Please choose a smaller photo.' });
    }

    const imageBytes = Buffer.from(imageBase64, 'base64');
    if (!imageBytes.length || imageBytes.length > 4 * 1024 * 1024) {
      return res.status(413).json({ error: 'Image must be 4 MB or smaller after compression.' });
    }

    const client = getVisionClient();
    const [result] = await client.documentTextDetection({
      image: { content: imageBytes },
      imageContext: { languageHints: ['en'] },
    });
    const text = result.fullTextAnnotation?.text || '';
    const words = result.fullTextAnnotation?.pages?.flatMap(page =>
      page.blocks?.flatMap(block =>
        block.paragraphs?.flatMap(paragraph => paragraph.words || []) || []
      ) || []
    ) || [];
    const confidenceValues = words
      .map(word => word.confidence)
      .filter((value): value is number => typeof value === 'number' && value > 0);
    const confidence = confidenceValues.length
      ? Math.round(confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length * 100)
      : null;

    return res.status(200).json({ text, confidence, engine: 'Google Cloud Vision', wordCount: words.length });
  } catch (error) {
    console.error('Cloud Vision OCR failed:', error);
    return res.status(502).json({ error: 'Cloud OCR could not process this image. Please try again.' });
  }
}
