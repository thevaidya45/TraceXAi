const { spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const config = require('../config/aiConfig');

const SCRIPT = path.join(config.AI_DIR, 'make_browser_mp4.py');
const TIMEOUT_MS = 15 * 60 * 1000;

function containsTag(buffer, tag) {
  return buffer.includes(Buffer.from(tag));
}

async function readTail(filePath, size, length) {
  const take = Math.min(size, length);
  const handle = await fsp.open(filePath, 'r');
  try {
    const tail = Buffer.alloc(take);
    await handle.read(tail, 0, take, size - take);
    return tail;
  } finally {
    await handle.close();
  }
}

/**
 * Chrome plays H.264. Some CCTV exports are MPEG-4 Part 2 (mp4v), which the
 * player treats as an empty black video even though the file was stored.
 */
async function needsBrowserTranscode(filePath) {
  const stat = await fsp.stat(filePath);
  if (!stat.isFile() || stat.size < 64) {
    return false;
  }
  const headLength = Math.min(stat.size, 1024 * 1024);
  const head = Buffer.alloc(headLength);
  const handle = await fsp.open(filePath, 'r');
  try {
    await handle.read(head, 0, headLength, 0);
  } finally {
    await handle.close();
  }
  const tail = await readTail(filePath, stat.size, 8 * 1024 * 1024);
  const sample = Buffer.concat([head, tail]);
  const playable = containsTag(sample, 'avc1') || containsTag(sample, 'avc3');
  const legacyMpeg4 = containsTag(sample, 'mp4v');
  return legacyMpeg4 && !playable;
}

function workerEnv() {
  return {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    LANG: process.env.LANG || 'C.UTF-8',
    SYSTEMROOT: process.env.SYSTEMROOT || ''
  };
}

function runTranscode(source, destination) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(config.PYTHON_BIN, [SCRIPT, source, destination], {
        cwd: config.AI_DIR,
        env: workerEnv(),
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: TIMEOUT_MS,
        killSignal: 'SIGKILL'
      });
    } catch (err) {
      resolve(false);
      return;
    }

    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (stdout.length < 2000) stdout += chunk;
    });
    child.on('error', () => resolve(false));
    child.on('close', (code) => {
      if (code !== 0) {
        resolve(false);
        return;
      }
      try {
        resolve(JSON.parse(stdout).ok === true);
      } catch (err) {
        resolve(false);
      }
    });
  });
}

const CONTAINER_BOXES = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'udta', 'mvex']);

function readBoxSize(buffer, offset) {
  const size = buffer.readUInt32BE(offset);
  if (size === 1) {
    return { size: Number(buffer.readBigUInt64BE(offset + 8)), header: 16 };
  }
  if (size === 0) {
    return { size: buffer.length - offset, header: 8 };
  }
  return { size, header: 8 };
}

function parseTopBoxes(buffer) {
  const boxes = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const { size, header } = readBoxSize(buffer, offset);
    if (size < header || offset + size > buffer.length) {
      return null;
    }
    boxes.push({
      type: buffer.slice(offset + 4, offset + 8).toString('ascii'),
      start: offset,
      size,
      header
    });
    offset += size;
  }
  return offset === buffer.length ? boxes : null;
}

function patchChunkOffsets(buffer, start, end, delta) {
  let offset = start;
  while (offset + 8 <= end) {
    const { size, header } = readBoxSize(buffer, offset);
    if (size < header || offset + size > end) {
      return;
    }
    const type = buffer.slice(offset + 4, offset + 8).toString('ascii');
    if (type === 'stco' || type === 'co64') {
      const count = buffer.readUInt32BE(offset + header + 4);
      let cursor = offset + header + 8;
      const width = type === 'co64' ? 8 : 4;
      if (cursor + count * width > offset + size) {
        return;
      }
      for (let index = 0; index < count; index += 1) {
        if (type === 'co64') {
          buffer.writeBigUInt64BE(buffer.readBigUInt64BE(cursor) + BigInt(delta), cursor);
        } else {
          buffer.writeUInt32BE(buffer.readUInt32BE(cursor) + delta, cursor);
        }
        cursor += width;
      }
    } else if (CONTAINER_BOXES.has(type)) {
      patchChunkOffsets(buffer, offset + header, offset + size, delta);
    }
    offset += size;
  }
}

/**
 * Move the moov box in front of the media data. Chrome otherwise has to read
 * the end of the file before it can show a duration or start playback.
 */
async function faststartMp4(filePath) {
  const original = await fsp.readFile(filePath);
  const boxes = parseTopBoxes(original);
  if (!boxes) {
    return false;
  }
  const moov = boxes.find((box) => box.type === 'moov');
  const mdat = boxes.find((box) => box.type === 'mdat');
  if (!moov || !mdat || moov.start < mdat.start) {
    return false;
  }

  const moovBuffer = Buffer.from(original.subarray(moov.start, moov.start + moov.size));
  const oldPayload = mdat.start + mdat.header;
  const leadSize = boxes
    .filter((box) => box.type !== 'moov' && box.start < mdat.start)
    .reduce((sum, box) => sum + box.size, 0);
  const delta = leadSize + moov.size + mdat.header - oldPayload;
  patchChunkOffsets(moovBuffer, 8, moovBuffer.length, delta);

  const temporary = `${filePath}.faststart.mp4`;
  const handle = await fsp.open(temporary, 'w');
  try {
    for (const box of boxes) {
      if (box.type === 'moov' || box.type === 'mdat') {
        continue;
      }
      if (box.start > mdat.start) {
        continue;
      }
      await handle.write(original.subarray(box.start, box.start + box.size));
    }
    await handle.write(moovBuffer);
    await handle.write(original.subarray(mdat.start, mdat.start + mdat.size));
    for (const box of boxes) {
      if (box.start > mdat.start && box.type !== 'moov') {
        await handle.write(original.subarray(box.start, box.start + box.size));
      }
    }
  } finally {
    await handle.close();
  }

  const rewritten = await fsp.readFile(temporary);
  const rewrittenBoxes = parseTopBoxes(rewritten);
  const rewrittenMoov = rewrittenBoxes && rewrittenBoxes.find((box) => box.type === 'moov');
  const rewrittenMdat = rewrittenBoxes && rewrittenBoxes.find((box) => box.type === 'mdat');
  if (!rewrittenMoov || !rewrittenMdat || rewrittenMoov.start > rewrittenMdat.start || rewritten.length !== original.length) {
    await fsp.unlink(temporary).catch(() => {});
    return false;
  }
  await fsp.rename(temporary, filePath);
  return true;
}

async function ensureBrowserMp4(filePath) {
  if (!filePath || path.extname(filePath).toLowerCase() !== '.mp4') {
    return false;
  }
  if (!fs.existsSync(config.PYTHON_BIN) || !fs.existsSync(SCRIPT)) {
    return false;
  }
  if (!(await needsBrowserTranscode(filePath))) {
    return false;
  }

  const temporary = `${filePath}.browser.mp4`;
  const ok = await runTranscode(filePath, temporary);
  let playable = false;
  if (ok) {
    try {
      playable = !(await needsBrowserTranscode(temporary));
    } catch (err) {
      playable = false;
    }
  }
  if (!playable) {
    await fsp.unlink(temporary).catch(() => {});
    return false;
  }
  await fsp.rename(temporary, filePath);
  await faststartMp4(filePath);
  return true;
}

async function prepareBrowserPlayback(filePath) {
  const transcoded = await ensureBrowserMp4(filePath);
  if (!transcoded) {
    await faststartMp4(filePath);
  }
  return true;
}

module.exports = {
  needsBrowserTranscode,
  ensureBrowserMp4,
  faststartMp4,
  prepareBrowserPlayback
};
