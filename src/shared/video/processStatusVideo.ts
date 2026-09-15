import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { logger } from "../logger/logger";

export const STATUS_MAX_VIDEO_SECONDS = 45;

/**
 * Transcode + compress a status video with system ffmpeg.
 * Optionally trims from startSec, always caps at STATUS_MAX_VIDEO_SECONDS.
 * Returns H.264 MP4 suitable for mobile playback.
 */
export async function processStatusVideo(
  inputBuffer: Buffer,
  options: { startSec?: number } = {},
): Promise<Buffer> {
  const startSec = Math.max(0, Number(options.startSec) || 0);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sp-video-"));
  const inputPath = path.join(tmpDir, "input.bin");
  const outputPath = path.join(tmpDir, "output.mp4");

  try {
    await fs.writeFile(inputPath, inputBuffer);

    const args = [
      ...(startSec > 0 ? ["-ss", String(startSec)] : []),
      "-i",
      inputPath,
      "-t",
      String(STATUS_MAX_VIDEO_SECONDS),
      "-vf",
      "scale=720:-2",
      "-c:v",
      "libx264",
      "-crf",
      "26",
      "-preset",
      "veryfast",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-y",
      outputPath,
    ];

    await runFfmpeg(args);
    return await fs.readFile(outputPath);
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    proc.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });

    proc.on("error", (err) => {
      reject(new Error(`ffmpeg failed to start: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
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
