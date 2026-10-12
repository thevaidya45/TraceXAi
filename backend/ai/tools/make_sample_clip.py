"""Developer helper: build a synthetic clip for verifying the analysis worker.

This is NOT campus footage and is never used by the application. It repeats the
sample image bundled with ultralytics for the first half of the clip and blank
frames for the second half, so the worker can be checked end to end (detection,
tracking, and the absence window) without real CCTV.

Usage:
    python tools/make_sample_clip.py <output.mp4> [seconds] [fps] [asset]
"""

import sys

import cv2
import numpy as np


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else "sample_clip.mp4"
    seconds = int(sys.argv[2]) if len(sys.argv) > 2 else 12
    fps = int(sys.argv[3]) if len(sys.argv) > 3 else 10
    asset = sys.argv[4] if len(sys.argv) > 4 else "bus.jpg"

    from ultralytics.utils import ASSETS

    source = cv2.imread(str(ASSETS / asset))
    if source is None:
        raise SystemExit("sample image not found")

    frame = cv2.resize(source, (640, 480))
    blank = np.zeros_like(frame)
    writer = cv2.VideoWriter(out_path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (640, 480))
    if not writer.isOpened():
        raise SystemExit("could not open video writer")

    total = seconds * fps
    try:
        for index in range(total):
            writer.write(frame if index < total // 2 else blank)
    finally:
        writer.release()

    print("wrote %s (%ss @ %sfps)" % (out_path, seconds, fps))


if __name__ == "__main__":
    main()
