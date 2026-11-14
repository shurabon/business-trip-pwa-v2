const express = require('express');
const carbone = require('carbone');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 4000;
const TEMPLATES_DIR = path.join(__dirname, 'templates');

if (!fs.existsSync(TEMPLATES_DIR)) {
  fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, TEMPLATES_DIR);
  },
  filename: function (req, file, cb) {
    const safeName = path.basename(file.originalname);
    cb(null, safeName);
  }
});
const upload = multer({ storage: storage });

function fixXlsxDimension(buffer) {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    let modified = false;
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const cellKeys = Object.keys(ws).filter(k => /^[A-Z]+[0-9]+$/.test(k));
      if (cellKeys.length === 0) continue;
      let minR = Infinity, maxR = 0, minC = Infinity, maxC = 0;
      for (const cell of cellKeys) {
        const decoded = XLSX.utils.decode_cell(cell);
        if (decoded.r < minR) minR = decoded.r;
        if (decoded.r > maxR) maxR = decoded.r;
        if (decoded.c < minC) minC = decoded.c;
        if (decoded.c > maxC) maxC = decoded.c;
      }
      const newRef = XLSX.utils.encode_range({ s: { r: minR, c: minC }, e: { r: maxR, c: maxC } });
      if (ws['!ref'] !== newRef) {
        ws['!ref'] = newRef;
        modified = true;
      }
    }
    if (modified) {
      return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    }
  } catch (e) {
    console.error('fixXlsxDimension error:', e);
  }
  return buffer;
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'carbone-engine', time: new Date().toISOString() });
});

app.get('/api/templates', (req, res) => {
  try {
    const files = fs.readdirSync(TEMPLATES_DIR);
    const list = files
      .filter(f => !f.startsWith('.'))
      .map(file => {
        const stat = fs.statSync(path.join(TEMPLATES_DIR, file));
        return {
          name: file,
          size: stat.size,
          updatedAt: stat.mtime
        };
      });
    res.json({ success: true, templates: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/templates/upload', upload.single('template'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No template file provided' });
  }
  res.json({
    success: true,
    message: 'Template uploaded successfully',
    filename: req.file.filename,
    size: req.file.size
  });
});

app.get('/api/templates/:name/download', (req, res) => {
  const filePath = path.join(TEMPLATES_DIR, path.basename(req.params.name));
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: 'Template not found' });
  }
  res.download(filePath);
});

app.delete('/api/templates/:name', (req, res) => {
  const filePath = path.join(TEMPLATES_DIR, path.basename(req.params.name));
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: 'Template not found' });
  }
  try {
    fs.unlinkSync(filePath);
    res.json({ success: true, message: 'Template deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/render/:name', (req, res) => {
  const templateName = path.basename(req.params.name);
  const templatePath = path.join(TEMPLATES_DIR, templateName);

  if (!fs.existsSync(templatePath)) {
    return res.status(404).json({ success: false, error: 'Template not found' });
  }

  const data = (req.body && req.body.data) ? req.body.data : {};
  const convertTo = req.query.convertTo || null;
  const options = {};
  if (convertTo) {
    options.convertTo = convertTo;
  }

  carbone.render(templatePath, data, options, (err, result, defaultReportName) => {
    if (err) {
      console.error('Carbone render error:', err);
      return res.status(500).json({ success: false, error: String(err) });
    }

    let finalBuffer = result;
    const isXlsx = (!convertTo && templateName.endsWith('.xlsx')) || (convertTo === 'xlsx');
    if (isXlsx) {
      finalBuffer = fixXlsxDimension(finalBuffer);
    }

    const ext = convertTo ? convertTo : path.extname(templateName).slice(1);
    const downloadFilename = `report_${Date.now()}.${ext}`;

    let contentType = 'application/octet-stream';
    if (ext === 'xlsx') contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    else if (ext === 'docx') contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    else if (ext === 'pdf') contentType = 'application/pdf';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
    res.send(finalBuffer);
  });
});

app.listen(PORT, () => {
  console.log(`Carbone service is listening on port ${PORT}`);
});
