const multer = require('multer');
const { AppError } = require('../utils/AppError');
const { MAX_IMAGE_BYTES, detectImageExtension } = require('../services/uploadService');

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/jpg']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_BYTES,
    files: 1
  },
  fileFilter(req, file, cb) {
    const mimeOk = ALLOWED_MIMES.has(String(file.mimetype || '').toLowerCase());
    const name = String(file.originalname || '').toLowerCase();
    const extOk = name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || name.endsWith('.webp');
    if (!mimeOk && !extOk) {
      return cb(new AppError('Please upload a JPEG, PNG, or WebP image.', 400));
    }
    cb(null, true);
  }
});

function reportImageUpload(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (err) {
      return next(err);
    }
    if (req.file && !detectImageExtension(req.file.buffer)) {
      return next(new AppError('Please upload a JPEG, PNG, or WebP image.', 400));
    }
    next();
  });
}

module.exports = { reportImageUpload };
