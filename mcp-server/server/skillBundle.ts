import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface BundlePaths {
  zipPath: string;
  tarGzPath: string;
  zipSize: number;
  tarGzSize: number;
  fileCount: number;
}

const BUNDLE_DIR = path.join(os.tmpdir(), 'long-novel-workflow-release-cache');
const ZIP_PATH = path.join(BUNDLE_DIR, 'long-novel-workflow-v2.1.0.zip');
const TARGZ_PATH = path.join(BUNDLE_DIR, 'long-novel-workflow-v2.1.0.tar.gz');

const PYTHON_PACKAGER = `
import json, os, shutil, sys, tarfile, zipfile

root_dir = sys.argv[1]
cache_dir = sys.argv[2]
zip_path = sys.argv[3]
targz_path = sys.argv[4]

skill_dir = os.path.join(root_dir, "skill-repo")
if not os.path.isdir(skill_dir):
    raise RuntimeError("skill-repo directory not found")

stage_root = os.path.join(cache_dir, "stage")
bundle_root = os.path.join(stage_root, "long-novel-workflow-v2.1.0")
shutil.rmtree(stage_root, ignore_errors=True)
os.makedirs(cache_dir, exist_ok=True)

def ignore_junk(_d, names):
    return [n for n in names if n in ("node_modules", ".git", "dist", "__pycache__", ".DS_Store")]

# 1. Copy full skill-repo (SKILL.md, scripts, data, docs, templates, checklists, examples, mcp-server base)
shutil.copytree(skill_dir, bundle_root, ignore=ignore_junk)

# 2. Merge full web workbench into <bundle_root>/mcp-server
mcp_dir = os.path.join(bundle_root, "mcp-server")
os.makedirs(mcp_dir, exist_ok=True)

workbench_files = [
    "index.html",
    "vite.config.ts",
    "metadata.json",
    ".env.example",
    "server.ts",
]
for fname in workbench_files:
    src = os.path.join(root_dir, fname)
    if os.path.isfile(src):
        shutil.copy2(src, os.path.join(mcp_dir, fname))

for dname in ("src", "server"):
    src_sub = os.path.join(root_dir, dname)
    dst_sub = os.path.join(mcp_dir, dname)
    if os.path.isdir(src_sub):
        shutil.copytree(src_sub, dst_sub, dirs_exist_ok=True, ignore=ignore_junk)

# Write tailored tsconfig.json for mcp-server (excludes JS MCP files from tsc check)
ts_cfg_path = os.path.join(root_dir, "tsconfig.json")
if os.path.isfile(ts_cfg_path):
    with open(ts_cfg_path, "r", encoding="utf-8") as f:
        ts_cfg = json.load(f)
    ts_cfg["exclude"] = ["dist", "node_modules", "server.js", "src/audit.js", "src/book.js", "src/tools.js", "test"]
    with open(os.path.join(mcp_dir, "tsconfig.json"), "w", encoding="utf-8") as f:
        json.dump(ts_cfg, f, indent=2, ensure_ascii=False)

# Merge mcp-server/package.json + workbench package.json
mcp_pkg_path = os.path.join(mcp_dir, "package.json")
web_pkg_path = os.path.join(root_dir, "package.json")
mcp_pkg = json.load(open(mcp_pkg_path, "r", encoding="utf-8")) if os.path.isfile(mcp_pkg_path) else {}
web_pkg = json.load(open(web_pkg_path, "r", encoding="utf-8")) if os.path.isfile(web_pkg_path) else {}

merged_deps = {}
merged_deps.update(web_pkg.get("dependencies", {}))
merged_deps.update(mcp_pkg.get("dependencies", {}))

merged_dev_deps = {}
merged_dev_deps.update(web_pkg.get("devDependencies", {}))
merged_dev_deps.update(mcp_pkg.get("devDependencies", {}))

merged_pkg = {
    "name": mcp_pkg.get("name", "long-novel-mcp"),
    "version": "2.1.0",
    "private": True,
    "type": "module",
    "description": "MCP server & Full-Stack Web Workbench (Long Novel Studio) for long-novel-workflow v2.1.0",
    "author": mcp_pkg.get("author", "zilintea"),
    "license": mcp_pkg.get("license", "MIT"),
    "engines": mcp_pkg.get("engines", {"node": ">=18"}),
    "bin": mcp_pkg.get("bin", {"long-novel-mcp": "./server.js"}),
    "scripts": {
        "start": "node server.js",
        "start:http": "node server.js --transport http",
        "dev": "tsx server.ts",
        "studio": "tsx server.ts",
        "studio:start": "NODE_ENV=production tsx server.ts",
        "build": "vite build",
        "preview": "vite preview",
        "lint": "tsc --noEmit",
        "test": "node test/smoke.mjs",
    },
    "dependencies": merged_deps,
    "devDependencies": merged_dev_deps,
    "keywords": mcp_pkg.get("keywords", ["mcp", "novel", "long-novel-workflow"]),
}
with open(mcp_pkg_path, "w", encoding="utf-8") as f:
    json.dump(merged_pkg, f, indent=2, ensure_ascii=False)
    f.write("\\n")

lock_path = os.path.join(mcp_dir, "package-lock.json")
if os.path.isfile(lock_path):
    os.remove(lock_path)

# 3. Write deterministic .zip and .tar.gz
tmp_zip = zip_path + ".tmp"
tmp_targz = targz_path + ".tmp"
file_count = 0

with zipfile.ZipFile(tmp_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
    for base, dirs, files in os.walk(bundle_root):
        dirs.sort()
        files.sort()
        for fn in files:
            full = os.path.join(base, fn)
            rel = os.path.relpath(full, stage_root)
            zf.write(full, rel)
            file_count += 1

with tarfile.open(tmp_targz, "w:gz") as tf:
    tf.add(bundle_root, arcname="long-novel-workflow-v2.1.0")

os.replace(tmp_zip, zip_path)
os.replace(tmp_targz, targz_path)
shutil.rmtree(stage_root, ignore_errors=True)
print(json.dumps({"fileCount": file_count, "zipSize": os.path.getsize(zip_path), "tarGzSize": os.path.getsize(targz_path)}))
`;

let cachedMeta: BundlePaths | null = null;

export function buildSkillBundle(rootDir: string, force = false): BundlePaths {
  if (!force && cachedMeta && fs.existsSync(ZIP_PATH) && fs.existsSync(TARGZ_PATH)) {
    return cachedMeta;
  }

  fs.mkdirSync(BUNDLE_DIR, { recursive: true });
  const stdout = execFileSync(
    'python3',
    ['-c', PYTHON_PACKAGER, rootDir, BUNDLE_DIR, ZIP_PATH, TARGZ_PATH],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
  );
  const parsed = JSON.parse(stdout.trim()) as {
    fileCount: number;
    zipSize: number;
    tarGzSize: number;
  };
  cachedMeta = {
    zipPath: ZIP_PATH,
    tarGzPath: TARGZ_PATH,
    zipSize: parsed.zipSize,
    tarGzSize: parsed.tarGzSize,
    fileCount: parsed.fileCount,
  };
  return cachedMeta;
}
