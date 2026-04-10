require('dotenv').config(); // charge .env en local, ignoré sur Render
const express = require('express');
const { Pool } = require('pg');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── PostgreSQL connection ───
// Render sets DATABASE_URL automatically when you link a PostgreSQL instance
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

// ─── Database init ───
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contributions (
      id TEXT PRIMARY KEY,
      pseudo VARCHAR(30) NOT NULL,
      causes JSONB NOT NULL,
      timestamp BIGINT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cause_tags (
      contribution_id TEXT NOT NULL,
      cause_index INTEGER NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (contribution_id, cause_index)
    )
  `);
  const { rows } = await pool.query('SELECT COUNT(*) as c FROM contributions');
  console.log(`  ✦ Base de données prête — ${rows[0].c} contribution(s)`);
}

// ─── Middleware ───
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname)));

// ─── API Routes ───

// GET all contributions
app.get('/api/contributions', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, pseudo, causes, timestamp FROM contributions ORDER BY timestamp ASC');
    const entries = rows.map(r => ({
      id: r.id,
      pseudo: r.pseudo,
      causes: r.causes,
      timestamp: Number(r.timestamp),
    }));
    res.json(entries);
  } catch (e) {
    console.error('GET /api/contributions error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST a new contribution
app.post('/api/contributions', async (req, res) => {
  const { pseudo, causes } = req.body;

  if (!pseudo || !pseudo.trim()) {
    return res.status(400).json({ error: 'Pseudo requis' });
  }
  if (!Array.isArray(causes) || causes.length === 0 || causes.length > 5) {
    return res.status(400).json({ error: 'Entre 1 et 5 causes requises' });
  }
  for (const c of causes) {
    if (typeof c !== 'string' || c.trim().length < 2 || c.length > 30) {
      return res.status(400).json({ error: 'Chaque cause doit faire entre 2 et 30 caractères' });
    }
    if (c.trim().split(/\s+/).length > 3) {
      return res.status(400).json({ error: 'Chaque cause doit contenir maximum 3 mots' });
    }
  }

  const id = crypto.randomUUID();
  const timestamp = Date.now();
  const cleanPseudo = pseudo.trim().substring(0, 30);
  const cleanCauses = causes.map(c => c.trim().substring(0, 30));

  try {
    await pool.query(
      'INSERT INTO contributions (id, pseudo, causes, timestamp) VALUES ($1, $2, $3, $4)',
      [id, cleanPseudo, JSON.stringify(cleanCauses), timestamp]
    );
    res.status(201).json({ id, pseudo: cleanPseudo, causes: cleanCauses, timestamp });
  } catch (e) {
    console.error('POST /api/contributions error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE the last contribution (for edit feature)
app.delete('/api/contributions/last', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id FROM contributions ORDER BY timestamp DESC LIMIT 1');
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Aucune contribution à supprimer' });
    }
    await pool.query('DELETE FROM contributions WHERE id = $1', [rows[0].id]);
    res.json({ deleted: rows[0].id });
  } catch (e) {
    console.error('DELETE /api/contributions/last error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST import (merge)
app.post('/api/import/merge', async (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries)) {
    return res.status(400).json({ error: 'Format invalide' });
  }

  const client = await pool.connect();
  let added = 0;
  try {
    await client.query('BEGIN');
    for (const e of entries) {
      const causes = Array.isArray(e.causes) ? e.causes
        : (typeof e.causes === 'string' ? JSON.parse(e.causes) : null);
      if (e.id && e.pseudo && Array.isArray(causes) && e.timestamp) {
        const result = await client.query(
          'INSERT INTO contributions (id, pseudo, causes, timestamp) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
          [e.id, String(e.pseudo).substring(0, 30), JSON.stringify(causes.map(c => String(c).substring(0, 30))), Number(e.timestamp)]
        );
        if (result.rowCount > 0) added++;
      }
    }
    await client.query('COMMIT');
    const { rows } = await client.query('SELECT COUNT(*) as c FROM contributions');
    res.json({ added, total: Number(rows[0].c) });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('POST /api/import/merge error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// POST import (replace)
app.post('/api/import/replace', async (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'Format invalide ou vide' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM contributions');
    let inserted = 0;
    for (const e of entries) {
      const causes = Array.isArray(e.causes) ? e.causes
        : (typeof e.causes === 'string' ? JSON.parse(e.causes) : null);
      if (e.id && e.pseudo && Array.isArray(causes) && e.timestamp) {
        await client.query(
          'INSERT INTO contributions (id, pseudo, causes, timestamp) VALUES ($1, $2, $3, $4)',
          [e.id, String(e.pseudo).substring(0, 30), JSON.stringify(causes.map(c => String(c).substring(0, 30))), Number(e.timestamp)]
        );
        inserted++;
      }
    }
    if (inserted === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Aucune entrée valide dans le fichier importé' });
    }
    await client.query('COMMIT');
    const { rows } = await client.query('SELECT COUNT(*) as c FROM contributions');
    res.json({ replaced: true, total: Number(rows[0].c) });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('POST /api/import/replace error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// ─── DELETE all contributions ───
app.delete('/api/contributions/all', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM contributions');
    res.json({ deleted: rowCount });
  } catch (e) {
    console.error('DELETE /api/contributions/all error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── GET all individual causes with their tags ───
app.get('/api/causes', async (req, res) => {
  try {
    const { rows: contribs } = await pool.query(
      'SELECT id, pseudo, causes, timestamp FROM contributions ORDER BY timestamp DESC'
    );
    const { rows: tagRows } = await pool.query(
      'SELECT contribution_id, cause_index, tag FROM cause_tags'
    );
    const tagMap = {};
    tagRows.forEach(r => { tagMap[`${r.contribution_id}-${r.cause_index}`] = r.tag; });
    const causes = [];
    contribs.forEach(c => {
      c.causes.forEach((cause, idx) => {
        causes.push({
          contributionId: c.id,
          causeIndex: idx,
          pseudo: c.pseudo,
          cause: cause,
          timestamp: Number(c.timestamp),
          tag: tagMap[`${c.id}-${idx}`] || null,
        });
      });
    });
    res.json(causes);
  } catch (e) {
    console.error('GET /api/causes error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── GET all tags ───
app.get('/api/tags', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT DISTINCT tag FROM cause_tags ORDER BY tag ASC');
    res.json(rows.map(r => r.tag));
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── POST set/remove tag on a cause ───
app.post('/api/causes/tag', async (req, res) => {
  const { contributionId, causeIndex, tag } = req.body;
  if (!contributionId || causeIndex === undefined || causeIndex === null) {
    return res.status(400).json({ error: 'Paramètres manquants' });
  }
  try {
    if (!tag || String(tag).trim() === '') {
      await pool.query(
        'DELETE FROM cause_tags WHERE contribution_id = $1 AND cause_index = $2',
        [contributionId, Number(causeIndex)]
      );
    } else {
      await pool.query(
        'INSERT INTO cause_tags (contribution_id, cause_index, tag) VALUES ($1, $2, $3) ON CONFLICT (contribution_id, cause_index) DO UPDATE SET tag = $3',
        [contributionId, Number(causeIndex), String(tag).trim().substring(0, 50)]
      );
    }
    res.json({ success: true });
  } catch (e) {
    console.error('POST /api/causes/tag error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── Serve the app ───
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Start ───
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`
  ✦ Le 47 — Raison d'Être Évolutive
  ✦ Serveur démarré sur http://localhost:${PORT}
    `);
  });
}).catch(err => {
  console.error('Erreur initialisation DB:', err);
  process.exit(1);
});
