const config = require('../config/aiConfig');
const analysisService = require('./cctvAnalysisService');
const evidenceService = require('./evidenceFrameService');

const { formatDuration, timePoint, NOT_DETERMINED, NOT_RELIABLE } = analysisService;

// Long recordings can produce many anonymous tracks. The timeline stays
// readable by listing the earliest detections and saying how many were held back.
const TIMELINE_PERSON_LIMIT = 50;

const PROCESSING_MESSAGES = {
  AVAILABLE: 'AI analysis has not been started for this recording.',
  PROCESSING: 'AI analysis is still processing.',
  FAILED: 'AI analysis failed.',
  COMPLETED: null
};

const PROCESSING_LABELS = {
  AVAILABLE: 'Not analysed',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  FAILED: 'Failed'
};

const EVIDENCE_LABELS = {
  AVAILABLE: 'Not extracted',
  EXTRACTING: 'Extracting',
  COMPLETED: 'Available',
  FAILED: 'Unavailable'
};

const CERTAINTY_LABELS = {
  high: 'High — the item stayed absent for an extended part of the recording',
  moderate: 'Moderate — absence was confirmed over a shorter window'
};

function finite(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function round(value, decimals = 2) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Item last-seen, estimated disappearance, and missing duration, taken from the
 * stored Module 5 result. Nothing is recalculated and nothing is guessed.
 */
function buildItemAnalysis(analysis, recordingStartTime) {
  const detected = (analysis.itemTracking || []).length > 0;
  const firstSeen = timePoint(finite(analysis.itemFirstSeenSeconds), recordingStartTime);
  const lastSeen = timePoint(finite(analysis.itemLastSeenSeconds), recordingStartTime);
  const disappearance = timePoint(finite(analysis.disappearanceSeconds), recordingStartTime);
  const messages = [];

  if (!analysis.itemDetectionSupported) {
    messages.push(analysis.itemDetectionNote || config.UNSUPPORTED_ITEM_NOTE);
  } else if (!detected) {
    messages.push(analysis.itemDetectionNote || 'The reported item was not detected in this recording.');
  }
  if (detected && !lastSeen) {
    messages.push('No last-seen timestamp is available for this recording.');
  }
  if (detected && !disappearance) {
    messages.push('No disappearance timestamp available.');
  }

  // The disappearance happened somewhere between the final detection and the
  // first frame that confirmed the absence, so it is shown as a range.
  const range = lastSeen && disappearance && disappearance.seconds > lastSeen.seconds
    ? {
      startLabel: lastSeen.clockTime || lastSeen.offsetLabel,
      endLabel: disappearance.clockTime || disappearance.offsetLabel,
      label: `${lastSeen.clockTime || lastSeen.offsetLabel} – ${disappearance.clockTime || disappearance.offsetLabel}`
    }
    : null;

  const missingSeconds = finite(analysis.missingDurationSeconds);

  return {
    detectionSupported: Boolean(analysis.itemDetectionSupported),
    detected,
    note: analysis.itemDetectionNote || null,
    targetClasses: analysis.itemTargetClasses || [],
    firstSeen,
    lastSeen,
    disappearance,
    disappearanceRange: range,
    lastSeenLabel: lastSeen ? lastSeen.label : NOT_DETERMINED,
    disappearanceLabel: disappearance ? disappearance.label : NOT_RELIABLE,
    disappearanceCertainty: analysis.disappearanceCertainty || null,
    certaintyLabel: analysis.disappearanceCertainty
      ? CERTAINTY_LABELS[analysis.disappearanceCertainty]
      : null,
    missingDurationSeconds: missingSeconds,
    missingDurationLabel: missingSeconds === null ? NOT_DETERMINED : formatDuration(missingSeconds),
    observedAbsenceLabel: finite(analysis.observedAbsenceSeconds) === null
      ? null
      : formatDuration(analysis.observedAbsenceSeconds),
    itemTracks: (analysis.itemTracking || []).map((row) => ({
      trackingId: row.trackingId,
      detectedClass: row.yoloClass || null,
      firstSeen: timePoint(finite(row.firstSeenSeconds), recordingStartTime),
      lastSeen: timePoint(finite(row.lastSeenSeconds), recordingStartTime),
      framesTracked: row.framesTracked,
      confidence: row.bestConfidence
    })),
    messages
  };
}

/**
 * Anonymous person tracking, including how long after the estimated
 * disappearance each track was first detected. This is temporal analysis only.
 */
function buildPersonAnalysis(analysis, recordingStartTime) {
  const reference = evidenceService.disappearanceReference(analysis);
  const referenceFrom = evidenceService.referenceFrom(analysis);
  // When no disappearance was established the last detection is the reference,
  // and the wording has to say so instead of implying a disappearance.
  const referenceName = referenceFrom === 'DISAPPEARANCE'
    ? 'the estimated disappearance'
    : 'the item was last detected';
  const tracks = (analysis.anonymousPersonTracking || [])
    .slice()
    .sort((a, b) => a.firstSeenSeconds - b.firstSeenSeconds)
    .map((row) => {
      const first = finite(row.firstSeenSeconds);
      const last = finite(row.lastSeenSeconds);
      const duration = first !== null && last !== null && last >= first ? round(last - first) : null;
      const afterSeconds = reference !== null && first !== null ? round(first - reference) : null;
      const afterDisappearance = afterSeconds !== null && afterSeconds >= 0;
      return {
        trackingId: row.trackingId,
        firstSeen: timePoint(first, recordingStartTime),
        lastSeen: timePoint(last, recordingStartTime),
        trackingDurationSeconds: duration,
        trackingDurationLabel: duration === null ? NOT_DETERMINED : formatDuration(duration),
        framesTracked: row.framesTracked,
        confidence: row.bestConfidence,
        afterDisappearance,
        secondsAfterDisappearance: afterDisappearance ? afterSeconds : null,
        // Neutral wording: a time relationship, never a claim of responsibility.
        relationLabel: afterSeconds === null
          ? null
          : afterDisappearance
            ? `First detected ${formatDuration(afterSeconds) || '0 seconds'} after ${referenceName}`
            : `First detected ${formatDuration(Math.abs(afterSeconds)) || '0 seconds'} before ${referenceName}`
      };
    });

  const after = tracks.filter((row) => row.afterDisappearance);
  const messages = [];
  if (tracks.length === 0) {
    messages.push('No anonymous person tracks were found in this recording.');
  } else if (reference === null) {
    messages.push(
      'No disappearance timestamp available, so person detections cannot be placed before or after it.'
    );
  } else if (after.length === 0) {
    messages.push(
      referenceFrom === 'DISAPPEARANCE'
        ? 'No post-disappearance person detections were found.'
        : 'No person detections were found after the item was last detected.'
    );
  }

  return {
    uniqueCount: tracks.length,
    postDisappearanceCount: after.length,
    referenceSeconds: reference,
    referenceFrom,
    reference: timePoint(reference, recordingStartTime),
    tracks,
    messages
  };
}

/** Chronological events, every one of them from a stored Module 5 value. */
function buildTimeline(analysis, persons, itemAnalysis) {
  const events = [];

  if (itemAnalysis.detected && itemAnalysis.firstSeen) {
    events.push({
      id: 'item-first',
      kind: 'ITEM',
      seconds: itemAnalysis.firstSeen.seconds,
      time: itemAnalysis.firstSeen,
      title: 'Item first detected',
      detail: 'The reported item was detected in a sampled frame.',
      trackingId: null
    });
  }

  if (itemAnalysis.lastSeen) {
    events.push({
      id: 'item-last',
      kind: 'ITEM',
      seconds: itemAnalysis.lastSeen.seconds,
      time: itemAnalysis.lastSeen,
      title: 'Item last seen',
      detail: 'Final sampled frame in which the reported item was detected.',
      trackingId: null
    });
  }

  if (itemAnalysis.disappearance) {
    events.push({
      id: 'item-disappearance',
      kind: 'ITEM',
      seconds: itemAnalysis.disappearance.seconds,
      time: itemAnalysis.disappearance,
      title: 'Estimated disappearance',
      detail: 'The item was no longer detected in the sampled frames.',
      trackingId: null
    });
  }

  const personTracks = persons.tracks.filter((row) => row.firstSeen);
  personTracks.slice(0, TIMELINE_PERSON_LIMIT).forEach((row, index) => {
    events.push({
      id: `person-${index}`,
      kind: 'PERSON',
      seconds: row.firstSeen.seconds,
      time: row.firstSeen,
      title: 'Person detected',
      detail: row.relationLabel
        ? `Anonymous track ${row.trackingId}. ${row.relationLabel}.`
        : `Anonymous track ${row.trackingId}.`,
      trackingId: row.trackingId
    });
  });

  events.sort((a, b) => a.seconds - b.seconds);

  if (analysis.processingCompletedAt) {
    events.push({
      id: 'analysis-completed',
      kind: 'ANALYSIS',
      seconds: null,
      time: null,
      completedAt: analysis.processingCompletedAt,
      title: 'AI analysis completed',
      detail: 'Detection and anonymous tracking finished for this recording.',
      trackingId: null
    });
  }

  events.push({
    id: 'analysis-recommendation',
    kind: 'ANALYSIS',
    seconds: null,
    time: null,
    title: 'Review recommendation',
    detail: 'Admin review recommended for the relevant interval.',
    trackingId: null
  });

  return {
    events,
    truncated: personTracks.length > TIMELINE_PERSON_LIMIT,
    hiddenPersonEvents: Math.max(0, personTracks.length - TIMELINE_PERSON_LIMIT)
  };
}

/**
 * Suggest which part of the recording to review first. The window is built from
 * the real event times and is clamped to the recording itself.
 */
function buildReviewWindow(analysis, itemAnalysis, persons, recordingStartTime) {
  const lastSeen = itemAnalysis.lastSeen ? itemAnalysis.lastSeen.seconds : null;
  const disappearance = itemAnalysis.disappearance ? itemAnalysis.disappearance.seconds : null;
  const duration = finite(analysis.videoDurationSeconds);
  const firstAfter = persons.tracks.find((row) => row.afterDisappearance);
  const firstAfterSeconds = firstAfter && firstAfter.firstSeen ? firstAfter.firstSeen.seconds : null;

  if (lastSeen === null && disappearance === null) {
    return {
      available: false,
      message: 'Insufficient timestamp data to generate a review window.'
    };
  }

  const anchors = [lastSeen, disappearance].filter((value) => value !== null);
  const anchorStart = Math.min(...anchors);
  const anchorEnd = Math.max(...anchors, firstAfterSeconds === null ? anchorStart : firstAfterSeconds);

  const start = Math.max(0, anchorStart - config.REVIEW_WINDOW_LEAD_SECONDS);
  let end = anchorEnd + config.REVIEW_WINDOW_TRAIL_SECONDS;
  if (duration !== null) {
    end = Math.min(end, duration);
  }
  if (end <= start) {
    end = duration === null ? start + config.REVIEW_WINDOW_TRAIL_SECONDS : duration;
  }

  const reasons = [];
  if (lastSeen !== null) {
    reasons.push(`the item was last detected at ${itemAnalysis.lastSeen.label}`);
  }
  if (disappearance !== null) {
    reasons.push(`disappearance was estimated around ${itemAnalysis.disappearance.label}`);
  }
  if (firstAfterSeconds !== null) {
    reasons.push(
      `the first post-disappearance track (${firstAfter.trackingId}) was detected at ${firstAfter.firstSeen.label}`
    );
  }

  const startPoint = timePoint(round(start), recordingStartTime);
  const endPoint = timePoint(round(end), recordingStartTime);

  return {
    available: true,
    start: startPoint,
    end: endPoint,
    windowLabel: `${startPoint.clockTime || startPoint.offsetLabel} – ${endPoint.clockTime || endPoint.offsetLabel}`,
    durationLabel: formatDuration(round(end - start)),
    reason: `Review this interval because ${reasons.join(', and ')}.`,
    note: disappearance === null
      ? 'The window adds context around the last detection of the item. It does not indicate who caused the item to go missing.'
      : 'The window adds context before and after the estimated disappearance. It does not indicate who caused it.',
    requiresAdminReview: true
  };
}

/** A neutral summary of what the analysis found. Never a conclusion. */
function buildRecommendation(itemAnalysis, persons, reviewWindow) {
  const sentences = [];

  if (itemAnalysis.lastSeen) {
    sentences.push(`The item was last detected at approximately ${itemAnalysis.lastSeen.label}.`);
  } else if (itemAnalysis.detected) {
    sentences.push('The item was detected, but no reliable last-seen timestamp was produced.');
  } else {
    sentences.push('The reported item was not detected in this recording.');
  }

  if (itemAnalysis.disappearance) {
    sentences.push(
      itemAnalysis.disappearanceRange
        ? `Its disappearance was estimated between ${itemAnalysis.disappearanceRange.label}.`
        : `Its disappearance was estimated around ${itemAnalysis.disappearance.label}.`
    );
  } else {
    sentences.push('A disappearance point could not be reliably determined from this recording.');
  }

  const after = persons.tracks.filter((row) => row.afterDisappearance && row.firstSeen);
  if (after.length === 1) {
    sentences.push(
      `One anonymous track (${after[0].trackingId}) was first detected at ${after[0].firstSeen.label}.`
    );
  } else if (after.length > 1) {
    const firstLabel = after[0].firstSeen.clockTime || after[0].firstSeen.offsetLabel;
    const lastLabel =
      after[after.length - 1].firstSeen.clockTime || after[after.length - 1].firstSeen.offsetLabel;
    sentences.push(
      `${after.length} anonymous tracks were first detected between ${firstLabel} and ${lastLabel}.`
    );
  } else if (persons.uniqueCount > 0 && persons.referenceSeconds === null) {
    sentences.push(
      `${persons.uniqueCount} anonymous track${persons.uniqueCount === 1 ? ' was' : 's were'} detected, but without a disappearance point they cannot be placed before or after it.`
    );
  } else if (persons.uniqueCount > 0) {
    sentences.push(
      persons.referenceFrom === 'DISAPPEARANCE'
        ? 'No post-disappearance person detections were found.'
        : 'No person detections were found after the item was last detected.'
    );
  } else {
    sentences.push('No anonymous person tracks were found in this recording.');
  }

  if (reviewWindow.available) {
    sentences.push(`Review of ${reviewWindow.windowLabel} is recommended.`);
  } else {
    sentences.push('There is not enough timestamp data to suggest a review interval.');
  }

  return {
    title: 'AI-Assisted Review Recommendation',
    summary: sentences.join(' '),
    disclaimer:
      'This is an AI-assisted observation based on detection timings. It is not a conclusion about any person.',
    requiresAdminReview: true
  };
}

function buildEvidence(analysis, frames, investigationId, recordingStartTime) {
  const status = analysis.evidenceStatus || 'AVAILABLE';
  const mapped = frames.map((frame) =>
    evidenceService.mapEvidenceFrame(frame, investigationId, recordingStartTime)
  );
  const byType = {
    LAST_SEEN: mapped.find((row) => row.evidenceType === 'LAST_SEEN') || null,
    DISAPPEARANCE: mapped.find((row) => row.evidenceType === 'DISAPPEARANCE') || null,
    POST_DISAPPEARANCE: mapped.find((row) => row.evidenceType === 'POST_DISAPPEARANCE') || null,
    PERSON_FIRST_APPEARANCE: mapped.filter((row) => row.evidenceType === 'PERSON_FIRST_APPEARANCE')
  };

  let message = null;
  if (status === 'EXTRACTING') {
    message = 'Evidence frames are being extracted.';
  } else if (status === 'FAILED') {
    message = analysis.evidenceError || 'Evidence frame unavailable.';
  } else if (mapped.length === 0) {
    message = 'No evidence frame could be derived from this analysis.';
  }

  return {
    status,
    statusLabel: EVIDENCE_LABELS[status] || status,
    error: status === 'FAILED' ? analysis.evidenceError || 'Evidence frame unavailable.' : null,
    extractedAt: analysis.evidenceExtractedAt || null,
    canExtract: status === 'FAILED' || status === 'AVAILABLE',
    frames: mapped,
    byType,
    message
  };
}

function buildBeforeAfter(evidence, itemAnalysis) {
  const before = evidence.byType.LAST_SEEN;
  const after = evidence.byType.POST_DISAPPEARANCE;
  if (!before && !after) {
    return null;
  }
  // Without an established disappearance the later frame is only "after the
  // last detection", and it is labelled that way.
  const afterLastSeenOnly = after && after.basis === 'AFTER_LAST_SEEN_OFFSET';
  return {
    before: before || null,
    after: after || null,
    beforeLabel: 'Last seen',
    afterLabel: afterLastSeenOnly ? 'After last detection' : 'After estimated disappearance',
    missingMessage: !before
      ? 'Last-seen frame unavailable.'
      : !after
        ? 'Post-disappearance frame unavailable.'
        : null,
    note: !itemAnalysis.detected
      ? 'The reported item was not detected, so the frames only show the scene at these times.'
      : afterLastSeenOnly
        ? 'Compare the scene around the last detection. This recording did not confirm a disappearance point.'
        : 'Compare the scene before and after the estimated disappearance. The comparison does not show what caused it.'
  };
}

/**
 * Assemble everything Module 6 shows for one recording. The heavy work (YOLO,
 * ByteTrack, OpenCV sampling) already happened in Module 5; this only reads the
 * stored result.
 */
function buildRecordingReview({ investigation, footage, analysis, frames }) {
  const recordingStartTime = footage.recordingStartTime || null;
  const investigationId = investigation._id.toString();

  const base = {
    footage: {
      id: footage._id.toString(),
      filename: footage.displayName,
      cameraLocation: footage.cameraLocation,
      recordedDate: footage.recordedDate,
      recordingStartTime: footage.recordingStartTime || null,
      recordingEndTime: footage.recordingEndTime || null,
      previewUrl: `/api/admin/investigations/${investigationId}/cctv/${footage._id}/file`
    },
    processingStatus: analysis ? analysis.processingStatus : 'AVAILABLE',
    statusLabel: PROCESSING_LABELS[analysis ? analysis.processingStatus : 'AVAILABLE'],
    statusMessage: PROCESSING_MESSAGES[analysis ? analysis.processingStatus : 'AVAILABLE'],
    error: analysis && analysis.processingStatus === 'FAILED'
      ? analysis.processingError || 'AI analysis failed.'
      : null,
    startedAt: analysis ? analysis.processingStartedAt : null,
    completedAt: analysis ? analysis.processingCompletedAt : null,
    canRetry: Boolean(
      analysis
      && (analysis.processingStatus === 'FAILED'
        || (analysis.processingStatus === 'PROCESSING' && analysisService.isStale(analysis)))
    ),
    analysisReady: false,
    video: null,
    model: null,
    itemAnalysis: null,
    evidence: null,
    beforeAfter: null,
    persons: null,
    timeline: null,
    reviewWindow: null,
    recommendation: null
  };

  if (!analysis || analysis.processingStatus !== 'COMPLETED') {
    return base;
  }

  const timeBase = analysisService.clockBase(analysis, recordingStartTime);
  const itemAnalysis = buildItemAnalysis(analysis, timeBase);
  const persons = buildPersonAnalysis(analysis, timeBase);
  const timeline = buildTimeline(analysis, persons, itemAnalysis);
  const reviewWindow = buildReviewWindow(analysis, itemAnalysis, persons, timeBase);
  const recommendation = buildRecommendation(itemAnalysis, persons, reviewWindow);
  const evidence = buildEvidence(analysis, frames || [], investigationId, timeBase);

  return {
    ...base,
    analysisReady: true,
    video: {
      durationSeconds: finite(analysis.videoDurationSeconds),
      durationLabel: formatDuration(analysis.videoDurationSeconds) || NOT_DETERMINED,
      fps: analysis.videoFps,
      frameCount: analysis.frameCount,
      framesSampled: analysis.framesSampled,
      frameInterval: analysis.frameInterval
    },
    model: {
      name: analysis.modelName,
      confidenceThreshold: analysis.confidenceThreshold
    },
    statistics: analysis.detectionStatistics
      ? {
        framesSampled: analysis.detectionStatistics.framesSampled,
        personDetections: analysis.detectionStatistics.personDetections,
        itemDetections: analysis.detectionStatistics.itemDetections,
        uniquePersonTracks: analysis.detectionStatistics.uniquePersonTracks,
        uniqueItemTracks: analysis.detectionStatistics.uniqueItemTracks
      }
      : null,
    clockNote: analysisService.clockNote(timeBase),
    itemAnalysis,
    evidence,
    beforeAfter: buildBeforeAfter(evidence, itemAnalysis),
    persons,
    timeline,
    reviewWindow,
    recommendation
  };
}

module.exports = {
  TIMELINE_PERSON_LIMIT,
  PROCESSING_LABELS,
  EVIDENCE_LABELS,
  CERTAINTY_LABELS,
  buildItemAnalysis,
  buildPersonAnalysis,
  buildTimeline,
  buildReviewWindow,
  buildRecommendation,
  buildEvidence,
  buildBeforeAfter,
  buildRecordingReview
};
