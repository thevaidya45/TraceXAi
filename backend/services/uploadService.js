const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { AppError } = require('../utils/AppError');

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function megabytesFromEnv(value, fallbackMb, { min = 1, max = 2048 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return fallbackMb;
  }
  return Math.round(parsed);
}

const MAX_CCTV_MB = megabytesFromEnv(process.env.CCTV_MAX_MB, 500);
const MAX_CCTV_BYTES = MAX_CCTV_MB * 1024 * 1024;

function cctvSizeLimitMessage() {
  return `The CCTV file must be ${MAX_CCTV_MB} MB or smaller.`;
}
const UPLOAD_DIR = path.resolve(
  process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads', 'items')
);
const CCTV_UPLOAD_DIR = path.resolve(
  process.env.CCTV_UPLOAD_DIR || path.join(__dirname, '..', 'uploads', 'cctv')
);
// Module 6 evidence stills live beside the other uploads and are only reachable
// through an authenticated admin route, never as a static path.
const EVIDENCE_UPLOAD_DIR = path.resolve(
  process.env.EVIDENCE_UPLOAD_DIR || path.join(__dirname, '..', 'uploads', 'evidence')
);

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

function detectImageExtension(buffer) {
  if (!buffer || buffer.length < 12) {
    return null;
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return '.jpg';
  }
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return '.png';
  }
  const riff = buffer.slice(0, 4).toString('ascii');
  const webp = buffer.slice(8, 12).toString('ascii');
  if (riff === 'RIFF' && webp === 'WEBP') {
    return '.webp';
  }
  return null;
}

async function ensureUploadDir() {
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
}

async function ensureCctvUploadDir() {
  await fsp.mkdir(CCTV_UPLOAD_DIR, { recursive: true });
}

function safeImagePath(imageKey) {
  if (!imageKey || typeof imageKey !== 'string') {
    return null;
  }
  const base = path.basename(imageKey);
  if (base !== imageKey || base.includes('..')) {
    return null;
  }
  const ext = path.extname(base).toLowerCase();
  if (!MIME_BY_EXT[ext]) {
    return null;
  }
  const resolved = path.resolve(UPLOAD_DIR, base);
  if (!resolved.startsWith(UPLOAD_DIR + path.sep) && resolved !== UPLOAD_DIR) {
    return null;
  }
  return resolved;
}

async function saveReportImage(file) {
  if (!file || !file.buffer) {
    return null;
  }
  if (file.size > MAX_IMAGE_BYTES || file.buffer.length > MAX_IMAGE_BYTES) {
    throw new AppError('The image must be 2 MB or smaller.', 400);
  }
  const ext = detectImageExtension(file.buffer);
  if (!ext) {
    throw new AppError('Please upload a JPEG, PNG, or WebP image.', 400);
  }
  await ensureUploadDir();
  const imageKey = `${crypto.randomUUID()}${ext}`;
  const dest = safeImagePath(imageKey);
  if (!dest) {
    throw new AppError('Unable to save the image. Please try again.', 500);
  }
  await fsp.writeFile(dest, file.buffer);
  return imageKey;
}

async function deleteReportImage(imageKey) {
  const dest = safeImagePath(imageKey);
  if (!dest) {
    return;
  }
  try {
    await fsp.unlink(dest);
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      throw err;
    }
  }
}

function contentTypeForKey(imageKey) {
  const ext = path.extname(String(imageKey || '')).toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

async function readReportImage(imageKey) {
  const dest = safeImagePath(imageKey);
  if (!dest) {
    return null;
  }
  try {
    const content = await fsp.readFile(dest);
    const ext = path.extname(imageKey).toLowerCase();
    return {
      filename: `item-photo${ext}`,
      contentType: contentTypeForKey(imageKey),
      content
    };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

async function ensureEvidenceDir() {
  await fsp.mkdir(EVIDENCE_UPLOAD_DIR, { recursive: true });
}

function safeEvidencePath(imageKey) {
  if (!imageKey || typeof imageKey !== 'string') {
    return null;
  }
  const base = path.basename(imageKey);
  if (base !== imageKey || base.includes('..')) {
    return null;
  }
  if (path.extname(base).toLowerCase() !== '.jpg') {
    return null;
  }
  const resolved = path.resolve(EVIDENCE_UPLOAD_DIR, base);
  if (!resolved.startsWith(EVIDENCE_UPLOAD_DIR + path.sep)) {
    return null;
  }
  return resolved;
}

/**
 * Move a freshly extracted still into evidence storage under a random,
 * server-generated key. The worker's temporary path is never exposed.
 */
async function storeEvidenceImage(tempPath) {
  const header = await readFileHeader(tempPath, 3);
  if (!(header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff)) {
    throw new AppError('The extracted evidence frame was not a valid image.', 500);
  }
  await ensureEvidenceDir();
  const imageKey = `${crypto.randomUUID()}.jpg`;
  const dest = safeEvidencePath(imageKey);
  if (!dest) {
    throw new AppError('Unable to store the evidence frame.', 500);
  }
  try {
    await fsp.rename(tempPath, dest);
  } catch (err) {
    if (err && err.code === 'EXDEV') {
      await fsp.copyFile(tempPath, dest);
      await fsp.unlink(tempPath).catch(() => {});
    } else {
      throw err;
    }
  }
  return imageKey;
}

async function deleteEvidenceImage(imageKey) {
  const dest = safeEvidencePath(imageKey);
  if (!dest) {
    return;
  }
  try {
    await fsp.unlink(dest);
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      throw err;
    }
  }
}

const VIDEO_MIME_BY_EXT = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
};

function detectVideoExtension(buffer) {
  if (!buffer || buffer.length < 12) {
    return null;
  }
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return '.webm';
  }
  const box = buffer.slice(4, 8).toString('ascii');
  if (box === 'ftyp') {
    return '.mp4';
  }
  return null;
}

function sanitizeCctvDisplayName(original, ext) {
  const base = path.basename(String(original || 'recording'));
  const cleaned = base.replace(/[^\w.\- ()[\]]+/g, '_').slice(0, 100);
  const suffix = ext || path.extname(cleaned) || '.mp4';
  const stem = cleaned.replace(/\.[^.]+$/, '') || 'recording';
  return `${stem}${suffix}`;
}

function safeCctvPath(fileKey) {
  if (!fileKey || typeof fileKey !== 'string') {
    return null;
  }
  const base = path.basename(fileKey);
  if (base !== fileKey || base.includes('..')) {
    return null;
  }
  const ext = path.extname(base).toLowerCase();
  if (!VIDEO_MIME_BY_EXT[ext]) {
    return null;
  }
  const resolved = path.resolve(CCTV_UPLOAD_DIR, base);
  if (!resolved.startsWith(CCTV_UPLOAD_DIR + path.sep) && resolved !== CCTV_UPLOAD_DIR) {
    return null;
  }
  return resolved;
}

async function readFileHeader(filePath, length = 12) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const header = Buffer.alloc(length);
    const { bytesRead } = await handle.read(header, 0, length, 0);
    return header.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function saveCctvVideo(file) {
  const incomingPath = file && file.path ? file.path : null;

  try {
    if (!file || (!file.buffer && !incomingPath)) {
      throw new AppError('Please select a recorded CCTV file.', 400);
    }

    const size = Number(file.size) || (file.buffer ? file.buffer.length : 0);
    if (size > MAX_CCTV_BYTES) {
      throw new AppError(cctvSizeLimitMessage(), 400);
    }

    const header = incomingPath ? await readFileHeader(incomingPath) : file.buffer;
    const ext = detectVideoExtension(header);
    if (!ext) {
      throw new AppError('Please upload an MP4 or WebM video file.', 400);
    }

    await ensureCctvUploadDir();
    const fileKey = `${crypto.randomUUID()}${ext}`;
    const dest = safeCctvPath(fileKey);
    if (!dest) {
      throw new AppError('Unable to save the CCTV file. Please try again.', 500);
    }

    if (incomingPath) {
      await fsp.rename(incomingPath, dest);
    } else {
      await fsp.writeFile(dest, file.buffer);
    }

    // Keep the original if the browser-compatible copy cannot be made.
    try {
      const { prepareBrowserPlayback } = require('./cctvTranscodeService');
      await prepareBrowserPlayback(dest);
    } catch (transcodeErr) {
      console.error('Unable to prepare a browser preview for CCTV.', transcodeErr && transcodeErr.name);
    }

    return {
      fileKey,
      displayName: sanitizeCctvDisplayName(file.originalname, ext),
      contentType: VIDEO_MIME_BY_EXT[ext]
    };
  } catch (err) {
    if (incomingPath) {
      await fsp.unlink(incomingPath).catch(() => {});
    }
    throw err;
  }
}

async function deleteCctvVideo(fileKey) {
  const dest = safeCctvPath(fileKey);
  if (!dest) {
    return;
  }
  try {
    await fsp.unlink(dest);
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      throw err;
    }
  }
}

function contentTypeForCctvKey(fileKey) {
  const ext = path.extname(String(fileKey || '')).toLowerCase();
  return VIDEO_MIME_BY_EXT[ext] || 'application/octet-stream';
}

function streamCctvFile(req, res, filePath, contentType, downloadName) {
  const stat = fs.statSync(filePath);
  const size = stat.size;
  const safeName = String(downloadName || 'recording.mp4').replace(/"/g, '');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Chrome can play the clip, but no-store prevents the video element from buffering it.
  res.setHeader('Cache-Control', 'private, no-cache');

  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(range));
    if (!match) {
      res.status(416).end();
      return;
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start >= size || end >= size || start > end) {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${size}`);
      res.end();
      return;
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', end - start + 1);
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.setHeader('Content-Length', size);
  fs.createReadStream(filePath).pipe(res);
}

module.exports = {
  MAX_IMAGE_BYTES,
  MAX_CCTV_MB,
  MAX_CCTV_BYTES,
  cctvSizeLimitMessage,
  UPLOAD_DIR,
  CCTV_UPLOAD_DIR,
  EVIDENCE_UPLOAD_DIR,
  detectImageExtension,
  detectVideoExtension,
  saveReportImage,
  deleteReportImage,
  readReportImage,
  saveCctvVideo,
  deleteCctvVideo,
  safeImagePath,
  safeCctvPath,
  safeEvidencePath,
  storeEvidenceImage,
  deleteEvidenceImage,
  contentTypeForKey,
  contentTypeForCctvKey,
  streamCctvFile,
  sanitizeCctvDisplayName,
  readFileHeader,
  ensureUploadDir,
  ensureCctvUploadDir,
  ensureEvidenceDir
};
