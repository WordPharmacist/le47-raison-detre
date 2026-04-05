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
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
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
      if (e.id && e.pseudo && Array.isArray(e.causes) && e.timestamp) {
        const result = await client.query(
          'INSERT INTO contributions (id, pseudo, causes, timestamp) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
          [e.id, String(e.pseudo).substring(0, 30), JSON.stringify(e.causes.map(c => String(c).substring(0, 30))), e.timestamp]
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
    for (const e of entries) {
      if (e.id && e.pseudo && Array.isArray(e.causes) && e.timestamp) {
        await client.query(
          'INSERT INTO contributions (id, pseudo, causes, timestamp) VALUES ($1, $2, $3, $4)',
          [e.id, String(e.pseudo).substring(0, 30), JSON.stringify(e.causes.map(c => String(c).substring(0, 30))), e.timestamp]
        );
      }
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
