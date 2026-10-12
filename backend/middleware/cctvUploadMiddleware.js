const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { AppError } = require('../utils/AppError');
const {
  MAX_CCTV_BYTES,
  CCTV_UPLOAD_DIR,
  detectVideoExtension,
  ensureCctvUploadDir
} = require('../services/uploadService');

const ALLOWED_MIMES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

const upload = multer({
  storage: multer.diskStorage({
    async destination(req, file, cb) {
      try {
        await ensureCctvUploadDir();
        cb(null, CCTV_UPLOAD_DIR);
      } catch (err) {
        cb(err);
      }
    },
    filename(req, file, cb) {
      cb(null, `incoming-${crypto.randomUUID()}.bin`);
    }
  }),
  limits: {
    fileSize: MAX_CCTV_BYTES,
    files: 1
  },
  fileFilter(req, file, cb) {
    const mimeOk = ALLOWED_MIMES.has(String(file.mimetype || '').toLowerCase());
    const name = String(file.originalname || '').toLowerCase();
    const extOk = name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mov');
    if (!mimeOk && !extOk) {
      return cb(new AppError('Please upload an MP4 or WebM video file.', 400));
    }
    cb(null, true);
  }
});

function readHeaderSync(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(12);
    const bytesRead = fs.readSync(fd, header, 0, 12, 0);
    return header.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function cctvVideoUpload(req, res, next) {
  upload.single('video')(req, res, (err) => {
    if (err) {
      return next(err);
    }
    if (!req.file) {
      return next(new AppError('Please select a recorded CCTV file.', 400));
    }

    try {
      const header = req.file.path ? readHeaderSync(req.file.path) : req.file.buffer;
      if (!detectVideoExtension(header)) {
        if (req.file.path) {
          fs.unlink(req.file.path, () => {});
        }
        return next(new AppError('Please upload an MP4 or WebM video file.', 400));
      }
    } catch {
      if (req.file.path) {
        fs.unlink(req.file.path, () => {});
      }
      return next(new AppError('Please upload an MP4 or WebM video file.', 400));
    }

    next();
  });
}

module.exports = { cctvVideoUpload };
