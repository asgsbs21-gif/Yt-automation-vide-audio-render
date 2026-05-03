import ffmpeg from "fluent-ffmpeg";
import path from "path";
import fs from "fs";
import { addLog } from "./data.js";

// ── Concatenate videos and overlay audio ─────────────────────────────────────

export async function mergeVideoWithAudio(
  videoPaths: string[],
  audioPath: string,
  outputPath: string
): Promise<string> {
  addLog(
    "process",
    "info",
    `Merging ${videoPaths.length} video(s) with audio...`
  );

  return new Promise((resolve, reject) => {
    if (videoPaths.length === 1) {
      // Single video: just mute + overlay audio
      ffmpeg()
        .input(videoPaths[0])
        .input(audioPath)
        .outputOptions([
          "-map 0:v:0",
          "-map 1:a:0",
          "-c:v libx264",
          "-c:a aac",
          "-b:a 128k",
          "-shortest",
          "-vf scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
          "-movflags +faststart",
        ])
        .output(outputPath)
        .on("end", () => {
          addLog("process", "success", "Video merge complete");
          resolve(outputPath);
        })
        .on("error", (err: Error) => {
          addLog("process", "error", "FFmpeg error", err.message);
          reject(err);
        })
        .run();
    } else {
      // Multiple videos: concatenate first, then overlay audio
      const concatListPath = path.join(path.dirname(outputPath), "concat_list.txt");
      const concatContent = videoPaths
        .map((p) => `file '${p}'`)
        .join("\n");
      fs.writeFileSync(concatListPath, concatContent);

      const concatOutput = path.join(
        path.dirname(outputPath),
        `concat_${Date.now()}.mp4`
      );

      // Step 1: Concatenate
      ffmpeg()
        .input(concatListPath)
        .inputOptions(["-f concat", "-safe 0"])
        .outputOptions(["-c copy"])
        .output(concatOutput)
        .on("end", () => {
          // Step 2: Overlay audio
          ffmpeg()
            .input(concatOutput)
            .input(audioPath)
            .outputOptions([
              "-map 0:v:0",
              "-map 1:a:0",
              "-c:v libx264",
              "-c:a aac",
              "-b:a 128k",
              "-shortest",
              "-vf scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
              "-movflags +faststart",
            ])
            .output(outputPath)
            .on("end", () => {
              // Cleanup temp files
              try {
                fs.unlinkSync(concatListPath);
                fs.unlinkSync(concatOutput);
              } catch {}
              addLog("process", "success", "Video merge complete");
              resolve(outputPath);
            })
            .on("error", (err: Error) => {
              addLog("process", "error", "FFmpeg overlay error", err.message);
              reject(err);
            })
            .run();
        })
        .on("error", (err: Error) => {
          addLog("process", "error", "FFmpeg concat error", err.message);
          reject(err);
        })
        .run();
    }
  });
}
