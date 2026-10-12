const { spawn } = require('child_process');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const CctvAnalysis = require('../models/CctvAnalysis');
const EvidenceFrame = require('../models/EvidenceFrame');
const { AppError } = require('../utils/AppError');
const config = require('../config/aiConfig');
const analysisService = require('./cctvAnalysisService');
const { deleteEvidenceForFootage } = require('./evidenceStorageService');
const { storeEvidenceImage } = require('./uploadService');

// Admin-facing text for every extraction failure. Internal details (paths,
// library errors, stack traces) are logged on the server only.
const FAILURE_MESSAGES = {
  DEPENDENCY_MISSING: 'The evidence extraction environment is not ready on this server.',
  WORKER_UNAVAILABLE: 'The evidence extraction environment is not ready on this server.',
  VIDEO_MISSING: 'CCTV footage is unavailable.',
  VIDEO_OPEN_FAILED: 'This CCTV recording could not be opened for frame extraction.',
  VIDEO_METADATA_INVALID: 'This CCTV recording has unusable video information.',
  CONFIG_INVALID: 'Evidence frames could not be requested for this recording.',
  INSUFFICIENT_RESOURCES: 'The server ran out of resources during frame extraction.',
  TIMEOUT: 'Evidence frame extraction took too long and was stopped.',
  STORAGE_FAILED: 'The extracted evidence frames could not be stored.',
  NO_FRAMES: 'No evidence frame could be read from this recording.',
  UNEXPECTED_ERROR: 'Evidence frames could not be extracted for this recording.'
};

const EVENT_LABELS = {
  LAST_SEEN: 'Item Last Seen',
  DISAPPEARANCE: 'Estimated Item Disappearance',
  POST_DISAPPEARANCE: 'First Post-Disappearance Frame',
  PERSON_FIRST_APPEARANCE: 'Anonymous Track First Appearance'
};

// A frame picked by a fixed offset is named after the event it follows, so it
// never implies a detection or a disappearance that was not established.
const BASIS_EVENT_LABELS = {
  AFTER_DISAPPEARANCE_OFFSET: 'Frame After Estimated Disappearance',
  AFTER_LAST_SEEN_OFFSET: 'Frame After Item Last Seen'
};

const BASIS_DESCRIPTIONS = {
  ITEM_DETECTION: 'Final sampled frame in which the reported item was detected.',
  DISAPPEARANCE_ESTIMATE:
    'Frame at the estimated disappearance point. It does not show what caused the disappearance.',
  PERSON_DETECTION: 'First frame in which this anonymous track was detected.',
  AFTER_DISAPPEARANCE_OFFSET:
    'Frame recorded shortly after the estimated disappearance. No anonymous track was detected at this point.',
  AFTER_LAST_SEEN_OFFSET:
    'Frame recorded shortly after the item was last detected. This recording did not confirm a disappearance point.'
};

const runningExtractions = new Map();

function failureMessage(code) {
  return FAILURE_MESSAGES[code] || FAILURE_MESSAGES.UNEXPECTED_ERROR;
}

function finite(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function round(value, decimals = 3) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** The point the analysis treats as "the item is gone from here on". */
function disappearanceReference(analysis) {
  const estimated = finite(analysis.disappearanceSeconds);
  return estimated === null ? finite(analysis.itemLastSeenSeconds) : estimated;
}

/**
 * Which real event that reference came from. When no disappearance was
 * established, the last detection is used and must be named as such.
 */
function referenceFrom(analysis) {
  if (finite(analysis.disappearanceSeconds) !== null) {
    return 'DISAPPEARANCE';
  }
  return finite(analysis.itemLastSeenSeconds) === null ? null : 'LAST_SEEN';
}

/** Anonymous tracks that were first detected at or after that reference. */
function postDisappearanceTracks(analysis) {
  const reference = disappearanceReference(analysis);
  if (reference === null) {
    return [];
  }
  return (analysis.anonymousPersonTracking || [])
    .filter((row) => finite(row.firstSeenSeconds) !== null && row.firstSeenSeconds >= reference)
    .sort((a, b) => a.firstSeenSeconds - b.firstSeenSeconds);
}

/**
 * Decide which stills are worth extracting. Every entry comes from a timestamp
 * Module 5 actually produced; nothing is invented. An empty list means the
 * analysis did not determine enough to place a frame.
 */
function evidenceTargets(analysis) {
  if (!analysis || analysis.processingStatus !== 'COMPLETED') {
    return [];
  }

  const targets = [];
  const duration = finite(analysis.videoDurationSeconds);
  const lastSeen = finite(analysis.itemLastSeenSeconds);
  const disappearance = finite(analysis.disappearanceSeconds);
  const reference = disappearanceReference(analysis);
  const detected = (analysis.itemTracking || []).length > 0;

  if (detected && lastSeen !== null) {
    targets.push({
      evidenceType: 'LAST_SEEN',
      basis: 'ITEM_DETECTION',
      trackingId: null,
      timestampSeconds: lastSeen
    });
  }

  if (disappearance !== null) {
    targets.push({
      evidenceType: 'DISAPPEARANCE',
      basis: 'DISAPPEARANCE_ESTIMATE',
      trackingId: null,
      timestampSeconds: disappearance
    });
  }

  const tracksAfter = postDisappearanceTracks(analysis);

  if (tracksAfter.length > 0) {
    targets.push({
      evidenceType: 'POST_DISAPPEARANCE',
      basis: 'PERSON_DETECTION',
      trackingId: tracksAfter[0].trackingId,
      timestampSeconds: finite(tracksAfter[0].firstSeenSeconds)
    });
  } else if (reference !== null) {
    const offset = reference + config.POST_DISAPPEARANCE_OFFSET_SECONDS;
    const limit = duration === null ? offset : Math.min(offset, Math.max(0, duration - 0.5));
    if (limit > reference) {
      targets.push({
        evidenceType: 'POST_DISAPPEARANCE',
        basis: disappearance === null ? 'AFTER_LAST_SEEN_OFFSET' : 'AFTER_DISAPPEARANCE_OFFSET',
        trackingId: null,
        timestampSeconds: round(limit)
      });
    }
  }

  tracksAfter.slice(0, config.EVIDENCE_MAX_PERSON_FRAMES).forEach((track) => {
    targets.push({
      evidenceType: 'PERSON_FIRST_APPEARANCE',
      basis: 'PERSON_DETECTION',
      trackingId: track.trackingId,
      timestampSeconds: finite(track.firstSeenSeconds)
    });
  });

  return targets
    .filter((row) => row.timestampSeconds !== null && row.timestampSeconds >= 0)
    .map((row, index) => ({ ...row, key: `f${index}`, sortOrder: index }));
}

function workerEnv() {
  // Deliberately minimal: database, JWT, and mail secrets are not shared with
  // the extraction subprocess.
  return {
    PATH: process.env.PATH || '/usr/bin:/bin',
    HOME: process.env.HOME || os.homedir(),
    TMPDIR: os.tmpdir(),
    LANG: process.env.LANG || 'en_US.UTF-8',
    OMP_NUM_THREADS: '1'
  };
}

/**
 * Run the OpenCV still-frame worker. Returns the parsed worker result plus the
 * temporary directory the caller must clean up.
 */
async function runFrameWorker({ videoPath, targets }) {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tracex-evidence-'));
  const configPath = path.join(tempDir, 'config.json');
  const outPath = path.join(tempDir, 'result.json');

  const payload = {
    videoPath,
    outputDir: tempDir,
    maxWidth: config.EVIDENCE_MAX_WIDTH,
    jpegQuality: config.EVIDENCE_JPEG_QUALITY,
    targets: targets.map((row) => ({ key: row.key, timestampSeconds: row.timestampSeconds }))
  };

  await fsp.writeFile(configPath, JSON.stringify(payload), 'utf8');

  const exit = await new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        config.PYTHON_BIN,
        [config.FRAME_WORKER_SCRIPT, '--config', configPath, '--out', outPath],
        {
          cwd: config.AI_DIR,
          env: workerEnv(),
          stdio: ['ignore', 'ignore', 'pipe'],
          timeout: config.EVIDENCE_TIMEOUT_MS,
          killSignal: 'SIGKILL'
        }
      );
    } catch (err) {
      resolve({ spawnError: err, timedOut: false });
      return;
    }

    let stderr = '';
    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        if (stderr.length < 4000) {
          stderr += chunk;
        }
      });
    }

    child.on('error', (err) => resolve({ spawnError: err, timedOut: false, stderr }));
    child.on('close', (code, signal) => {
      resolve({ code, timedOut: signal === 'SIGKILL' || code === null, stderr });
    });
  });

  if (exit.spawnError) {
    console.error(
      'Evidence frame worker could not start:',
      exit.spawnError.code || 'spawn error'
    );
    return { ok: false, errorCode: 'WORKER_UNAVAILABLE', tempDir };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(await fsp.readFile(outPath, 'utf8'));
  } catch {
    parsed = null;
  }

  if (!parsed) {
    if (exit.stderr) {
      console.error('Evidence frame worker failed without a result file.');
    }
    return { ok: false, errorCode: exit.timedOut ? 'TIMEOUT' : 'WORKER_UNAVAILABLE', tempDir };
  }

  if (!parsed.ok) {
    console.error(`Evidence frame worker error (${parsed.errorCode || 'UNKNOWN'}).`);
    return { ok: false, errorCode: parsed.errorCode || 'UNEXPECTED_ERROR', tempDir };
  }

  return { ...parsed, tempDir };
}

async function persistFrames({ investigation, footage, analysis, targets, frames, userId }) {
  const byKey = new Map((frames || []).map((row) => [String(row.key), row]));
  const documents = [];

  for (const target of targets) {
    const produced = byKey.get(target.key);
    if (!produced || !produced.available || !produced.file) {
      continue;
    }
    const imageKey = await storeEvidenceImage(produced.file);
    documents.push({
      investigationId: investigation._id,
      footageId: footage._id,
      itemId: analysis.itemId,
      evidenceType: target.evidenceType,
      basis: target.basis,
      trackingId: target.trackingId || null,
      timestampSeconds: target.timestampSeconds,
      frameNumber: Number.isFinite(Number(produced.frameNumber))
        ? Number(produced.frameNumber)
        : null,
      imageKey,
      width: Number(produced.width) || null,
      height: Number(produced.height) || null,
      sortOrder: target.sortOrder,
      extractedBy: userId || null
    });
  }

  if (documents.length > 0) {
    await EvidenceFrame.insertMany(documents);
  }
  return documents.length;
}

async function executeExtraction({ investigation, footage, analysis, targets, videoPath, userId }) {
  let update;
  let tempDir = null;

  try {
    const result = await service.runFrameWorker({ videoPath, targets });
    tempDir = result.tempDir || null;

    if (!result.ok) {
      update = {
        evidenceStatus: 'FAILED',
        evidenceExtractedAt: new Date(),
        evidenceError: failureMessage(result.errorCode)
      };
    } else {
      // Replace any earlier stills for this recording so the set stays consistent.
      await deleteEvidenceForFootage(footage._id);
      const saved = await persistFrames({
        investigation,
        footage,
        analysis,
        targets,
        frames: result.frames,
        userId
      });
      update = saved > 0
        ? {
          evidenceStatus: 'COMPLETED',
          evidenceExtractedAt: new Date(),
          evidenceError: null
        }
        : {
          evidenceStatus: 'FAILED',
          evidenceExtractedAt: new Date(),
          evidenceError: FAILURE_MESSAGES.NO_FRAMES
        };
    }
  } catch (err) {
    console.error('Evidence frame extraction error:', (err && err.name) || 'Error');
    update = {
      evidenceStatus: 'FAILED',
      evidenceExtractedAt: new Date(),
      evidenceError: FAILURE_MESSAGES.UNEXPECTED_ERROR
    };
  } finally {
    if (tempDir) {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  try {
    await CctvAnalysis.updateOne({ _id: analysis._id }, { $set: update });
  } catch (err) {
    console.error('Unable to save evidence extraction state:', (err && err.name) || 'Error');
  }

  return update.evidenceStatus;
}

function isExtracting(footageId) {
  return runningExtractions.has(String(footageId));
}

function activeExtraction(footageId) {
  return runningExtractions.get(String(footageId)) || null;
}

function isExtractionStale(analysis) {
  if (!analysis || !analysis.evidenceStartedAt) {
    return true;
  }
  return Date.now() - new Date(analysis.evidenceStartedAt).getTime() > config.EVIDENCE_STALE_MS;
}

/**
 * Extract the evidence stills for one recording, once. Opening the
 * Investigation Details page never re-runs detection or tracking; this only
 * seeks to timestamps Module 5 already produced.
 *
 * `explicit` requests (the admin pressing the button) report problems as
 * errors; background requests simply decline.
 */
async function ensureEvidence({ investigation, footage, analysis, userId, explicit = false }) {
  function decline(message, status = 409) {
    if (explicit) {
      throw new AppError(message, status);
    }
    return false;
  }

  if (!analysis || analysis.processingStatus !== 'COMPLETED') {
    return decline('AI analysis has not completed for this recording.');
  }

  if (isExtracting(footage._id)) {
    return decline('Evidence frames are already being extracted for this recording.');
  }

  if (analysis.evidenceStatus === 'EXTRACTING' && !isExtractionStale(analysis)) {
    return decline('Evidence frames are already being extracted for this recording.');
  }

  const targets = evidenceTargets(analysis);
  if (targets.length === 0) {
    // Nothing can be placed honestly. Settling the state stops the page from
    // asking again, and the reason stays the same on every later request.
    if (analysis.evidenceStatus !== 'COMPLETED') {
      const settled = {
        evidenceStatus: 'COMPLETED',
        evidenceExtractedAt: new Date(),
        evidenceError: null
      };
      await CctvAnalysis.updateOne({ _id: analysis._id }, { $set: settled });
      Object.assign(analysis, settled);
    }
    return decline('No evidence frame can be derived from this analysis.');
  }

  if (analysis.evidenceStatus === 'COMPLETED') {
    return decline('Evidence frames have already been extracted for this recording.');
  }

  const videoPath = await analysisService.resolveExistingCctvFile(footage.fileKey);
  if (!videoPath) {
    const settled = {
      evidenceStatus: 'FAILED',
      evidenceExtractedAt: new Date(),
      evidenceError: FAILURE_MESSAGES.VIDEO_MISSING
    };
    await CctvAnalysis.updateOne({ _id: analysis._id }, { $set: settled });
    Object.assign(analysis, settled);
    return decline('CCTV footage is unavailable.', 404);
  }

  await CctvAnalysis.updateOne(
    { _id: analysis._id },
    {
      $set: {
        evidenceStatus: 'EXTRACTING',
        evidenceStartedAt: new Date(),
        evidenceExtractedAt: null,
        evidenceError: null
      },
      $inc: { evidenceAttempts: 1 }
    }
  );
  analysis.evidenceStatus = 'EXTRACTING';

  const key = String(footage._id);
  const job = executeExtraction({
    investigation,
    footage,
    analysis,
    targets,
    videoPath,
    userId
  }).finally(() => {
    runningExtractions.delete(key);
  });
  runningExtractions.set(key, job);

  return true;
}

async function listEvidenceForFootage(footageId) {
  return EvidenceFrame.find({ footageId }).sort({ sortOrder: 1, timestampSeconds: 1 });
}

function mapEvidenceFrame(frame, investigationId, recordingStartTime) {
  const id = frame._id.toString();
  return {
    id,
    evidenceType: frame.evidenceType,
    basis: frame.basis,
    eventLabel:
      BASIS_EVENT_LABELS[frame.basis] || EVENT_LABELS[frame.evidenceType] || 'Evidence Frame',
    description: BASIS_DESCRIPTIONS[frame.basis] || null,
    trackingId: frame.trackingId || null,
    timestamp: analysisService.timePoint(frame.timestampSeconds, recordingStartTime),
    frameNumber: Number.isFinite(frame.frameNumber) ? frame.frameNumber : null,
    width: frame.width || null,
    height: frame.height || null,
    imageUrl: `/api/admin/investigations/${investigationId}/evidence/${id}/image`
  };
}

const service = {
  FAILURE_MESSAGES,
  EVENT_LABELS,
  BASIS_EVENT_LABELS,
  BASIS_DESCRIPTIONS,
  disappearanceReference,
  referenceFrom,
  postDisappearanceTracks,
  evidenceTargets,
  runFrameWorker,
  ensureEvidence,
  listEvidenceForFootage,
  mapEvidenceFrame,
  isExtracting,
  activeExtraction,
  isExtractionStale
};

module.exports = service;
