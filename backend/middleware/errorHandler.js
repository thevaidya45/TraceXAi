const { cctvSizeLimitMessage } = require('../services/uploadService');

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  if (err && err.code === 'LIMIT_FILE_SIZE') {
    if (err.field === 'video') {
      return res.status(400).json({
        message: cctvSizeLimitMessage()
      });
    }
    return res.status(400).json({
      message: 'The image must be 2 MB or smaller.'
    });
  }

  if (err && (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT')) {
    return res.status(400).json({
      message: err.field === 'video'
        ? 'Please upload a valid CCTV video file.'
        : 'Please upload a valid image file.'
    });
  }

  if ((err instanceof SyntaxError && err.status === 400 && 'body' in err) ||
      err.name === 'CastError' ||
      err.name === 'ValidationError') {
    return res.status(400).json({
      message: 'Please check the information you entered.'
    });
  }

  const statusCode = err.statusCode || 500;

  if (!err.expose) {
    console.error('Server error:', err.name || 'Error');
  }

  const message = err.expose && err.message
    ? err.message
    : 'Something went wrong. Please try again.';

  res.status(statusCode).json({ message });
}

module.exports = { errorHandler };
