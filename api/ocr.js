const { createWorker } = require('tesseract.js');
const formidable = require('formidable');

// Используем CDN пути, чтобы не требовались локальные wasm-файлы в серверлес-среде
const TESSERACT_WORKER_PATH = 'https://unpkg.com/tesseract.js@v4.0.2/dist/worker.min.js';
const TESSERACT_CORE_PATH = 'https://unpkg.com/tesseract.js-core@v5.0.2/tesseract-core-simd.wasm.js';
const TESSERACT_LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0';

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

module.exports = async (req, res) => {
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
    const lang = (langParam === 'rus' || langParam === 'ru') ? 'rus+eng' : 'eng';

    const worker = await createWorker({
      workerPath: TESSERACT_WORKER_PATH,
      corePath: TESSERACT_CORE_PATH,
      langPath: TESSERACT_LANG_PATH,
      // logger: m => console.log(m), // можно включить при отладке
    });
    await worker.load();
    await worker.loadLanguage(lang);
    await worker.initialize(lang);
    const { data: { text } } = await worker.recognize(file.filepath);
    await worker.terminate();

    return res.status(200).json({ text });
  } catch (error) {
    console.error('Vercel OCR error:', error);
    return res.status(500).json({ error: error?.message || 'OCR failed' });
  }
};


