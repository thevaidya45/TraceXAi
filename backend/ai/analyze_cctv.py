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
import sys
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
        tracker = str(config.get("tracker", "bytetrack.yaml"))

        tracks = {}
        sample_timestamps = []
        person_detections = 0
        item_detections = 0
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
                    conf=confidence,
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

            for position, class_id in enumerate(class_list):
                class_id = int(class_id)
                is_person = class_id in person_ids
                is_item = class_id in item_ids
                if not is_person and not is_item:
                    continue

                if is_person:
                    person_detections += 1
                else:
                    item_detections += 1

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
        item_tracks = [row for row in tracks.values() if row["kind"] == "item"]
        person_tracks.sort(key=lambda row: (row["firstSeenSeconds"], row["trackerId"]))
        item_tracks.sort(key=lambda row: (row["firstSeenSeconds"], row["trackerId"]))

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
                "confidence": confidence,
                "tracker": tracker,
                "missingClasses": missing_classes,
                "itemClassesUsed": sorted(class_map[cid] for cid in item_ids),
            },
            "personTracks": person_tracks,
            "itemTracks": item_tracks,
            "sampleTimestamps": sample_timestamps,
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
