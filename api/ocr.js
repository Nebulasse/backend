import { createWorker } from 'tesseract.js';
import formidable from 'formidable';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json({ ok: true });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const form = formidable({ multiples: false });
    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    const file = files.file || files.image;
    if (!file) return res.status(400).json({ error: 'file/image is required' });

    const langParam = String(fields.language || fields.lang || '').toLowerCase();
    const lang = langParam === 'rus' || langParam === 'ru' ? 'rus+eng' : 'eng';

    const worker = await createWorker();
    await worker.loadLanguage(lang);
    await worker.initialize(lang);
    const { data: { text } } = await worker.recognize(file.filepath);
    await worker.terminate();

    return res.status(200).json({ text });
  } catch (error) {
    console.error('Vercel OCR error:', error);
    return res.status(500).json({ error: error?.message || 'OCR failed' });
  }
}


