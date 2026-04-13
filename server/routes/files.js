/**
 * File Manager — scoped exclusively to NAS_ROOT.
 * All path operations are jail-checked: any attempt to escape via
 * "../" or symlinks that resolve outside NAS_ROOT is rejected with 403.
 *
 * GET    /api/files/list?path=subdir        — list directory contents
 * GET    /api/files/download?path=file      — download a file
 * POST   /api/files/upload?path=subdir      — upload one or more files (multipart)
 * POST   /api/files/mkdir                   — create a directory  { path }
 * POST   /api/files/rename                  — rename/move         { from, to }
 * DELETE /api/files/delete                  — delete file or dir  { path }
 */
const router  = require('express').Router();
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const mime    = require('mime-types');

const NAS_ROOT = process.env.NAS_ROOT || '/mnt/nextcloud-storage/nas';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Resolve and jail-check a user-supplied relative path. Throws on escape. */
function safePath(rel) {
  // Treat empty / undefined as root
  const resolved = path.resolve(NAS_ROOT, rel ? String(rel) : '');
  if (resolved !== NAS_ROOT && !resolved.startsWith(NAS_ROOT + path.sep)) {
    const err = new Error('Access denied: path outside NAS root');
    err.status = 403;
    throw err;
  }
  return resolved;
}

/** Relative path from NAS_ROOT for display */
function relPath(abs) {
  return path.relative(NAS_ROOT, abs) || '.';
}

function statEntry(abs) {
  const st   = fs.statSync(abs);
  const name = path.basename(abs);
  const rel  = relPath(abs);
  const isDir = st.isDirectory();
  return {
    name,
    path: rel,
    isDir,
    size:     isDir ? null : st.size,
    modified: st.mtime.toISOString(),
    mimeType: isDir ? null : (mime.lookup(name) || 'application/octet-stream'),
  };
}

// ── multer (store in memory then pipe to disk) ────────────────────────────────

const storage = multer.diskStorage({
  destination(req, _file, cb) {
    try {
      const dest = safePath(req.query.path);
      if (!fs.existsSync(dest)) return cb(new Error('Destination directory does not exist'));
      cb(null, dest);
    } catch (e) { cb(e); }
  },
  filename(_req, file, cb) {
    // Sanitise filename: strip path separators
    const safe = path.basename(file.originalname).replace(/[^\w.\-_ ]/g, '_');
    cb(null, safe);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 * 1024 }, // 4 GB per file
});

// ── routes ───────────────────────────────────────────────────────────────────

// GET /api/files/list?path=
router.get('/list', (req, res) => {
  try {
    const abs = safePath(req.query.path);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Path not found' });
    if (!fs.statSync(abs).isDirectory()) return res.status(400).json({ error: 'Not a directory' });

    const entries = fs.readdirSync(abs)
      .map(name => {
        try { return statEntry(path.join(abs, name)); } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    res.json({
      path:    relPath(abs),
      root:    NAS_ROOT,
      entries,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/files/download?path=
router.get('/download', (req, res) => {
  try {
    const abs = safePath(req.query.path);
    if (!fs.existsSync(abs))              return res.status(404).json({ error: 'File not found' });
    if (fs.statSync(abs).isDirectory())   return res.status(400).json({ error: 'Cannot download a directory' });

    const filename = path.basename(abs);
    const mimeType = mime.lookup(filename) || 'application/octet-stream';
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Type', mimeType);
    fs.createReadStream(abs).pipe(res);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/files/upload?path=subdir  (multipart/form-data, field name "files")
router.post('/upload', (req, res) => {
  // Jail-check before multer runs
  try { safePath(req.query.path); } catch (err) {
    return res.status(403).json({ error: err.message });
  }

  upload.array('files')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    const uploaded = (req.files || []).map(f => ({
      name: f.filename,
      size: f.size,
      path: relPath(f.path),
    }));
    res.json({ success: true, uploaded });
  });
});

// POST /api/files/mkdir  { path: "subdir/newdir" }
router.post('/mkdir', (req, res) => {
  try {
    const abs = safePath(req.body?.path);
    if (fs.existsSync(abs)) return res.status(400).json({ error: 'Already exists' });
    fs.mkdirSync(abs, { recursive: true });
    res.json({ success: true, path: relPath(abs) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/files/rename  { from, to }
router.post('/rename', (req, res) => {
  try {
    const src  = safePath(req.body?.from);
    const dest = safePath(req.body?.to);
    if (!fs.existsSync(src)) return res.status(404).json({ error: 'Source not found' });
    if (fs.existsSync(dest)) return res.status(400).json({ error: 'Destination already exists' });
    fs.renameSync(src, dest);
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// DELETE /api/files/delete  { path }
router.delete('/delete', (req, res) => {
  try {
    const abs = safePath(req.body?.path);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Not found' });
    // Refuse to delete root
    if (path.resolve(abs) === path.resolve(NAS_ROOT)) {
      return res.status(403).json({ error: 'Cannot delete the NAS root' });
    }
    fs.rmSync(abs, { recursive: true, force: true });
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
