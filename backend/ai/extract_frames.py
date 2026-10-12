"""TraceX AI — Module 6 evidence frame extraction worker.

Opens the EXISTING recorded CCTV file (resolved and validated by the Node
backend), seeks to timestamps that Module 5 already produced, and writes one
still JPEG per requested event into a temporary directory chosen by the
backend.

The worker never copies the video, never writes to the database, and performs
no detection, no tracking, and no face processing. It only reads frames that
are already in the recording. Nothing is drawn on the frames, so an evidence
image is always exactly what the camera recorded.

Usage:
    python extract_frames.py --config <config.json> --out <result.json>
"""

import argparse
import json
import math
import os
import sys
import traceback


def write_result(out_path, payload):
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle)


def failure(code, message):
    return {"ok": False, "errorCode": code, "errorDetail": message}


def load_config(config_path):
    with open(config_path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def read_frame_at(capture, cv2, timestamp, fps, frame_count):
    """Seek to a timestamp and return (frame, frame_number) or (None, None)."""
    target_index = int(round(timestamp * fps))
    if frame_count > 0:
        target_index = min(target_index, frame_count - 1)
    target_index = max(target_index, 0)

    for attempt in ("index", "msec"):
        if attempt == "index":
            capture.set(cv2.CAP_PROP_POS_FRAMES, float(target_index))
        else:
            capture.set(cv2.CAP_PROP_POS_MSEC, float(timestamp * 1000.0))

        position = capture.get(cv2.CAP_PROP_POS_FRAMES)
        retrieved, frame = capture.read()
        if retrieved and frame is not None:
            frame_number = int(position) if position and position >= 0 else target_index
            return frame, frame_number

    return None, None


def extract(config):
    try:
        import cv2  # noqa: WPS433 (runtime import so a missing dep is reportable)
    except Exception as err:  # pragma: no cover - environment dependent
        return failure("DEPENDENCY_MISSING", "opencv import failed: %s" % err)

    video_path = config["videoPath"]
    output_dir = config["outputDir"]
    targets = list(config.get("targets") or [])

    if not os.path.isfile(video_path):
        return failure("VIDEO_MISSING", "video file not found")
    if not os.path.isdir(output_dir):
        return failure("CONFIG_INVALID", "output directory not found")
    if not targets:
        return failure("CONFIG_INVALID", "no frame targets requested")

    max_width = int(config.get("maxWidth", 1280))
    quality = int(config.get("jpegQuality", 85))

    capture = cv2.VideoCapture(video_path)
    if not capture.isOpened():
        capture.release()
        return failure("VIDEO_OPEN_FAILED", "opencv could not open the video")

    try:
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if not math.isfinite(fps) or fps <= 0.0 or fps > 480.0:
            return failure("VIDEO_METADATA_INVALID", "unusable fps metadata")

        duration = round(frame_count / fps, 3) if frame_count > 0 else None
        frames = []

        for target in sorted(targets, key=lambda row: float(row.get("timestampSeconds", 0.0))):
            key = str(target.get("key"))
            timestamp = float(target.get("timestampSeconds", 0.0))
            if timestamp < 0.0 or (duration is not None and timestamp > duration + 1.0):
                frames.append({"key": key, "available": False})
                continue

            frame, frame_number = read_frame_at(capture, cv2, timestamp, fps, frame_count)
            if frame is None:
                frames.append({"key": key, "available": False})
                continue

            height, width = frame.shape[:2]
            if width > max_width:
                scale = max_width / float(width)
                frame = cv2.resize(
                    frame,
                    (max_width, max(1, int(round(height * scale)))),
                    interpolation=cv2.INTER_AREA,
                )
                height, width = frame.shape[:2]

            file_path = os.path.join(output_dir, "%s.jpg" % key)
            written = cv2.imwrite(file_path, frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
            if not written or not os.path.isfile(file_path):
                frames.append({"key": key, "available": False})
                continue

            frames.append(
                {
                    "key": key,
                    "available": True,
                    "file": file_path,
                    "frameNumber": frame_number,
                    "width": int(width),
                    "height": int(height),
                }
            )

        return {
            "ok": True,
            "video": {
                "fps": round(fps, 3),
                "frameCount": frame_count,
                "durationSeconds": duration,
            },
            "frames": frames,
        }
    finally:
        capture.release()


def main():
    parser = argparse.ArgumentParser(description="TraceX AI evidence frame extraction worker")
    parser.add_argument("--config", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    try:
        config = load_config(args.config)
    except Exception as err:
        write_result(args.out, failure("CONFIG_INVALID", str(err)))
        return 1

    try:
        result = extract(config)
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
