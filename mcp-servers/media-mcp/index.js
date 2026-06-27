/**
 * media-mcp — MCP server wrapping yt-dlp for video/transcript extraction
 *
 * Tools: video_info, extract_transcript, download_video, download_audio, list_downloads
 *
 * Config via env vars (set in PM2 ecosystem file — no code changes needed):
 *   YTDLP_PATH      Path to yt-dlp.exe     default: C:\tools\yt-dlp.exe
 *   MEDIA_ROOT      Root storage directory  default: D:\media
 *   MAX_HEIGHT      Max video resolution    default: 720
 *   VIDEO_FORMAT    Output container        default: mp4
 *   AUDIO_FORMAT    Audio container         default: mp3
 *   AUDIO_QUALITY   Audio bitrate           default: 128K
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { execFile } from "child_process";
import { promisify } from "util";
import { readdir, stat } from "fs/promises";
import { join } from "path";
import { z } from "zod";

const execFileAsync = promisify(execFile);

// ── Config (all overridable via env vars in PM2) ──────────────────────────────
const YTDLP   = process.env.YTDLP_PATH     ?? "C:\\tools\\yt-dlp.exe";
const ROOT    = process.env.MEDIA_ROOT     ?? "D:\\media";
const HEIGHT  = process.env.MAX_HEIGHT     ?? "720";
const VFMT    = process.env.VIDEO_FORMAT   ?? "mp4";
const AFMT    = process.env.AUDIO_FORMAT   ?? "mp3";
const AQUAL   = process.env.AUDIO_QUALITY  ?? "128K";

const DIRS = {
  downloads:   join(ROOT, "downloads"),
  transcripts: join(ROOT, "transcripts"),
  audio:       join(ROOT, "audio"),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Run yt-dlp with the given args. Returns { stdout, stderr }.
 * Timeout: 5 min for downloads, 30s for metadata.
 */
async function ytdlp(args, timeoutMs = 300_000) {
  return execFileAsync(YTDLP, args, {
    maxBuffer: 50 * 1024 * 1024, // 50 MB stdout buffer (for large JSON metadata)
    timeout: timeoutMs,
    windowsHide: true,
  });
}

/** Build an output template path for yt-dlp -o flag */
function outTemplate(dir, ext = "%(ext)s") {
  return join(dir, `%(upload_date>%Y-%m-%d)s_%(id)s_%(title).80B.%(ext)s`);
}

/** Format bytes to human-readable string */
function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

// ── MCP Server ────────────────────────────────────────────────────────────────
const server = new McpServer({
  name: "media-extract",
  version: "1.0.0",
});

// ── Tool: video_info ──────────────────────────────────────────────────────────
server.tool(
  "video_info",
  "Get metadata for a video URL without downloading it. Returns title, duration, uploader, view count, description, available formats, and subtitle languages.",
  { url: z.string().url().describe("Public URL of the video to inspect") },
  async ({ url }) => {
    try {
      const { stdout } = await ytdlp(
        ["-j", "--no-playlist", "--no-download", "--", url],
        30_000
      );
      const info = JSON.parse(stdout);
      const summary = {
        title:       info.title,
        uploader:    info.uploader ?? info.channel,
        duration_s:  info.duration,
        duration:    info.duration_string,
        upload_date: info.upload_date,
        view_count:  info.view_count,
        like_count:  info.like_count,
        description: (info.description ?? "").slice(0, 500),
        webpage_url: info.webpage_url,
        extractor:   info.extractor,
        subtitles:   Object.keys(info.subtitles ?? {}),
        auto_captions: Object.keys(info.automatic_captions ?? {}).slice(0, 10),
        formats_available: (info.formats ?? []).length,
        best_video_height: info.height,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: extract_transcript ──────────────────────────────────────────────────
server.tool(
  "extract_transcript",
  "Extract subtitles or auto-generated captions from a video URL. Saves .vtt and plain .txt files to D:\\media\\transcripts\\. Returns the transcript text directly so it can be used immediately.",
  {
    url:  z.string().url().describe("Public URL of the video"),
    lang: z.string().default("en").describe("Subtitle language code, e.g. 'en', 'es', 'fr'"),
  },
  async ({ url, lang }) => {
    const outTpl = outTemplate(DIRS.transcripts);
    try {
      // Try manual subs first, fall back to auto-captions
      await ytdlp([
        "--write-sub", "--write-auto-sub",
        "--sub-lang", `${lang},${lang}-orig`,
        "--sub-format", "vtt",
        "--convert-subs", "vtt",
        "--skip-download",
        "--no-playlist",
        "-o", outTpl,
        "--", url,
      ], 60_000);

      // Find the file that was written
      const files = await readdir(DIRS.transcripts);
      // yt-dlp appends .lang.vtt — find the most recently written one
      const vttFiles = files
        .filter(f => f.endsWith(".vtt"))
        .map(f => ({ name: f, path: join(DIRS.transcripts, f) }));

      if (vttFiles.length === 0) {
        return {
          content: [{ type: "text", text: `No subtitles found for language '${lang}'. Try video_info to see available subtitle languages.` }],
          isError: true,
        };
      }

      // Get most recently modified vtt
      const withStats = await Promise.all(
        vttFiles.map(async f => ({ ...f, mtime: (await stat(f.path)).mtimeMs }))
      );
      const latest = withStats.sort((a, b) => b.mtime - a.mtime)[0];

      // Read vtt and strip timing/tags to produce clean text
      const { readFile } = await import("fs/promises");
      const vttRaw = await readFile(latest.path, "utf8");
      const cleanText = vttRaw
        .split("\n")
        .filter(l => !l.match(/^\d{2}:\d{2}/) && !l.match(/^WEBVTT/) && !l.match(/^NOTE/) && l.trim())
        .join(" ")
        .replace(/<[^>]+>/g, "")       // strip HTML tags
        .replace(/\s{2,}/g, " ")       // collapse whitespace
        .trim();

      // Also save a plain .txt version alongside the .vtt
      const txtPath = latest.path.replace(/\.vtt$/, ".txt");
      const { writeFile } = await import("fs/promises");
      await writeFile(txtPath, cleanText, "utf8");

      return {
        content: [{
          type: "text",
          text: [
            `Transcript saved to: ${latest.path}`,
            `Plain text saved to: ${txtPath}`,
            `Characters: ${cleanText.length}`,
            "",
            "--- TRANSCRIPT ---",
            cleanText.slice(0, 8000),
            cleanText.length > 8000 ? `\n[...truncated — full text in file (${cleanText.length} chars)]` : "",
          ].join("\n"),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: download_video ──────────────────────────────────────────────────────
server.tool(
  "download_video",
  `Download a video to D:\\media\\downloads\\ as ${VFMT} at up to ${HEIGHT}p. Returns the saved file path and file size.`,
  {
    url:     z.string().url().describe("Public URL of the video to download"),
    height:  z.string().optional().describe(`Max resolution, e.g. '480', '720', '1080'. Defaults to ${HEIGHT}.`),
    format:  z.string().optional().describe(`Output container, e.g. 'mp4', 'mkv'. Defaults to ${VFMT}.`),
  },
  async ({ url, height, format }) => {
    const h = height ?? HEIGHT;
    const fmt = format ?? VFMT;
    const outTpl = outTemplate(DIRS.downloads);

    try {
      const { stdout, stderr } = await ytdlp([
        "-f", `bestvideo[height<=${h}][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`,
        "--merge-output-format", fmt,
        "--no-playlist",
        "-o", outTpl,
        "--print", "after_move:filepath",
        "--", url,
      ]);

      const filePath = stdout.trim().split("\n").pop();
      let sizeStr = "unknown";
      try {
        const s = await stat(filePath);
        sizeStr = fmtBytes(s.size);
      } catch { /* ignore */ }

      return {
        content: [{
          type: "text",
          text: [`Downloaded: ${filePath}`, `Size: ${sizeStr}`, `Resolution: up to ${h}p`, `Format: ${fmt}`].join("\n"),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}\n${err.stderr ?? ""}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: download_audio ──────────────────────────────────────────────────────
server.tool(
  "download_audio",
  `Extract audio from a video URL and save to D:\\media\\audio\\ as ${AFMT} at ${AQUAL}. Returns the saved file path.`,
  {
    url:     z.string().url().describe("Public URL of the video to extract audio from"),
    format:  z.string().optional().describe(`Audio format: 'mp3', 'm4a', 'opus', 'wav'. Defaults to ${AFMT}.`),
    quality: z.string().optional().describe(`Bitrate like '128K', '192K', '320K'. Defaults to ${AQUAL}.`),
  },
  async ({ url, format, quality }) => {
    const fmt  = format  ?? AFMT;
    const qual = quality ?? AQUAL;
    const outTpl = outTemplate(DIRS.audio);

    try {
      const { stdout } = await ytdlp([
        "-x",
        "--audio-format",   fmt,
        "--audio-quality",  qual,
        "--no-playlist",
        "-o", outTpl,
        "--print", "after_move:filepath",
        "--", url,
      ]);

      const filePath = stdout.trim().split("\n").pop();
      let sizeStr = "unknown";
      try {
        const s = await stat(filePath);
        sizeStr = fmtBytes(s.size);
      } catch { /* ignore */ }

      return {
        content: [{
          type: "text",
          text: [`Downloaded: ${filePath}`, `Size: ${sizeStr}`, `Format: ${fmt}`, `Quality: ${qual}`].join("\n"),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: list_downloads ──────────────────────────────────────────────────────
server.tool(
  "list_downloads",
  `List files saved in D:\\media\\. Shows downloads, transcripts, and audio. Returns filename, size, and date for each file.`,
  {
    folder: z.enum(["downloads", "transcripts", "audio", "all"]).default("all")
      .describe("Which subfolder to list"),
    limit:  z.number().int().min(1).max(200).default(50)
      .describe("Max number of files to return"),
  },
  async ({ folder, limit }) => {
    try {
      const targets = folder === "all"
        ? Object.entries(DIRS)
        : [[folder, DIRS[folder]]];

      const rows = [];
      for (const [name, dir] of targets) {
        let files;
        try { files = await readdir(dir); } catch { continue; }
        for (const f of files) {
          const fp = join(dir, f);
          try {
            const s = await stat(fp);
            if (s.isFile()) rows.push({ folder: name, name: f, size: fmtBytes(s.size), modified: s.mtime.toISOString().slice(0, 10) });
          } catch { /* skip */ }
        }
      }

      rows.sort((a, b) => b.modified.localeCompare(a.modified));
      const shown = rows.slice(0, limit);

      if (shown.length === 0) {
        return { content: [{ type: "text", text: `No files found in D:\\media\\${folder === "all" ? "" : folder}` }] };
      }

      const lines = shown.map(r => `[${r.folder}] ${r.name}  (${r.size}, ${r.modified})`);
      const summary = `${shown.length} of ${rows.length} files`;

      return {
        content: [{ type: "text", text: [summary, "", ...lines].join("\n") }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
// MCP servers must not write to stdout — all logging to stderr
process.stderr.write("media-mcp started\n");
