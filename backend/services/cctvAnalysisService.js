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

  // The file can end before that window. A long gap with no further sighting
  // is still an absence: the item is gone by the last frame, and the missing
  // duration is the time from the last sighting to the end of the recording.
  // A gap shorter than half the usual window stays unconfirmed, so a detection
  // that simply stops a moment before the file ends is not called a disappearance.
  if (confirmation === undefined) {
    if (observedAbsence > tolerance / 2 && observedAbsence >= 3 && observedEnd > lastSeen) {
      return {
        firstSeenSeconds: round(firstSeen),
        lastSeenSeconds: round(lastSeen),
        disappearanceSeconds: round(observedEnd),
        disappearanceCertainty: 'moderate',
        observedAbsenceSeconds: round(observedAbsence),
        missingDurationSeconds: round(observedEnd - lastSeen),
        endedDuringAbsence: true
      };
    }
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
    const carried = Number(result.carriedItemDetections) || 0;
    note = carried > 0
      ? 'The reported item was not detected on its own in this recording. Objects overlapping a person were not treated as the lost item.'
      : 'The reported item was not detected in this recording.';
  }
  if (video.truncated) {
    note = note
      ? `${note} Analysis stopped at the configured frame limit.`
      : 'Analysis stopped at the configured frame limit.';
  }
  if (timeline.endedDuringAbsence) {
    const endedNote = 'The item does not appear again. The recording ends before the usual absence check, so the disappearance is estimated at the end of the file and the missing duration runs from the last sighting to that end.';
    note = note ? `${note} ${endedNote}` : endedNote;
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
    },
    videoClock: storedVideoClock(result.videoClock)
  };
}

function sanitizeClockEvents(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((event) => {
      const clock = String(event && event.clock || '');
      const videoSeconds = Number(event && event.videoSeconds);
      if (!/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/.test(clock) || !Number.isFinite(videoSeconds)) {
        return null;
      }
      const readAt = Number(event.readAtSeconds);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(event.date || '')) ? String(event.date) : null;
      return {
        videoSeconds: round(videoSeconds, 3),
        readAtSeconds: Number.isFinite(readAt) ? round(readAt, 3) : round(videoSeconds, 3),
        clock,
        date
      };
    })
    .filter(Boolean);
}

function storedVideoClock(raw) {
  const empty = {
    reliable: false,
    anchorVideoSeconds: null,
    anchorClock: null,
    anchorDate: null,
    events: []
  };
  const events = sanitizeClockEvents(raw && raw.events);
  const clock = String(raw && raw.anchorClock || '');
  const anchorOk = raw && raw.reliable === true && /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/.test(clock);
  if (!anchorOk && events.length === 0) {
    return empty;
  }
  const anchorVideoSeconds = Number(raw && raw.anchorVideoSeconds);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(raw && raw.anchorDate || ''))
    ? String(raw.anchorDate)
    : (events.find((event) => event.date) || {}).date || null;
  return {
    reliable: true,
    anchorVideoSeconds: anchorOk && Number.isFinite(anchorVideoSeconds) ? round(anchorVideoSeconds, 3) : null,
    anchorClock: anchorOk ? clock : null,
    anchorDate: date,
    events
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

function eventSeconds(update) {
  const values = [
    update.itemFirstSeenSeconds,
    update.itemLastSeenSeconds,
    update.disappearanceSeconds
  ];
  for (const track of update.itemTracking || []) {
    values.push(track.firstSeenSeconds, track.lastSeenSeconds);
  }
  const unique = [];
  for (const value of values) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) {
      continue;
    }
    const rounded = round(seconds, 3);
    if (!unique.some((existing) => Math.abs(existing - rounded) < 0.05)) {
      unique.push(rounded);
    }
  }
  return unique;
}

async function readEventClocks(videoPath, seconds) {
  const wanted = (Array.isArray(seconds) ? seconds : []).filter((value) => Number.isFinite(Number(value)));
  if (!videoPath || wanted.length === 0) {
    return [];
  }
  const runId = crypto.randomUUID();
  const outPath = path.join(os.tmpdir(), `tracex-clock-${runId}.json`);
  const script = path.join(config.AI_DIR, 'read_event_clocks.py');
  try {
    const exit = await new Promise((resolve) => {
      let child;
      try {
        child = spawn(
          config.PYTHON_BIN,
          [script, '--video', videoPath, '--seconds', wanted.join(','), '--out', outPath],
          {
            cwd: config.AI_DIR,
            env: workerEnv(),
            stdio: ['ignore', 'ignore', 'pipe'],
            timeout: 120000,
            killSignal: 'SIGKILL'
          }
        );
      } catch (err) {
        resolve({ spawnError: err });
        return;
      }
      child.on('error', (err) => resolve({ spawnError: err }));
      child.on('close', (code) => resolve({ code }));
    });
    if (exit.spawnError || exit.code !== 0) {
      return [];
    }
    const parsed = JSON.parse(await fsp.readFile(outPath, 'utf8'));
    return sanitizeClockEvents(parsed && parsed.events);
  } catch {
    return [];
  } finally {
    await fsp.unlink(outPath).catch(() => {});
  }
}

async function attachEventClocks(update, videoPath) {
  const events = await readEventClocks(videoPath, eventSeconds(update));
  if (events.length === 0) {
    return update;
  }
  const current = update.videoClock || {};
  const date = (events.find((event) => event.date) || {}).date || current.anchorDate || null;
  update.videoClock = {
    reliable: Boolean(current.anchorClock) || events.length > 0,
    anchorVideoSeconds: current.anchorClock ? current.anchorVideoSeconds : null,
    anchorClock: current.anchorClock || null,
    anchorDate: date,
    events
  };
  return update;
}

async function executeJob({ analysisId, investigationId, videoPath, itemClasses, target }) {
  let update;
  try {
    const result = await service.runWorker({ videoPath, itemClasses });
    if (result.ok) {
      update = buildCompletedUpdate(result, target);
      await attachEventClocks(update, videoPath);
    } else {
      update = {
        processingStatus: 'FAILED',
        processingCompletedAt: new Date(),
        processingError: failureMessage(result.errorCode)
      };
    }
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
    videoClock: {
      reliable: false,
      anchorVideoSeconds: null,
      anchorClock: null,
      anchorDate: null,
      events: []
    },
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

function parseClockSeconds(value) {
  const text = String(value || '');
  const withSeconds = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/.exec(text);
  if (withSeconds) {
    return Number(withSeconds[1]) * 3600 + Number(withSeconds[2]) * 60 + Number(withSeconds[3]);
  }
  const minutes = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
  if (minutes) {
    return Number(minutes[1]) * 3600 + Number(minutes[2]) * 60;
  }
  return null;
}

function formatHms(totalSeconds) {
  const total = ((Math.floor(totalSeconds) % 86400) + 86400) % 86400;
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/**
 * Clock time for one offset. A string base is the start time entered for the
 * file. An overlay base is the clock actually printed on the video.
 */
function clockFromEvents(events, offsetSeconds) {
  if (!Array.isArray(events) || !Number.isFinite(offsetSeconds)) {
    return null;
  }
  let best = null;
  let bestDistance = 0.05;
  for (const event of events) {
    const at = Number(event && event.videoSeconds);
    if (!event || !event.clock || !Number.isFinite(at)) {
      continue;
    }
    const distance = Math.abs(at - offsetSeconds);
    if (distance <= bestDistance) {
      best = event;
      bestDistance = distance;
    }
  }
  return best;
}

function formatClock(timeBase, offsetSeconds) {
  if (!timeBase || !Number.isFinite(offsetSeconds) || offsetSeconds < 0) {
    return null;
  }
  if (typeof timeBase === 'object') {
    const event = clockFromEvents(timeBase.events, offsetSeconds);
    if (event) {
      return event.clock;
    }
    const anchor = parseClockSeconds(timeBase.anchorClock);
    const anchorAt = Number(timeBase.anchorVideoSeconds);
    if (anchor === null || !Number.isFinite(anchorAt)) {
      return null;
    }
    return formatHms(anchor + (offsetSeconds - anchorAt));
  }
  const base = parseClockSeconds(timeBase);
  if (base === null || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(String(timeBase))) {
    return null;
  }
  return formatHms(base + offsetSeconds);
}

/** Prefer the clock printed on the video when that reading checked out. */
function clockBase(analysis, recordingStartTime) {
  const overlay = analysis && analysis.videoClock;
  const events = overlay && Array.isArray(overlay.events)
    ? overlay.events.filter((event) => event && event.clock)
    : [];
  if (events.length > 0) {
    return {
      source: 'frames',
      events,
      anchorVideoSeconds: overlay.anchorClock ? Number(overlay.anchorVideoSeconds) || 0 : null,
      anchorClock: overlay.anchorClock || null,
      anchorDate: overlay.anchorDate || (events.find((event) => event.date) || {}).date || null
    };
  }
  if (overlay && overlay.reliable && overlay.anchorClock) {
    return {
      source: 'overlay',
      anchorVideoSeconds: Number(overlay.anchorVideoSeconds) || 0,
      anchorClock: overlay.anchorClock,
      anchorDate: overlay.anchorDate || null,
      events: []
    };
  }
  return recordingStartTime || null;
}

function clockNote(timeBase) {
  if (timeBase && typeof timeBase === 'object' && Array.isArray(timeBase.events) && timeBase.events.length > 0) {
    return timeBase.anchorDate
      ? `Item times follow the clock printed on the video (${timeBase.anchorDate}).`
      : 'Item times follow the clock printed on the video.';
  }
  if (timeBase && typeof timeBase === 'object' && timeBase.source === 'overlay') {
    return timeBase.anchorDate
      ? `Times follow the clock printed on the video (${timeBase.anchorDate}).`
      : 'Times follow the clock printed on the video.';
  }
  if (typeof timeBase === 'string' && timeBase) {
    return 'Times are calculated from the start time entered for this file, not from a clock printed on the video.';
  }
  return null;
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
  const timeBase = clockBase(analysis, recordingStartTime);
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
      missingDurationLabel: NOT_DETERMINED,
      clockNote: null
    };
  }

  const completed = status === 'COMPLETED';
  const lastSeen = completed ? timePoint(analysis.itemLastSeenSeconds, timeBase) : null;
  const firstSeen = completed ? timePoint(analysis.itemFirstSeenSeconds, timeBase) : null;
  const disappearance = completed
    ? timePoint(analysis.disappearanceSeconds, timeBase)
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
        tracks: (analysis.itemTracking || []).map((row) => mapTrack(row, timeBase))
      }
      : null,
    persons: completed
      ? {
        uniqueCount: (analysis.detectionStatistics && analysis.detectionStatistics.uniquePersonTracks) || 0,
        tracks: (analysis.anonymousPersonTracking || []).map((row) => mapTrack(row, timeBase))
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
    clockNote: completed ? clockNote(timeBase) : null,
    lastSeenLabel: lastSeen ? lastSeen.label : NOT_DETERMINED,
    firstSeenLabel: firstSeen ? firstSeen.label : NOT_DETERMINED,
    disappearanceRangeLabel: lastSeen && disappearance && disappearance.seconds > lastSeen.seconds
      ? `${lastSeen.clockTime || lastSeen.offsetLabel} – ${disappearance.label}`
      : null,
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
  clockBase,
  clockNote,
  readEventClocks,
  attachEventClocks,
  timePoint,
  isRunning,
  activeJob,
  isStale
};

module.exports = service;
