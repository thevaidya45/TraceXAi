"""Read the clock printed on specific frames of a recorded CCTV file.

Used for item timestamps. The clock is taken from the picture at that moment.
It is not calculated from a start time typed on the form.

Usage:
    python read_event_clocks.py --video <path> --seconds <csv> --out <result.json>
"""

import argparse
import json
import os
import re
import subprocess
import tempfile
from datetime import datetime

TEXT_HELPER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bin", "read_video_text")
CLOCK_ON_DATE = re.compile(
    r"(?P<date>(?:20\d{2}[-/.]\d{2}[-/.]\d{2})|(?:\d{2}[-/.]\d{2}[-/.]20\d{2}))"
    r".*?(?P<h>[01]\d|2[0-3]):(?P<m>[0-5]\d):(?P<s>[0-5]\d)"
)
WEEKDAY = {
    "mon": 0,
    "tue": 1,
    "wed": 2,
    "thu": 3,
    "fri": 4,
    "sat": 5,
    "sun": 6,
}
SEARCH_WINDOW_SECONDS = 8.0
SEARCH_STEP_SECONDS = 0.5


def read_printed_text(image_path):
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


def weekday_in(line):
    lowered = line.lower()
    for name, index in WEEKDAY.items():
        if name in lowered:
            return index
    return None


def iso_date(year, month, day):
    try:
        return datetime(year, month, day).strftime("%Y-%m-%d")
    except ValueError:
        return None


def normalize_date(raw, line):
    parts = re.split(r"[-/.]", raw)
    if len(parts) != 3:
        return None
    numbers = [int(part) for part in parts]
    if numbers[0] >= 2000:
        return iso_date(numbers[0], numbers[1], numbers[2])

    year = numbers[2]
    first, second = numbers[0], numbers[1]
    month_first = iso_date(year, first, second)
    day_first = iso_date(year, second, first)
    if month_first and not day_first:
        return month_first
    if day_first and not month_first:
        return day_first
    if not month_first:
        return None

    wanted = weekday_in(line)
    if wanted is None:
        # 03-30-2015 is month-day when both arrangements are valid only if
        # the second number is a day. Prefer the arrangement that is a real date
        # and, when both are, the one whose weekday is named on the line.
        return month_first
    month_day = datetime(year, first, second).weekday()
    day_month = datetime(year, second, first).weekday()
    if month_day == wanted:
        return month_first
    if day_month == wanted:
        return day_first
    return month_first


def clock_on_lines(lines):
    """Camera clock: a time printed on the same line as a date."""
    for line in lines:
        match = CLOCK_ON_DATE.search(line)
        if not match:
            continue
        date = normalize_date(match.group("date"), line)
        clock = "%s:%s:%s" % (match.group("h"), match.group("m"), match.group("s"))
        if date:
            return {"clock": clock, "date": date}
    return None


def frame_at(capture, seconds):
    import cv2

    capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, seconds) * 1000.0)
    retrieved, frame = capture.read()
    if not retrieved or frame is None:
        return None
    return frame


def ocr_frame(frame):
    import cv2

    handle, temp_path = tempfile.mkstemp(suffix=".jpg")
    os.close(handle)
    try:
        if not cv2.imwrite(temp_path, frame):
            return []
        return read_printed_text(temp_path)
    finally:
        try:
            os.remove(temp_path)
        except OSError:
            pass


def read_near(capture, target_seconds, duration):
    offsets = [0.0]
    step = SEARCH_STEP_SECONDS
    while step <= SEARCH_WINDOW_SECONDS:
        offsets.append(-step)
        offsets.append(step)
        step += SEARCH_STEP_SECONDS

    for offset in offsets:
        moment = round(target_seconds + offset, 3)
        if moment < 0 or (duration and moment > duration):
            continue
        frame = frame_at(capture, moment)
        if frame is None:
            continue
        found = clock_on_lines(ocr_frame(frame))
        if not found:
            continue
        found["videoSeconds"] = round(float(target_seconds), 3)
        found["readAtSeconds"] = moment
        return found
    return None


def main():
    parser = argparse.ArgumentParser(description="Read clocks printed on CCTV frames")
    parser.add_argument("--video", required=True)
    parser.add_argument("--seconds", required=True, help="Comma-separated offsets into the file")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    import cv2

    wanted = []
    for piece in args.seconds.split(","):
        piece = piece.strip()
        if not piece:
            continue
        try:
            value = float(piece)
        except ValueError:
            continue
        if value >= 0:
            wanted.append(value)

    result = {"ok": True, "events": []}
    if not wanted or not os.path.isfile(args.video):
        with open(args.out, "w", encoding="utf-8") as handle:
            json.dump(result, handle)
        return 0

    capture = cv2.VideoCapture(args.video)
    if not capture.isOpened():
        result["ok"] = False
        with open(args.out, "w", encoding="utf-8") as handle:
            json.dump(result, handle)
        return 1

    try:
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
        frames = float(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0)
        duration = frames / fps if fps > 0 and frames > 0 else None
        seen = set()
        for seconds in wanted:
            key = round(seconds, 2)
            if key in seen:
                continue
            seen.add(key)
            found = read_near(capture, seconds, duration)
            if found:
                result["events"].append(found)
    finally:
        capture.release()

    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(result, handle)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
