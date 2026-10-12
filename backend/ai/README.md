# Module 5 — recorded CCTV analysis worker

This folder holds the Python worker that analyses CCTV files **already stored by
Module 4**. The Node backend resolves the file from its stored `fileKey`, spawns
this worker, and saves only the results. The video is never copied, re-uploaded,
or stored in MongoDB.

What the worker does:

- reads the recording with OpenCV and samples frames (`FRAME_INTERVAL`)
- detects objects with YOLO (`ultralytics`)
- keeps consistent anonymous tracking IDs with ByteTrack
- returns tracks, timestamps, and counts as JSON

What it deliberately does not do: face recognition, identity matching, suspect
scoring, live camera streams, or anything from Module 6.

## Setup

```bash
# from the backend folder
npm run ai:setup
```

That creates `backend/ai/.venv` and installs `ai/requirements.txt`
(opencv-python-headless, ultralytics, lap).

## Model weights

The worker never downloads weights at request time. Place the file here:

```
backend/ai/models/yolov8n.pt
```

Download it once:

```bash
curl -fSL -o backend/ai/models/yolov8n.pt \
  https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8n.pt
```

Use a different model or location with `YOLO_MODEL_PATH`. If the file is
missing, analysis fails with "The AI detection model is not installed on this
server." instead of stalling.

## Configuration

All tuning lives in `backend/config/aiConfig.js` and can be overridden with the
`AI_*` / `YOLO_*` / `FRAME_INTERVAL` variables listed in `backend/.env.example`.

## Verifying the pipeline

`npm run test:module5` stubs the worker so the suite runs anywhere. To exercise
the real pipeline end to end through the admin API:

```bash
# build a synthetic clip (not campus footage) and analyse it
backend/ai/.venv/bin/python backend/ai/tools/make_sample_clip.py /tmp/clip.mp4 30 10 zidane.jpg
npm run ai:check --prefix backend -- /tmp/clip.mp4 10:00
```

The check prints the real video metadata, item last-seen/disappearance values,
and anonymous tracking summary.

## Running the worker directly

```bash
.venv/bin/python analyze_cctv.py --config <config.json> --out <result.json>
```

`config.json` accepts `videoPath`, `modelPath`, `personClass`, `itemClasses`,
`confidence`, `frameInterval`, `maxSampledFrames`, and `tracker`. Results are
written to `--out`; stdout is not used for data.
