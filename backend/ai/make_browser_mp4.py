"""Rewrite a recording as H.264 so a browser can play it.

This does not detect objects, track people, or read faces. It only copies
frames into a new MP4. Chrome cannot decode the older MPEG-4 Part 2 codec
used by some CCTV exports.
"""
import json
import sys

import cv2


def main():
    if len(sys.argv) != 3:
        print(json.dumps({"ok": False, "error": "usage"}))
        return 2

    source = sys.argv[1]
    destination = sys.argv[2]
    capture = cv2.VideoCapture(source)
    if not capture.isOpened():
        print(json.dumps({"ok": False, "error": "unreadable"}))
        return 1

    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)) or 0
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 0
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    if fps < 1 or fps > 240:
        fps = 25.0
    if width < 2 or height < 2:
        capture.release()
        print(json.dumps({"ok": False, "error": "no_frames"}))
        return 1

    writer = cv2.VideoWriter(
        destination,
        cv2.VideoWriter_fourcc(*"avc1"),
        fps,
        (width, height)
    )
    if not writer.isOpened():
        capture.release()
        print(json.dumps({"ok": False, "error": "writer"}))
        return 1

    frames = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if frame.shape[1] != width or frame.shape[0] != height:
            frame = cv2.resize(frame, (width, height))
        writer.write(frame)
        frames += 1

    writer.release()
    capture.release()
    if frames < 1:
        print(json.dumps({"ok": False, "error": "no_frames"}))
        return 1

    print(json.dumps({
        "ok": True,
        "frames": frames,
        "width": width,
        "height": height,
        "fps": fps
    }))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print(json.dumps({"ok": False, "error": "failed"}))
        sys.exit(1)
