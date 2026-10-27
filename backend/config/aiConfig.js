const path = require('path');

const AI_DIR = path.resolve(__dirname, '..', 'ai');

function positiveNumber(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
}

// The worker runs in its own virtual environment so the Node server never
// depends on globally installed Python packages.
const PYTHON_BIN = process.env.AI_PYTHON_BIN || path.join(AI_DIR, '.venv', 'bin', 'python');
const WORKER_SCRIPT = path.join(AI_DIR, 'analyze_cctv.py');
const FRAME_WORKER_SCRIPT = path.join(AI_DIR, 'extract_frames.py');
const YOLO_MODEL_PATH = process.env.YOLO_MODEL_PATH || path.join(AI_DIR, 'models', 'yolov8n.pt');
const TRACKER_CONFIG = process.env.AI_TRACKER_CONFIG || 'bytetrack.yaml';

const YOLO_CONFIDENCE_THRESHOLD = positiveNumber(process.env.YOLO_CONFIDENCE_THRESHOLD, 0.35, {
  min: 0.05,
  max: 0.95
});
const FRAME_INTERVAL = Math.round(
  positiveNumber(process.env.FRAME_INTERVAL, 5, { min: 1, max: 300 })
);
const MAX_SAMPLED_FRAMES = Math.round(
  positiveNumber(process.env.AI_MAX_SAMPLED_FRAMES, 7200, { min: 60, max: 100000 })
);
const ITEM_ABSENCE_TOLERANCE_SECONDS = positiveNumber(
  process.env.AI_ITEM_ABSENCE_TOLERANCE_SECONDS,
  20,
  { min: 1, max: 3600 }
);
const PROCESSING_TIMEOUT_MS = Math.round(
  positiveNumber(process.env.AI_PROCESSING_TIMEOUT_MS, 60 * 60 * 1000, {
    min: 5000,
    max: 4 * 60 * 60 * 1000
  })
);
const STALE_PROCESSING_MS = Math.round(
  positiveNumber(process.env.AI_STALE_PROCESSING_MS, 75 * 60 * 1000, {
    min: 60 * 1000,
    max: 12 * 60 * 60 * 1000
  })
);

const PERSON_CLASS = 'person';

// Reported items are matched to classes the configured YOLO model can actually
// detect. Anything not listed here is reported as unsupported instead of guessed.
const ITEM_KEYWORD_CLASSES = [
  [['notebook computer', 'laptop', 'macbook', 'chromebook'], ['laptop']],
  [['mobile phone', 'cell phone', 'cellphone', 'smartphone', 'iphone', 'phone'], ['cell phone']],
  [['backpack', 'rucksack', 'school bag', 'college bag'], ['backpack']],
  [['handbag', 'purse', 'sling bag'], ['handbag']],
  [['suitcase', 'luggage', 'trolley bag'], ['suitcase']],
  // A plain "bag" is not a suitcase. Suitcase stays on the specific words above
  // so cardboard boxes are not reported as the lost bag.
  [['bag'], ['backpack', 'handbag']],
  [['umbrella'], ['umbrella']],
  [['water bottle', 'bottle', 'flask'], ['bottle']],
  [['tumbler', 'coffee cup', 'mug', 'cup'], ['cup']],
  [['keyboard'], ['keyboard']],
  [['mouse'], ['mouse']],
  [['book', 'notebook', 'diary', 'register', 'textbook'], ['book']],
  [['wrist watch', 'watch', 'clock'], ['clock']],
  [['scissors'], ['scissors']],
  [['necktie', 'tie'], ['tie']],
  [['football', 'cricket ball', 'basketball', 'ball'], ['sports ball']],
  [['bicycle', 'cycle'], ['bicycle']],
  [['skateboard'], ['skateboard']],
  [['remote'], ['remote']]
];

const CATEGORY_CLASSES = {
  electronics: ['laptop', 'cell phone', 'keyboard', 'mouse', 'remote'],
  bags: ['backpack', 'handbag'],
  books: ['book'],
  accessories: ['umbrella', 'tie', 'clock']
};

const UNSUPPORTED_ITEM_NOTE = 'Item-specific detection unavailable with the current model.';

// Module 6 — evidence frames are single still images pulled from the recording
// Module 4 already stored. No detection or tracking is re-run here.
const EVIDENCE_MAX_PERSON_FRAMES = Math.round(
  positiveNumber(process.env.EVIDENCE_MAX_PERSON_FRAMES, 6, { min: 1, max: 20 })
);
const EVIDENCE_MAX_WIDTH = Math.round(
  positiveNumber(process.env.EVIDENCE_MAX_WIDTH, 1280, { min: 320, max: 3840 })
);
const EVIDENCE_JPEG_QUALITY = Math.round(
  positiveNumber(process.env.EVIDENCE_JPEG_QUALITY, 85, { min: 40, max: 95 })
);
const EVIDENCE_TIMEOUT_MS = Math.round(
  positiveNumber(process.env.EVIDENCE_TIMEOUT_MS, 5 * 60 * 1000, {
    min: 5000,
    max: 30 * 60 * 1000
  })
);
const EVIDENCE_STALE_MS = Math.round(
  positiveNumber(process.env.EVIDENCE_STALE_MS, 10 * 60 * 1000, {
    min: 60 * 1000,
    max: 60 * 60 * 1000
  })
);
// Used only when no person track exists after the estimated disappearance, so
// the Before/After comparison can still show the scene a moment later.
const POST_DISAPPEARANCE_OFFSET_SECONDS = positiveNumber(
  process.env.EVIDENCE_POST_OFFSET_SECONDS,
  10,
  { min: 1, max: 600 }
);
// Context added around the real events when suggesting a review window.
const REVIEW_WINDOW_LEAD_SECONDS = positiveNumber(process.env.REVIEW_WINDOW_LEAD_SECONDS, 180, {
  min: 5,
  max: 3600
});
const REVIEW_WINDOW_TRAIL_SECONDS = positiveNumber(process.env.REVIEW_WINDOW_TRAIL_SECONDS, 300, {
  min: 5,
  max: 3600
});

module.exports = {
  AI_DIR,
  PYTHON_BIN,
  WORKER_SCRIPT,
  FRAME_WORKER_SCRIPT,
  YOLO_MODEL_PATH,
  TRACKER_CONFIG,
  YOLO_CONFIDENCE_THRESHOLD,
  FRAME_INTERVAL,
  MAX_SAMPLED_FRAMES,
  ITEM_ABSENCE_TOLERANCE_SECONDS,
  PROCESSING_TIMEOUT_MS,
  STALE_PROCESSING_MS,
  PERSON_CLASS,
  ITEM_KEYWORD_CLASSES,
  CATEGORY_CLASSES,
  UNSUPPORTED_ITEM_NOTE,
  EVIDENCE_MAX_PERSON_FRAMES,
  EVIDENCE_MAX_WIDTH,
  EVIDENCE_JPEG_QUALITY,
  EVIDENCE_TIMEOUT_MS,
  EVIDENCE_STALE_MS,
  POST_DISAPPEARANCE_OFFSET_SECONDS,
  REVIEW_WINDOW_LEAD_SECONDS,
  REVIEW_WINDOW_TRAIL_SECONDS
};
