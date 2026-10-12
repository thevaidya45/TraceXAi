const { spawn } = require('child_process');
const crypto = require('crypto');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const CctvAnalysis = require('../models/CctvAnalysis');
const { MAX_TRACKS_STORED } = require('../models/CctvAnalysis');
const Investigation = require('../models/Investigation');
const { AppError } = require('../utils/AppError');
const { notEqual } = require('../utils/trustedQuery');
const { securityLog } = require('../utils/securityLog');
const { deleteEvidenceForFootage } = require('./evidenceStorageService');
const { safeCctvPath } = require('./uploadService');
const config = require('../config/aiConfig');

// Admin-facing text for every failure the worker can report. Internal details
// (paths, stack traces, library errors) are logged on the server only.
const FAILURE_MESSAGES = {
  DEPENDENCY_MISSING: 'The AI analysis environment is not ready on this server.',
  MODEL_MISSING: 'The AI detection model is not installed on this server.',
  MODEL_LOAD_FAILED: 'The AI detection model could not be loaded.',
  MODEL_CLASSES_UNAVAILABLE: 'The AI detection model does not support this analysis.',
  VIDEO_MISSING: 'CCTV footage is unavailable.',
  VIDEO_OPEN_FAILED: 'This CCTV recording could not be opened for analysis.',
  VIDEO_METADATA_INVALID: 'This CCTV recording has unusable video information.',
  NO_FRAMES: 'No readable video frames were found in this recording.',
  TRACKING_FAILED: 'AI analysis could not complete for this recording.',
  INSUFFICIENT_RESOURCES: 'The server ran out of resources during analysis.',
  TIMEOUT: 'AI analysis took too long and was stopped.',
  WORKER_UNAVAILABLE: 'The AI analysis environment is not ready on this server.',
  CONFIG_INVALID: 'AI analysis could not be started for this recording.',
  UNEXPECTED_ERROR: 'AI analysis could not complete for this recording.'
};

const runningJobs = new Map();

function failureMessage(code) {
  return FAILURE_MESSAGES[code] || FAILURE_MESSAGES.UNEXPECTED_ERROR;
}

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

/**
 * Decide which YOLO classes can stand in for the reported item. Returns
 * `supported: false` when the configured model cannot represent the item, so
 * the UI can say so instead of implying a detection.
 */
function itemTargetClasses(item) {
  const name = normalizeText(item && item.itemName);
  const description = normalizeText(item && item.description);
  const category = normalizeText(item && item.category);
  const haystack = `${name} ${description}`;

  for (const [keywords, classes] of config.ITEM_KEYWORD_CLASSES) {
    if (keywords.some((keyword) => haystack.includes(keyword))) {
      return { classes: [...classes], supported: true, note: null };
    }
  }

  const byCategory = config.CATEGORY_CLASSES[category];
  if (byCategory && byCategory.length > 0) {
    return { classes: [...byCategory], supported: true, note: null };
  }

  return { classes: [], supported: false, note: config.UNSUPPORTED_ITEM_NOTE };
}

/**
 * Resolve the CCTV file that Module 4 already stored on disk. The only input is
 * the server-generated fileKey; no client-supplied path is ever used.
 */
async function resolveExistingCctvFile(fileKey) {
  const resolved = safeCctvPath(fileKey);
  if (!resolved) {
    return null;
  }
  try {
    const stat = await fsp.stat(resolved);
    if (!stat.isFile() || stat.size === 0) {
      return null;
    }
  } catch {
    return null;
  }
  return resolved;
}

function workerEnv() {
  // Deliberately minimal: database, JWT, and mail secrets are not shared with
  // the analysis subprocess.
  return {
    PATH: process.env.PATH || '/usr/bin:/bin',
    HOME: process.env.HOME || os.homedir(),
    TMPDIR: os.tmpdir(),
    LANG: process.env.LANG || 'en_US.UTF-8',
    YOLO_VERBOSE: 'false',
    YOLO_AUTOINSTALL: 'false',
    OMP_NUM_THREADS: '1'
  };
}

async function runWorker(job) {
  const runId = crypto.randomUUID();
  const configPath = path.join(os.tmpdir(), `tracex-ai-${runId}.config.json`);
  const outPath = path.join(os.tmpdir(), `tracex-ai-${runId}.result.json`);

  const payload = {
    videoPath: job.videoPath,
    modelPath: config.YOLO_MODEL_PATH,
    personClass: config.PERSON_CLASS,
    itemClasses: job.itemClasses || [],
    confidence: config.YOLO_CONFIDENCE_THRESHOLD,
    frameInterval: config.FRAME_INTERVAL,
    maxSampledFrames: config.MAX_SAMPLED_FRAMES,
    tracker: config.TRACKER_CONFIG
  };

  try {
    await fsp.writeFile(configPath, JSON.stringify(payload), 'utf8');

    const exit = await new Promise((resolve) => {
      let child;
      try {
        child = spawn(
          config.PYTHON_BIN,
          [config.WORKER_SCRIPT, '--config', configPath, '--out', outPath],
          {
            cwd: config.AI_DIR,
            env: workerEnv(),
            stdio: ['ignore', 'ignore', 'pipe'],
            timeout: config.PROCESSING_TIMEOUT_MS,
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
        resolve({
          code,
          timedOut: signal === 'SIGKILL' || code === null,
          stderr
        });
      });
    });

    if (exit.spawnError) {
      console.error('CCTV analysis worker could not start:', exit.spawnError.code || 'spawn error');
      return failure('WORKER_UNAVAILABLE');
    }

    let parsed = null;
    try {
      parsed = JSON.parse(await fsp.readFile(outPath, 'utf8'));
    } catch {
      parsed = null;
    }

    if (!parsed) {
      if (exit.timedOut) {
        return failure('TIMEOUT');
      }
      if (exit.stderr) {
        console.error('CCTV analysis worker failed without a result file.');
      }
      return failure('WORKER_UNAVAILABLE');
    }

    if (!parsed.ok) {
      if (parsed.errorDetail) {
        console.error(`CCTV analysis worker error (${parsed.errorCode || 'UNKNOWN'}).`);
      }
      return failure(parsed.errorCode || 'UNEXPECTED_ERROR');
    }

    return parsed;
  } finally {
    await Promise.all([
      fsp.unlink(configPath).catch(() => {}),
      fsp.unlink(outPath).catch(() => {})
    ]);
  }
}

function failure(code) {
  return { ok: false, errorCode: code };
}

function round(value, decimals = 2) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Derive last-seen, disappearance, and missing duration from real detections.
 * Every unavailable value stays null so the API can report it honestly.
 */
function deriveItemTimeline({ itemTracks, sampleTimestamps, durationSeconds, toleranceSeconds }) {
  const tracks = Array.isArray(itemTracks) ? itemTracks : [];
  const empty = {
    firstSeenSeconds: null,
    lastSeenSeconds: null,
    disappearanceSeconds: null,
    disappearanceCertainty: null,
    observedAbsenceSeconds: null,
    missingDurationSeconds: null
  };

  if (tracks.length === 0) {
    return empty;
  }

  const firstSeen = Math.min(...tracks.map((row) => Number(row.firstSeenSeconds)));
  const lastSeen = Math.max(...tracks.map((row) => Number(row.lastSeenSeconds)));
  if (!Number.isFinite(firstSeen) || !Number.isFinite(lastSeen)) {
    return empty;
  }

  const samples = (Array.isArray(sampleTimestamps) ? sampleTimestamps : [])
    .map(Number)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  const observedEnd = Number.isFinite(durationSeconds)
    ? durationSeconds
    : samples.length > 0
      ? samples[samples.length - 1]
      : lastSeen;
  const observedAbsence = Math.max(0, observedEnd - lastSeen);

  const tolerance = Number.isFinite(toleranceSeconds) && toleranceSeconds > 0
    ? toleranceSeconds
    : config.ITEM_ABSENCE_TOLERANCE_SECONDS;

  // The item is absent from every sampled frame after lastSeen. Disappearance
  // is confirmed at the first sampled frame once the tolerance window passed.
  const confirmation = samples.find((value) => value >= lastSeen + tolerance);

  if (confirmation === undefined) {
    return {
      firstSeenSeconds: round(firstSeen),
      lastSeenSeconds: round(lastSeen),
      disappearanceSeconds: null,
      disappearanceCertainty: null,
      observedAbsenceSeconds: round(observedAbsence),
      missingDurationSeconds: null
    };
  }

  return {
    firstSeenSeconds: round(firstSeen),
    lastSeenSeconds: round(lastSeen),
    disappearanceSeconds: round(confirmation),
    disappearanceCertainty: observedAbsence >= tolerance * 3 ? 'high' : 'moderate',
    observedAbsenceSeconds: round(observedAbsence),
    missingDurationSeconds: round(confirmation - lastSeen)
  };
}

function labelTracks(rows, prefix) {
  return (Array.isArray(rows) ? rows : [])
    .slice(0, MAX_TRACKS_STORED)
    .map((row, index) => ({
      trackingId: `${prefix}-${String(index + 1).padStart(3, '0')}`,
      yoloClass: row.yoloClass || null,
      firstSeenSeconds: round(Number(row.firstSeenSeconds)),
      lastSeenSeconds: round(Number(row.lastSeenSeconds)),
      framesTracked: Number(row.framesTracked) || 0,
      bestConfidence: Number.isFinite(Number(row.bestConfidence))
        ? round(Number(row.bestConfidence), 3)
        : null
    }));
}

function buildCompletedUpdate(result, target) {
  const video = result.video || {};
  const counts = result.detectionCounts || {};
  const personTracks = labelTracks(result.personTracks, 'P');
  const itemTracks = labelTracks(result.itemTracks, 'I');

  const timeline = deriveItemTimeline({
    itemTracks: result.itemTracks,
    sampleTimestamps: result.sampleTimestamps,
    durationSeconds: Number(video.durationSeconds),
    toleranceSeconds: config.ITEM_ABSENCE_TOLERANCE_SECONDS
  });

  let note = target.supported ? null : target.note;
  if (target.supported && itemTracks.length === 0) {
    note = 'The reported item was not detected in this recording.';
  }
  if (video.truncated) {
    note = note
      ? `${note} Analysis stopped at the configured frame limit.`
      : 'Analysis stopped at the configured frame limit.';
  }

  return {
    processingStatus: 'COMPLETED',
    processingCompletedAt: new Date(),
    processingError: null,
    videoFps: Number.isFinite(Number(video.fps)) ? Number(video.fps) : null,
    frameCount: Number.isFinite(Number(video.frameCount)) ? Number(video.frameCount) : null,
    videoDurationSeconds: Number.isFinite(Number(video.durationSeconds))
      ? Number(video.durationSeconds)
      : null,
    framesSampled: Number(video.framesSampled) || 0,
    frameInterval: Number(video.frameInterval) || null,
    modelName: (result.model && result.model.name) || null,
    confidenceThreshold: (result.model && result.model.confidence) || null,
    itemDetectionSupported: Boolean(target.supported),
    itemDetectionNote: note,
    itemTargetClasses: target.classes,
    itemTracking: itemTracks,
    itemFirstSeenSeconds: timeline.firstSeenSeconds,
    itemLastSeenSeconds: timeline.lastSeenSeconds,
    disappearanceSeconds: timeline.disappearanceSeconds,
    disappearanceCertainty: timeline.disappearanceCertainty,
    observedAbsenceSeconds: timeline.observedAbsenceSeconds,
    missingDurationSeconds: timeline.missingDurationSeconds,
    anonymousPersonTracking: personTracks,
    detectionStatistics: {
      framesSampled: Number(video.framesSampled) || 0,
      personDetections: Number(counts.personDetections) || 0,
      itemDetections: Number(counts.itemDetections) || 0,
      uniquePersonTracks: (result.personTracks || []).length,
      uniqueItemTracks: (result.itemTracks || []).length
    }
  };
}

function isStale(analysis) {
  if (!analysis || !analysis.processingStartedAt) {
    return true;
  }
  return Date.now() - new Date(analysis.processingStartedAt).getTime() > config.STALE_PROCESSING_MS;
}

function isRunning(footageId) {
  return runningJobs.has(String(footageId));
}

function activeJob(footageId) {
  return runningJobs.get(String(footageId)) || null;
}

/** Settle the case status once no analysis is running for it. */
async function settleInvestigationStatus(investigationId) {
  const investigation = await Investigation.findById(investigationId);
  if (!investigation || investigation.status === 'CLOSED') {
    return;
  }
  const stillProcessing = await CctvAnalysis.countDocuments({
    investigationId,
    processingStatus: 'PROCESSING'
  });
  if (stillProcessing > 0) {
    return;
  }
  const completed = await CctvAnalysis.countDocuments({
    investigationId,
    processingStatus: 'COMPLETED'
  });
  const nextStatus = completed > 0 ? 'COMPLETED' : 'READY';
  if (investigation.status !== nextStatus) {
    investigation.status = nextStatus;
    await investigation.save();
  }
}

async function executeJob({ analysisId, investigationId, videoPath, itemClasses, target }) {
  let update;
  try {
    const result = await service.runWorker({ videoPath, itemClasses });
    update = result.ok
      ? buildCompletedUpdate(result, target)
      : {
        processingStatus: 'FAILED',
        processingCompletedAt: new Date(),
        processingError: failureMessage(result.errorCode)
      };
  } catch (err) {
    console.error('CCTV analysis job error:', (err && err.name) || 'Error');
    update = {
      processingStatus: 'FAILED',
      processingCompletedAt: new Date(),
      processingError: FAILURE_MESSAGES.UNEXPECTED_ERROR
    };
  }

  try {
    await CctvAnalysis.updateOne({ _id: analysisId }, { $set: update });
    await settleInvestigationStatus(investigationId);
  } catch (err) {
    console.error('Unable to save CCTV analysis result:', (err && err.name) || 'Error');
  }

  return update.processingStatus;
}

/**
 * Validate, mark PROCESSING, and start the analysis in the background. The HTTP
 * request does not stay open for the whole video.
 */
async function startAnalysis({ investigation, footage, item, userId, allowRetry }) {
  const footageKey = String(footage._id);

  let analysis = await CctvAnalysis.findOne({ footageId: footage._id });

  if (analysis) {
    const activeHere = analysis.processingStatus === 'PROCESSING'
      && (isRunning(footageKey) || !isStale(analysis));
    if (activeHere) {
      throw new AppError('AI analysis is already running for this recording.', 409);
    }
    if (analysis.processingStatus === 'COMPLETED') {
      throw new AppError('This recording has already been analysed.', 409);
    }
    // Retry only resumes a failed or abandoned run.
    if (allowRetry && !['FAILED', 'PROCESSING'].includes(analysis.processingStatus)) {
      throw new AppError('There is no failed analysis to retry for this recording.', 409);
    }
  } else if (allowRetry) {
    throw new AppError('There is no failed analysis to retry for this recording.', 409);
  }

  // Only one recording per investigation may be analysed at a time.
  const otherRunning = await CctvAnalysis.findOne({
    investigationId: investigation._id,
    footageId: notEqual(footage._id),
    processingStatus: 'PROCESSING'
  });
  if (otherRunning && (isRunning(otherRunning.footageId) || !isStale(otherRunning))) {
    throw new AppError('AI analysis is already running for this investigation.', 409);
  }

  const videoPath = await resolveExistingCctvFile(footage.fileKey);
  if (!videoPath) {
    // The Module 4 reference exists but the recorded file does not.
    const failedUpdate = {
      investigationId: investigation._id,
      footageId: footage._id,
      itemId: item._id,
      processingStatus: 'FAILED',
      processingStartedAt: new Date(),
      processingCompletedAt: new Date(),
      processingError: FAILURE_MESSAGES.VIDEO_MISSING,
      startedBy: userId,
      attempts: (analysis ? analysis.attempts : 0) + 1
    };
    analysis = await CctvAnalysis.findOneAndUpdate(
      { footageId: footage._id },
      { $set: failedUpdate },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    throw new AppError('CCTV footage is unavailable.', 404);
  }

  const target = itemTargetClasses(item);

  const resetFields = {
    investigationId: investigation._id,
    footageId: footage._id,
    itemId: item._id,
    processingStatus: 'PROCESSING',
    processingStartedAt: new Date(),
    processingCompletedAt: null,
    processingError: null,
    startedBy: userId,
    itemDetectionSupported: target.supported,
    itemDetectionNote: target.note,
    itemTargetClasses: target.classes,
    itemTracking: [],
    itemFirstSeenSeconds: null,
    itemLastSeenSeconds: null,
    disappearanceSeconds: null,
    disappearanceCertainty: null,
    observedAbsenceSeconds: null,
    missingDurationSeconds: null,
    anonymousPersonTracking: [],
    evidenceStatus: 'AVAILABLE',
    evidenceStartedAt: null,
    evidenceExtractedAt: null,
    evidenceError: null,
    videoFps: null,
    frameCount: null,
    videoDurationSeconds: null,
    framesSampled: null,
    frameInterval: null,
    modelName: null,
    confidenceThreshold: null,
    detectionStatistics: {
      framesSampled: 0,
      personDetections: 0,
      itemDetections: 0,
      uniquePersonTracks: 0,
      uniqueItemTracks: 0
    }
  };

  // Results for this recording are about to be replaced, so the evidence
  // stills extracted from the previous run must not survive.
  await deleteEvidenceForFootage(footage._id);

  analysis = await CctvAnalysis.findOneAndUpdate(
    { footageId: footage._id },
    { $set: resetFields, $inc: { attempts: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  if (['CREATED', 'CCTV_SELECTED', 'READY'].includes(investigation.status)) {
    investigation.status = 'PROCESSING';
    await investigation.save();
  }

  const job = executeJob({
    analysisId: analysis._id,
    investigationId: investigation._id,
    videoPath,
    itemClasses: target.classes,
    target
  }).finally(() => {
    runningJobs.delete(footageKey);
  });

  runningJobs.set(footageKey, job);

  securityLog('cctv_analysis_started', {
    userId,
    role: 'admin',
    reason: investigation.caseId
  });

  return analysis;
}

async function deleteAnalysisForFootage(footageId) {
  await deleteEvidenceForFootage(footageId);
  await CctvAnalysis.deleteMany({ footageId });
}

function formatOffset(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  const total = Math.round(seconds);
  if (total < 60) {
    return `${total} second${total === 1 ? '' : 's'}`;
  }
  const parts = [];
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  if (secs > 0) parts.push(`${secs} second${secs === 1 ? '' : 's'}`);
  return parts.join(' ');
}

/** Clock time inside the recording, using the recorded start time if present. */
function formatClock(recordingStartTime, offsetSeconds) {
  if (!recordingStartTime || !Number.isFinite(offsetSeconds) || offsetSeconds < 0) {
    return null;
  }
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(recordingStartTime));
  if (!match) {
    return null;
  }
  const base = Number(match[1]) * 3600 + Number(match[2]) * 60;
  const total = Math.floor(base + offsetSeconds) % 86400;
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

function timePoint(seconds, recordingStartTime) {
  if (!Number.isFinite(seconds)) {
    return null;
  }
  const clock = formatClock(recordingStartTime, seconds);
  const offset = formatOffset(seconds);
  return {
    seconds,
    offsetLabel: offset,
    clockTime: clock,
    label: clock ? `${clock} (${offset} into the recording)` : `${offset} into the recording`
  };
}

const NOT_DETERMINED = 'Not determined';
const NOT_RELIABLE = 'Not reliably determined';

function mapTrack(row, recordingStartTime) {
  return {
    trackingId: row.trackingId,
    detectedClass: row.yoloClass || null,
    framesTracked: row.framesTracked,
    confidence: row.bestConfidence,
    firstSeen: timePoint(row.firstSeenSeconds, recordingStartTime),
    lastSeen: timePoint(row.lastSeenSeconds, recordingStartTime)
  };
}

/** API shape for one recording's analysis. Labels are resolved here. */
function mapAnalysis(analysis, footage) {
  const recordingStartTime = footage ? footage.recordingStartTime : null;
  const status = analysis ? analysis.processingStatus : 'AVAILABLE';

  if (!analysis) {
    return {
      footageId: footage ? footage._id.toString() : null,
      status: 'AVAILABLE',
      attempts: 0,
      startedAt: null,
      completedAt: null,
      error: null,
      canStart: true,
      canRetry: false,
      video: null,
      model: null,
      item: null,
      persons: null,
      statistics: null,
      lastSeenLabel: NOT_DETERMINED,
      disappearanceLabel: NOT_RELIABLE,
      missingDurationLabel: NOT_DETERMINED
    };
  }

  const completed = status === 'COMPLETED';
  const lastSeen = completed ? timePoint(analysis.itemLastSeenSeconds, recordingStartTime) : null;
  const firstSeen = completed ? timePoint(analysis.itemFirstSeenSeconds, recordingStartTime) : null;
  const disappearance = completed
    ? timePoint(analysis.disappearanceSeconds, recordingStartTime)
    : null;

  return {
    footageId: analysis.footageId.toString(),
    status,
    attempts: analysis.attempts || 0,
    startedAt: analysis.processingStartedAt,
    completedAt: analysis.processingCompletedAt,
    error: status === 'FAILED' ? analysis.processingError || FAILURE_MESSAGES.UNEXPECTED_ERROR : null,
    canStart: status === 'AVAILABLE',
    canRetry: status === 'FAILED' || (status === 'PROCESSING' && isStale(analysis)),
    video: completed
      ? {
        fps: analysis.videoFps,
        frameCount: analysis.frameCount,
        durationSeconds: analysis.videoDurationSeconds,
        durationLabel: formatDuration(analysis.videoDurationSeconds) || NOT_DETERMINED,
        framesSampled: analysis.framesSampled,
        frameInterval: analysis.frameInterval
      }
      : null,
    model: completed
      ? {
        name: analysis.modelName,
        confidenceThreshold: analysis.confidenceThreshold
      }
      : null,
    item: completed
      ? {
        detectionSupported: Boolean(analysis.itemDetectionSupported),
        note: analysis.itemDetectionNote || null,
        targetClasses: analysis.itemTargetClasses || [],
        detected: (analysis.itemTracking || []).length > 0,
        firstSeen,
        lastSeen,
        tracks: (analysis.itemTracking || []).map((row) => mapTrack(row, recordingStartTime))
      }
      : null,
    persons: completed
      ? {
        uniqueCount: (analysis.detectionStatistics && analysis.detectionStatistics.uniquePersonTracks) || 0,
        tracks: (analysis.anonymousPersonTracking || []).map((row) => mapTrack(row, recordingStartTime))
      }
      : null,
    statistics: completed
      ? {
        framesSampled: analysis.detectionStatistics.framesSampled,
        personDetections: analysis.detectionStatistics.personDetections,
        itemDetections: analysis.detectionStatistics.itemDetections,
        uniquePersonTracks: analysis.detectionStatistics.uniquePersonTracks,
        uniqueItemTracks: analysis.detectionStatistics.uniqueItemTracks
      }
      : null,
    disappearanceCertainty: completed ? analysis.disappearanceCertainty || null : null,
    observedAbsenceLabel: completed && Number.isFinite(analysis.observedAbsenceSeconds)
      ? formatDuration(analysis.observedAbsenceSeconds)
      : null,
    lastSeenLabel: lastSeen ? lastSeen.label : NOT_DETERMINED,
    firstSeenLabel: firstSeen ? firstSeen.label : NOT_DETERMINED,
    disappearanceLabel: disappearance ? disappearance.label : NOT_RELIABLE,
    missingDurationLabel: completed && Number.isFinite(analysis.missingDurationSeconds)
      ? formatDuration(analysis.missingDurationSeconds)
      : NOT_DETERMINED
  };
}

const service = {
  FAILURE_MESSAGES,
  NOT_DETERMINED,
  NOT_RELIABLE,
  itemTargetClasses,
  resolveExistingCctvFile,
  runWorker,
  deriveItemTimeline,
  buildCompletedUpdate,
  startAnalysis,
  deleteAnalysisForFootage,
  settleInvestigationStatus,
  mapAnalysis,
  formatDuration,
  formatOffset,
  formatClock,
  timePoint,
  isRunning,
  activeJob,
  isStale
};

module.exports = service;
