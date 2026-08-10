import fs from "fs/promises";
import path from "path";
import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";

type TLogCategory = "error" | "exceptions" | "rejections" | "success";

type TLogFileSummary = {
  name: string;
  size: number;
  modifiedAt: string;
};

const LOG_ROOT = path.resolve(process.cwd(), "logs");
const LOG_CATEGORIES: TLogCategory[] = [
  "error",
  "exceptions",
  "rejections",
  "success",
];

const MIN_LINES = 10;
const MAX_LINES = 5000;
const DEFAULT_LINES = 200;
const DEFAULT_MAX_BYTES = 128 * 1024;
const MAX_BYTES_LIMIT = 512 * 1024;

const assertCategory = (value: string): TLogCategory => {
  if (!LOG_CATEGORIES.includes(value as TLogCategory)) {
    throw new AppError(StatusCodes.BAD_REQUEST, `Invalid log category: ${value}`);
  }

  return value as TLogCategory;
};

const normalizeLines = (value: unknown): number => {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return DEFAULT_LINES;
  }

  return Math.max(MIN_LINES, Math.min(MAX_LINES, Math.floor(parsed)));
};

const normalizeMaxBytes = (value: unknown): number => {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return DEFAULT_MAX_BYTES;
  }

  return Math.max(8 * 1024, Math.min(MAX_BYTES_LIMIT, Math.floor(parsed)));
};

const resolveLogFilePath = (category: TLogCategory, fileName: string): string => {
  const safeName = path.basename(fileName);
  if (safeName !== fileName) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid file name");
  }

  if (!safeName.toLowerCase().endsWith(".log")) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Only .log files are supported");
  }

  return path.join(LOG_ROOT, category, safeName);
};

const listCategoryFiles = async (
  category: TLogCategory,
  limit = 50,
): Promise<TLogFileSummary[]> => {
  const categoryPath = path.join(LOG_ROOT, category);

  let entries;
  try {
    entries = await fs.readdir(categoryPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidateFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".log"))
    .map((entry) => entry.name);

  const fileInfos = await Promise.all(
    candidateFiles.map(async (name) => {
      const fullPath = path.join(categoryPath, name);
      const stat = await fs.stat(fullPath);
      return {
        name,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    }),
  );

  return fileInfos
    .sort(
      (a, b) =>
        new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime(),
    )
    .slice(0, limit);
};

const readTailByBytes = async (
  absolutePath: string,
  maxBytes: number,
): Promise<string> => {
  const stat = await fs.stat(absolutePath);
  const size = stat.size;
  if (size === 0) {
    return "";
  }

  const bytesToRead = Math.min(size, maxBytes);
  const startPosition = Math.max(0, size - bytesToRead);

  const fileHandle = await fs.open(absolutePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(bytesToRead);
    const { bytesRead } = await fileHandle.read(
      buffer,
      0,
      bytesToRead,
      startPosition,
    );

    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await fileHandle.close();
  }
};

const getAvailableLogs = async (category?: string) => {
  if (category) {
    const selected = assertCategory(category);
    return {
      selectedCategory: selected,
      categories: [
        {
          name: selected,
          files: await listCategoryFiles(selected),
        },
      ],
    };
  }

  const categories = await Promise.all(
    LOG_CATEGORIES.map(async (name) => ({
      name,
      files: await listCategoryFiles(name),
    })),
  );

  return {
    selectedCategory: "all",
    categories,
  };
};

const getLogFilePreview = async (params: {
  category: string;
  fileName: string;
  lines?: unknown;
  maxBytes?: unknown;
}) => {
  const category = assertCategory(params.category);
  const lines = normalizeLines(params.lines);
  const maxBytes = normalizeMaxBytes(params.maxBytes);
  const absolutePath = resolveLogFilePath(category, params.fileName);

  try {
    await fs.access(absolutePath);
  } catch {
    throw new AppError(StatusCodes.NOT_FOUND, "Log file not found");
  }

  const tailChunk = await readTailByBytes(absolutePath, maxBytes);
  const splitLines = tailChunk.split(/\r?\n/);
  const previewLines = splitLines.slice(Math.max(0, splitLines.length - lines));

  return {
    category,
    fileName: params.fileName,
    lines,
    maxBytes,
    fetchedAt: new Date().toISOString(),
    content: previewLines.join("\n"),
  };
};

const getLogsViewerHtml = (scriptSrc: string): string => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>StudioPass Logs</title>
  <style>
    :root {
      --bg: #f4f7fb;
      --panel: #ffffff;
      --text: #112032;
      --muted: #5b6b7d;
      --brand: #02B2FF;
      --brand-2: #0290d6;
      --line: #d9e2ec;
      --danger: #c53030;
      --shadow: 0 20px 50px rgba(16, 42, 67, 0.08);
      --mono: "JetBrains Mono", "Consolas", monospace;
      --ui: "Sora", "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; color: var(--text);
      font-family: var(--ui); background: var(--bg); padding: 20px;
    }
    .shell {
      max-width: 1300px; margin: 0 auto; background: var(--panel);
      border: 1px solid rgba(17, 32, 50, 0.08); border-radius: 20px;
      overflow: hidden; box-shadow: var(--shadow);
    }
    .head {
      padding: 18px; border-bottom: 1px solid var(--line);
      background: linear-gradient(100deg, #0f172a, #112032 60%, #073642);
      color: #f8fafc;
    }
    .title { margin: 0; font-size: 1.25rem; letter-spacing: 0.02em; }
    .sub { margin: 6px 0 0; color: #dbe7f5; font-size: 0.95rem; }
    .toolbar {
      display: grid; gap: 12px; grid-template-columns: repeat(12, minmax(0, 1fr));
      padding: 14px 18px; border-bottom: 1px solid var(--line); background: #f8fbff;
    }
    .field { display: flex; flex-direction: column; gap: 6px; }
    .field label {
      color: var(--muted); font-size: 0.8rem; letter-spacing: 0.06em;
      text-transform: uppercase; font-weight: 600;
    }
    .field input, .field select {
      border: 1px solid #c8d4e1; border-radius: 10px; padding: 9px 10px;
      background: #fff; color: var(--text); font-family: var(--ui); font-size: 0.95rem; outline: none;
    }
    .field input:focus, .field select:focus {
      border-color: var(--brand-2); box-shadow: 0 0 0 3px rgba(2, 178, 255, 0.15);
    }
    .span-4 { grid-column: span 4; }
    .span-2 { grid-column: span 2; }
    .actions { display: flex; gap: 10px; align-items: end; grid-column: span 2; }
    .btn {
      border: none; border-radius: 10px; padding: 10px 12px; cursor: pointer;
      color: #fff; background: linear-gradient(135deg, var(--brand), var(--brand-2));
      font-weight: 600; font-family: var(--ui); transition: transform 120ms ease;
    }
    .btn:active { transform: translateY(1px); }
    .btn.secondary { background: #334e68; }
    .content { display: grid; grid-template-columns: 330px 1fr; height: 75vh; }
    .left { border-right: 1px solid var(--line); background: #fbfdff; padding: 12px; overflow: auto; }
    .category { margin-bottom: 14px; border: 1px solid #dde7f0; border-radius: 12px; overflow: hidden; }
    .category h3 { margin: 0; padding: 10px 12px; font-size: 0.88rem; text-transform: uppercase; letter-spacing: 0.08em; background: #eaf2f8; color: #334e68; }
    .files { margin: 0; padding: 8px; list-style: none; }
    .file { border: 1px solid transparent; border-radius: 10px; padding: 8px; margin-bottom: 6px; cursor: pointer; transition: background 120ms ease, border-color 120ms ease; }
    .file:hover { background: #edf6fb; border-color: #d4e8f5; }
    .file.active { background: #dff3f6; border-color: #9ad5db; }
    .file-name { font-size: 0.9rem; color: #102a43; word-break: break-all; }
    .file-meta { margin-top: 3px; font-size: 0.75rem; color: #627d98; }
    .right { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
    .status { padding: 10px 14px; border-bottom: 1px solid var(--line); color: #486581; font-size: 0.9rem; }
    .status.error { color: var(--danger); background: #fff5f5; }
    .status.success { color: #0f5132; background: #ecfdf3; }
    pre {
      margin: 0; padding: 16px; flex: 1; overflow: auto; background: #0b1220;
      color: #e8f0fc; font-family: var(--mono); font-size: 0.84rem; line-height: 1.48;
      white-space: pre-wrap; word-break: break-word;
    }
  </style>
</head>
<body>
  <div class="shell" id="shell">
    <header class="head">
      <h1 class="title">StudioPass Log Console</h1>
      <p class="sub">Secure access to server logs.</p>
    </header>
    <section class="toolbar">
      <div class="field span-4">
        <label for="apiKey">Admin API Key</label>
        <input id="apiKey" type="password" placeholder="Enter ADMIN_SECRET_KEY" autocomplete="off" />
      </div>
      <div class="field span-2">
        <label for="category">Category</label>
        <select id="category">
          <option value="error">error</option>
          <option value="exceptions">exceptions</option>
          <option value="rejections">rejections</option>
          <option value="success">success</option>
          <option value="all">all</option>
        </select>
      </div>
      <div class="field span-2">
        <label for="lines">Lines</label>
        <select id="lines">
          <option value="100">100</option>
          <option value="200" selected>200</option>
          <option value="500">500</option>
          <option value="1000">1000</option>
          <option value="2000">2000</option>
          <option value="5000">MAX (5000)</option>
        </select>
      </div>
      <div class="actions">
        <button class="btn" id="loadBtn">Load</button>
        <button class="btn secondary" id="refreshBtn">Refresh</button>
      </div>
    </section>
    <section class="content">
      <aside class="left" id="fileList"></aside>
      <section class="right">
        <div class="status" id="status">Ready</div>
        <pre id="viewer">Select a log file to preview content.</pre>
      </section>
    </section>
  </div>
  <script src="${scriptSrc}"></script>
</body>
</html>`;
};

const getLogsViewerScript = (): string => {
  return `
const fileList = document.getElementById('fileList');
const viewer = document.getElementById('viewer');
const statusBar = document.getElementById('status');
const apiKeyInput = document.getElementById('apiKey');
const categoryInput = document.getElementById('category');
const linesInput = document.getElementById('lines');
const loadBtn = document.getElementById('loadBtn');
const refreshBtn = document.getElementById('refreshBtn');

let selected = { category: null, fileName: null };

function setStatus(msg, mode) {
  statusBar.textContent = msg;
  statusBar.classList.remove('error', 'success');
  if (mode) statusBar.classList.add(mode);
}

function buildHeaders() { return { 'x-admin-key': apiKeyInput.value.trim() }; }

function withAuthQuery(url) {
  const key = apiKeyInput.value.trim();
  if (!key) return url;
  const sep = url.includes('?') ? '&' : '?';
  return url + sep + 'adminKey=' + encodeURIComponent(key);
}

function sizeToText(s) {
  if (s < 1024) return s + ' B';
  if (s < 1048576) return (s / 1024).toFixed(1) + ' KB';
  return (s / 1048576).toFixed(2) + ' MB';
}

async function loadFiles() {
  if (!apiKeyInput.value.trim()) { setStatus('Enter Admin API Key first', 'error'); return; }
  setStatus('Loading...');
  const cat = categoryInput.value;
  const q = cat === 'all' ? '' : '?category=' + encodeURIComponent(cat);
  try {
    const r = await fetch(withAuthQuery('/api/v1/logs' + q), { headers: buildHeaders() });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message);
    renderFileList(d.data.categories || []);
    setStatus('Loaded.', 'success');
  } catch (e) { setStatus(e.message, 'error'); }
}

function renderFileList(cats) {
  fileList.innerHTML = '';
  cats.forEach(cat => {
    const sec = document.createElement('section'); sec.className = 'category';
    const h3 = document.createElement('h3'); h3.textContent = cat.name + ' (' + cat.files.length + ')';
    const ul = document.createElement('ul'); ul.className = 'files';
    cat.files.forEach(f => {
      const li = document.createElement('li'); li.className = 'file';
      const nm = document.createElement('div'); nm.className = 'file-name'; nm.textContent = f.name;
      const mt = document.createElement('div'); mt.className = 'file-meta';
      mt.textContent = sizeToText(f.size) + ' \\u2022 ' + new Date(f.modifiedAt).toLocaleString();
      li.append(nm, mt);
      li.addEventListener('click', () => {
        selected = { category: cat.name, fileName: f.name };
        document.querySelectorAll('.file.active').forEach(n => n.classList.remove('active'));
        li.classList.add('active');
        loadContent();
      });
      ul.appendChild(li);
    });
    sec.append(h3, ul); fileList.appendChild(sec);
  });
}

async function loadContent() {
  if (!selected.category || !selected.fileName) { viewer.textContent = 'Select a file.'; return; }
  if (!apiKeyInput.value.trim()) { setStatus('Enter API Key', 'error'); return; }
  setStatus('Loading ' + selected.fileName + '...');
  const url = '/api/v1/logs/' + encodeURIComponent(selected.category) + '/' + encodeURIComponent(selected.fileName) + '?lines=' + linesInput.value;
  try {
    const r = await fetch(withAuthQuery(url), { headers: buildHeaders() });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message);
    viewer.textContent = d.data.content || '(empty)';
    setStatus(d.data.fileName + ' \\u2022 ' + d.data.lines + ' lines', 'success');
  } catch (e) { viewer.textContent = ''; setStatus(e.message, 'error'); }
}

loadBtn.addEventListener('click', async () => { await loadFiles(); viewer.textContent = 'Select a file.'; selected = { category: null, fileName: null }; });
refreshBtn.addEventListener('click', async () => { await loadFiles(); if (selected.category && selected.fileName) await loadContent(); });
linesInput.addEventListener('change', () => { if (selected.category && selected.fileName) loadContent(); });
categoryInput.addEventListener('change', () => { loadFiles(); viewer.textContent = 'Select a file.'; selected = { category: null, fileName: null }; });
loadFiles();`;
};

export const LogsService = {
  getAvailableLogs,
  getLogFilePreview,
  getLogsViewerHtml,
  getLogsViewerScript,
};
