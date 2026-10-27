"""TraceX AI — Module 5 recorded CCTV analysis worker.

Reads an EXISTING recorded CCTV file from disk (resolved and validated by the
Node backend), samples frames with OpenCV, detects objects with YOLO and keeps
consistent anonymous tracking IDs with ByteTrack.

The worker never writes to the database, never copies the video, and never
performs face recognition or identity matching. It prints nothing useful on
stdout; the structured result is written to the file given by --out.

Usage:
    python analyze_cctv.py --config <config.json> --out <result.json>
"""

import argparse
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import traceback

os.environ.setdefault("YOLO_VERBOSE", "false")
os.environ.setdefault("YOLO_AUTOINSTALL", "false")


def write_result(out_path, payload):
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle)


def failure(code, message):
    return {"ok": False, "errorCode": code, "errorDetail": message}


def load_config(config_path):
    with open(config_path, "r", encoding="utf-8") as handle:
        return json.load(handle)


# A lost item has to be visible on its own. A backpack someone is wearing, or a
# bag mostly overlapping a person, is not the reported object sitting in the scene.
# A worn backpack often hangs outside the person box, so a small overlap still
# means the object is on someone. Only a detection that is clearly separate
# counts as the lost item.
CARRIED_OVERLAP = 0.05
# YOLOv8n scores a small phone well below the normal cutoff even when the phone
# is sitting in view. Only these classes use the lower value. People and larger
# objects stay at the configured threshold.
SMALL_OBJECT_CONFIDENCE = {
    "cell phone": 0.18,
}
MIN_ITEM_SAMPLES = 3
TEXT_HELPER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bin", "read_video_text")
TIME_PATTERN = re.compile(r"(?<!\d)([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?!\d)")
DATE_PATTERN = re.compile(r"(20\d{2})[-/.](\d{2})[-/.](\d{2})")


def box_overlap_ratio(inner, outer):
    """Share of `inner` that lies inside `outer`."""
    ix1 = max(inner[0], outer[0])
    iy1 = max(inner[1], outer[1])
    ix2 = min(inner[2], outer[2])
    iy2 = min(inner[3], outer[3])
    intersection = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    area = max(1.0, (inner[2] - inner[0]) * (inner[3] - inner[1]))
    return intersection / area


def overlaps_person(item_box, person_boxes):
    if not item_box or not person_boxes:
        return False
    return any(box_overlap_ratio(item_box, person) >= CARRIED_OVERLAP for person in person_boxes)


def cluster_item_sightings(sightings, min_samples, max_gap=3.0):
    """Group repeated sightings of the same class. A small object often gets a
    new tracker id every frame, so the id is not required for it to count."""
    grouped = {}
    for row in sightings:
        grouped.setdefault(row.get("yoloClass"), []).append(row)

    built = []
    for class_name, rows in grouped.items():
        rows.sort(key=lambda item: item["timestamp"])
        clusters = []
        current = []
        for row in rows:
            if current and row["timestamp"] - current[-1]["timestamp"] > max_gap:
                clusters.append(current)
                current = []
            current.append(row)
        if current:
            clusters.append(current)

        for group in clusters:
            if len(group) < min_samples:
                continue
            scores = [row["score"] for row in group if row["score"] is not None]
            built.append({
                "kind": "item",
                "trackerId": len(built) + 1,
                "yoloClass": class_name,
                "firstSeenSeconds": group[0]["timestamp"],
                "lastSeenSeconds": group[-1]["timestamp"],
                "framesTracked": len(group),
                "bestConfidence": max(scores) if scores else None,
            })

    built.sort(key=lambda row: (row["firstSeenSeconds"], row["yoloClass"] or ""))
    return built


def read_printed_text(image_path):
    """Read text burned into one frame. Returns [] when the helper is unavailable."""
    if not os.path.isfile(TEXT_HELPER) or not os.access(TEXT_HELPER, os.X_OK):
        return []
    try:
        completed = subprocess.run(
            [TEXT_HELPER, image_path],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    try:
        parsed = json.loads(completed.stdout or "[]")
    except (ValueError, TypeError):
        return []
    if not isinstance(parsed, list):
        return []
    return [str(line) for line in parsed]


def read_overlay_clock(video_path, fps, frame_count):
    """Clock printed on the picture, used only when it moves with the video."""
    import cv2  # local: this module imports OpenCV only when a job actually runs

    empty = {
        "reliable": False,
        "anchorVideoSeconds": None,
        "anchorClock": None,
        "anchorDate": None,
    }
    if not os.path.isfile(TEXT_HELPER) or not fps or frame_count < 2:
        return empty

    positions = []
    for fraction in (0.08, 0.45, 0.75):
        index = max(0, min(frame_count - 1, int(frame_count * fraction)))
        if index not in positions:
            positions.append(index)

    capture = cv2.VideoCapture(video_path)
    if not capture.isOpened():
        return empty

    samples = []
    try:
        for index in positions:
            capture.set(cv2.CAP_PROP_POS_FRAMES, index)
            retrieved, frame = capture.read()
            if not retrieved or frame is None:
                continue
            actual_ms = float(capture.get(cv2.CAP_PROP_POS_MSEC) or 0.0)
            video_seconds = round(actual_ms / 1000.0, 3) if actual_ms > 0 else round(index / fps, 3)
            temp_path = None
            try:
                handle, temp_path = tempfile.mkstemp(suffix=".jpg")
                os.close(handle)
                if not cv2.imwrite(temp_path, frame):
                    continue
                text = " ".join(read_printed_text(temp_path))
            finally:
                if temp_path:
                    try:
                        os.remove(temp_path)
                    except OSError:
                        pass
            match = TIME_PATTERN.search(text)
            if not match:
                continue
            date_match = DATE_PATTERN.search(text)
            samples.append({
                "video": video_seconds,
                "clock": int(match.group(1)) * 3600 + int(match.group(2)) * 60 + int(match.group(3)),
                "clockText": "%s:%s:%s" % match.groups(),
                "date": "%s-%s-%s" % date_match.groups() if date_match else None,
            })
    finally:
        capture.release()

    if len(samples) < 2:
        return empty

    samples.sort(key=lambda row: row["video"])
    anchor = None
    for earlier, later in zip(samples, samples[1:]):
        video_delta = later["video"] - earlier["video"]
        clock_delta = (later["clock"] - earlier["clock"]) % 86400
        if video_delta > 0 and abs(clock_delta - video_delta) <= 2.0:
            anchor = dict(earlier)
            anchor["date"] = earlier["date"] or later["date"]
            break
    if anchor is None:
        return empty

    return {
        "reliable": True,
        "anchorVideoSeconds": anchor["video"],
        "anchorClock": anchor["clockText"],
        "anchorDate": anchor["date"],
    }


def resolve_class_ids(model_names, wanted_names):
    """Map class names to model class ids, ignoring names the model lacks."""
    lookup = {}
    if isinstance(model_names, dict):
        pairs = model_names.items()
    else:
        pairs = enumerate(model_names or [])
    for class_id, class_name in pairs:
        lookup[str(class_name).strip().lower()] = int(class_id)

    resolved = {}
    missing = []
    for name in wanted_names:
        key = str(name).strip().lower()
        if key in lookup:
            resolved[lookup[key]] = key
        else:
            missing.append(key)
    return resolved, missing


def analyze(config):
    try:
        import cv2  # noqa: WPS433 (runtime import so a missing dep is reportable)
    except Exception as err:  # pragma: no cover - environment dependent
        return failure("DEPENDENCY_MISSING", "opencv import failed: %s" % err)

    try:
        from ultralytics import YOLO  # noqa: WPS433
    except Exception as err:  # pragma: no cover - environment dependent
        return failure("DEPENDENCY_MISSING", "ultralytics import failed: %s" % err)

    video_path = config["videoPath"]
    model_path = config["modelPath"]

    if not os.path.isfile(video_path):
        return failure("VIDEO_MISSING", "video file not found")
    if not os.path.isfile(model_path):
        return failure("MODEL_MISSING", "model weights not found")

    try:
        model = YOLO(model_path)
    except Exception as err:
        return failure("MODEL_LOAD_FAILED", str(err))

    person_class = str(config.get("personClass", "person"))
    item_classes = list(config.get("itemClasses") or [])
    class_map, missing_classes = resolve_class_ids(
        getattr(model, "names", None), [person_class] + item_classes
    )
    if not class_map:
        return failure("MODEL_CLASSES_UNAVAILABLE", "model does not expose requested classes")

    person_ids = {cid for cid, name in class_map.items() if name == person_class.lower()}
    item_ids = {cid for cid, name in class_map.items() if name != person_class.lower()}

    capture = cv2.VideoCapture(video_path)
    if not capture.isOpened():
        capture.release()
        return failure("VIDEO_OPEN_FAILED", "opencv could not open the video")

    try:
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
        reported_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

        if not math.isfinite(fps) or fps <= 0.0 or fps > 480.0:
            return failure("VIDEO_METADATA_INVALID", "unusable fps metadata")

        base_interval = max(1, int(config.get("frameInterval", 5)))
        max_samples = max(1, int(config.get("maxSampledFrames", 2400)))
        interval = base_interval
        if reported_frames > 0:
            # Always cover the whole recording; sample more coarsely if needed.
            needed = int(math.ceil(reported_frames / float(max_samples)))
            interval = max(base_interval, needed)

        confidence = float(config.get("confidence", 0.35))
        item_floors = [
            SMALL_OBJECT_CONFIDENCE[class_map[cid]]
            for cid in item_ids
            if class_map.get(cid) in SMALL_OBJECT_CONFIDENCE
        ]
        # Ask the model for the lower score only when this case needs a small object.
        detect_confidence = min([confidence] + item_floors) if item_floors else confidence
        tracker = str(config.get("tracker", "bytetrack.yaml"))

        tracks = {}
        sample_timestamps = []
        person_detections = 0
        item_detections = 0
        carried_item_detections = 0
        item_sightings = []
        frames_read = 0
        samples_taken = 0
        truncated = False

        while True:
            grabbed = capture.grab()
            if not grabbed:
                break
            current_index = frames_read
            frames_read += 1

            if current_index % interval != 0:
                continue

            if samples_taken >= max_samples:
                truncated = True
                break

            retrieved, frame = capture.retrieve()
            if not retrieved or frame is None:
                continue

            timestamp = round(current_index / fps, 3)
            samples_taken += 1
            sample_timestamps.append(timestamp)

            try:
                results = model.track(
                    frame,
                    persist=True,
                    conf=detect_confidence,
                    classes=sorted(class_map.keys()),
                    tracker=tracker,
                    verbose=False,
                )
            except Exception as err:
                return failure("TRACKING_FAILED", str(err))

            if not results:
                continue

            boxes = getattr(results[0], "boxes", None)
            if boxes is None or len(boxes) == 0:
                continue

            raw_ids = boxes.id
            id_list = raw_ids.int().tolist() if raw_ids is not None else [None] * len(boxes)
            class_list = boxes.cls.int().tolist() if boxes.cls is not None else []
            conf_list = boxes.conf.tolist() if boxes.conf is not None else []
            xyxy = boxes.xyxy.tolist() if boxes.xyxy is not None else []

            person_boxes = []
            observations = []
            for position, class_id in enumerate(class_list):
                class_id = int(class_id)
                is_person = class_id in person_ids
                is_item = class_id in item_ids
                if not is_person and not is_item:
                    continue
                score = float(conf_list[position]) if position < len(conf_list) else None
                class_name = class_map.get(class_id)
                minimum = confidence if is_person else SMALL_OBJECT_CONFIDENCE.get(class_name, confidence)
                if score is None or score < minimum:
                    continue
                box = xyxy[position] if position < len(xyxy) else None
                if is_person and box is not None:
                    person_boxes.append(box)
                observations.append((position, class_id, is_person, is_item, box))

            for position, class_id, is_person, is_item, box in observations:
                if is_person:
                    person_detections += 1
                elif overlaps_person(box, person_boxes):
                    # On a person: not the lost item, and not a timestamp.
                    carried_item_detections += 1
                    continue
                else:
                    item_detections += 1
                    sighting_score = float(conf_list[position]) if position < len(conf_list) else None
                    item_sightings.append({
                        "yoloClass": class_map.get(class_id),
                        "timestamp": timestamp,
                        "score": sighting_score,
                    })
                    # Item presence is counted from these sightings. A tracker id
                    # is not required, because a small object rarely keeps one.
                    continue

                track_id = id_list[position] if position < len(id_list) else None
                if track_id is None:
                    # Detected but not yet assigned a stable track by ByteTrack.
                    continue

                score = float(conf_list[position]) if position < len(conf_list) else None
                key = ("person" if is_person else "item", int(track_id))
                existing = tracks.get(key)
                if existing is None:
                    tracks[key] = {
                        "kind": key[0],
                        "trackerId": int(track_id),
                        "yoloClass": class_map.get(class_id),
                        "firstSeenSeconds": timestamp,
                        "lastSeenSeconds": timestamp,
                        "framesTracked": 1,
                        "bestConfidence": score,
                    }
                else:
                    existing["lastSeenSeconds"] = timestamp
                    existing["framesTracked"] += 1
                    if score is not None and (
                        existing["bestConfidence"] is None or score > existing["bestConfidence"]
                    ):
                        existing["bestConfidence"] = score

        frame_count = reported_frames if reported_frames > 0 else frames_read
        duration = round(frame_count / fps, 3) if frame_count > 0 else None

        person_tracks = [row for row in tracks.values() if row["kind"] == "person"]
        # A handful of frames is not enough to call an object the lost item.
        item_tracks = cluster_item_sightings(item_sightings, MIN_ITEM_SAMPLES)
        person_tracks.sort(key=lambda row: (row["firstSeenSeconds"], row["trackerId"]))
        item_tracks.sort(key=lambda row: (row["firstSeenSeconds"], row["trackerId"]))
        video_clock = read_overlay_clock(video_path, fps, frame_count)

        return {
            "ok": True,
            "video": {
                "fps": round(fps, 3),
                "frameCount": frame_count,
                "durationSeconds": duration,
                "framesSampled": samples_taken,
                "frameInterval": interval,
                "truncated": truncated,
            },
            "model": {
                "name": os.path.basename(model_path),
                "confidence": detect_confidence,
                "tracker": tracker,
                "missingClasses": missing_classes,
                "itemClassesUsed": sorted(class_map[cid] for cid in item_ids),
            },
            "personTracks": person_tracks,
            "itemTracks": item_tracks,
            "sampleTimestamps": sample_timestamps,
            "carriedItemDetections": carried_item_detections,
            "videoClock": video_clock,
            "detectionCounts": {
                "personDetections": person_detections,
                "itemDetections": item_detections,
            },
        }
    finally:
        capture.release()


def main():
    parser = argparse.ArgumentParser(description="TraceX AI recorded CCTV analysis worker")
    parser.add_argument("--config", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    try:
        config = load_config(args.config)
    except Exception as err:
        write_result(args.out, failure("CONFIG_INVALID", str(err)))
        return 1

    try:
        result = analyze(config)
    except MemoryError:
        write_result(args.out, failure("INSUFFICIENT_RESOURCES", "out of memory"))
        return 1
    except Exception:
        write_result(args.out, failure("UNEXPECTED_ERROR", traceback.format_exc(limit=1)))
        return 1

    write_result(args.out, result)
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
