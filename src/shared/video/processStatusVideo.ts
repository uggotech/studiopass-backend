import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { logger } from "../../logger/logger";

export const STATUS_MAX_VIDEO_SECONDS = 45;

/** Longest side / shortest side limits for "no re-encode needed" (1080p, portrait or landscape). */
const MAX_LONG_SIDE = 1920;
const MAX_SHORT_SIDE = 1080;

/** Max ffmpeg jobs running at once (each one can use a full CPU core). */
const MAX_CONCURRENT_JOBS = 2;
const COPY_TIMEOUT_MS = 60_000;
const TRANSCODE_TIMEOUT_MS = 180_000;

// ─── Tiny semaphore so parallel uploads can not saturate the CPU ─────────────
let runningJobs = 0;
const waitingJobs: Array<() => void> = [];

async function acquireJobSlot(): Promise<void> {
  if (runningJobs < MAX_CONCURRENT_JOBS) {
    runningJobs++;
    return;
  }
  await new Promise<void>((resolve) => waitingJobs.push(resolve));
  runningJobs++;
}

function releaseJobSlot(): void {
  runningJobs--;
  const next = waitingJobs.shift();
  if (next) next();
}

export interface VideoProbe {
  videoCodec: string | null;
  audioCodec: string | null;
  pixelFormat: string | null;
  width: number;
  height: number;
  durationSec: number | null;
  formatName: string;
}

/**
 * Process a status video with system ffmpeg.
 *
 *  - Already phone-friendly (H.264 + AAC, yuv420p, up to 1080p, MP4/MOV container):
 *    NO re-encode. The streams are copied (lossless, takes a moment) and only trimmed
 *    when the video is longer than STATUS_MAX_VIDEO_SECONDS or a start offset was chosen.
 *  - Anything else (HEVC / iPhone, VP9, 4K, 10-bit ...): converted to H.264 MP4 at the
 *    original orientation, capped at 1080p.
 *
 * Returns an MP4 buffer.
 */
export async function processStatusVideo(
  inputBuffer: Buffer,
  options: { startSec?: number } = {},
): Promise<Buffer> {
  const startSec = Math.max(0, Number(options.startSec) || 0);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sp-video-"));
  const inputPath = path.join(tmpDir, "input.bin");
  const outputPath = path.join(tmpDir, "output.mp4");

  await acquireJobSlot();
  try {
    await fs.writeFile(inputPath, inputBuffer);

    const probe = await probeVideoFile(inputPath);
    const canCopy = probe ? isPhoneFriendly(probe) : false;

    if (canCopy) {
      const needsTrim =
        startSec > 0 || (probe!.durationSec !== null && probe!.durationSec > STATUS_MAX_VIDEO_SECONDS);
      const args = [
        ...(needsTrim && startSec > 0 ? ["-ss", String(startSec)] : []),
        "-i",
        inputPath,
        ...(needsTrim ? ["-t", String(STATUS_MAX_VIDEO_SECONDS)] : []),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        "-y",
        outputPath,
      ];
      try {
        await runFfmpeg(args, COPY_TIMEOUT_MS);
        return await fs.readFile(outputPath);
      } catch (copyErr) {
        // A stream that can not be copied cleanly is converted instead
        logger.warn(
          `[VideoProcess] Stream copy failed, converting instead: ${
            copyErr instanceof Error ? copyErr.message : String(copyErr)
          }`,
        );
      }
    }

    const args = [
      ...(startSec > 0 ? ["-ss", String(startSec)] : []),
      "-i",
      inputPath,
      "-t",
      String(STATUS_MAX_VIDEO_SECONDS),
      // Cap the short side at 1080 and keep the orientation (portrait stays portrait)
      "-vf",
      "scale='if(gt(iw,ih),-2,min(1080,iw))':'if(gt(iw,ih),min(1080,ih),-2)'",
      "-c:v",
      "libx264",
      "-crf",
      "20",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-y",
      outputPath,
    ];

    await runFfmpeg(args, TRANSCODE_TIMEOUT_MS);
    return await fs.readFile(outputPath);
  } finally {
    releaseJobSlot();
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

/** True when the file can be stored without re-encoding. Exported for tests. */
export function isPhoneFriendly(probe: VideoProbe): boolean {
  if (probe.videoCodec !== "h264") return false;
  if (probe.audioCodec && probe.audioCodec !== "aac") return false;
  if (probe.pixelFormat && probe.pixelFormat !== "yuv420p") return false;
  if (!/mp4|mov/.test(probe.formatName)) return false;
  if (probe.width <= 0 || probe.height <= 0) return false;

  const longSide = Math.max(probe.width, probe.height);
  const shortSide = Math.min(probe.width, probe.height);
  return longSide <= MAX_LONG_SIDE && shortSide <= MAX_SHORT_SIDE;
}

function runFfmpeg(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutMs);

    proc.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`ffmpeg failed to start: ${err.message}`));
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`ffmpeg timed out after ${timeoutMs}ms`));
      else if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/** Codec / size / duration of a video file, or null when ffprobe is not available or fails. */
async function probeVideoFile(inputPath: string): Promise<VideoProbe | null> {
  return new Promise((resolve) => {
    const proc = spawn(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", inputPath],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    proc.stdout.on("data", (c) => (out += String(c)));
    proc.on("error", () => resolve(null));
    proc.on("close", () => {
      try {
        const json = JSON.parse(out);
        const streams: any[] = json.streams || [];
        const video = streams.find((s) => s.codec_type === "video");
        const audio = streams.find((s) => s.codec_type === "audio");
        if (!video) return resolve(null);

        // Phone videos are often stored sideways with a rotation flag: swap width / height
        const rotation = Math.abs(
          Number(
            video.tags?.rotate ??
              video.side_data_list?.find((d: any) => d.rotation !== undefined)?.rotation ??
              0,
          ),
        );
        const sideways = rotation === 90 || rotation === 270;
        const rawW = Number(video.width) || 0;
        const rawH = Number(video.height) || 0;

        const duration = Number(json.format?.duration ?? video.duration);
        resolve({
          videoCodec: video.codec_name ?? null,
          audioCodec: audio?.codec_name ?? null,
          pixelFormat: video.pix_fmt ?? null,
          width: sideways ? rawH : rawW,
          height: sideways ? rawW : rawH,
          durationSec: Number.isFinite(duration) ? duration : null,
          formatName: String(json.format?.format_name ?? ""),
        });
      } catch {
        resolve(null);
      }
    });
  });
}

export async function probeVideoDurationSeconds(inputBuffer: Buffer): Promise<number | null> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sp-probe-"));
  const inputPath = path.join(tmpDir, "input.bin");
  try {
    await fs.writeFile(inputPath, inputBuffer);
    return await new Promise((resolve) => {
      const proc = spawn(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "default=noprint_wrappers=1:nokey=1",
          inputPath,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let out = "";
      proc.stdout.on("data", (c) => (out += String(c)));
      proc.on("error", () => resolve(null));
      proc.on("close", () => {
        const n = parseFloat(out.trim());
        resolve(Number.isFinite(n) ? n : null);
      });
    });
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

/** Log helper so callers can surface processing failures clearly. */
export function logVideoProcessError(message: string, err: unknown) {
  logger.error(`[VideoProcess] ${message}`, {
    error: err instanceof Error ? err.message : String(err),
  });
}
