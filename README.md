# Le 47 — Raison d'Être Évolutive

Nuage de causes collaboratif pour le lieu autogéré Le 47.

## Structure

```
le47-render/
├── server.js        # Serveur Express + API PostgreSQL
├── package.json     # Dépendances Node.js
├── index.html       # Interface web (frontend)
└── README.md
```

## Déploiement sur Render.com

### 1. Pousse le projet sur GitHub

```bash
cd le47-render
git init
git add .
git commit -m "Le 47 — première version"
git remote add origin https://github.com/TON-PSEUDO/le47-raison-detre.git
git push -u origin main
```

### 2. Crée la base PostgreSQL sur Render

1. Va sur https://dashboard.render.com
2. Clique **"New +"** → **"PostgreSQL"**
3. Nom : `le47-db`
4. Plan : **Free** (gratuit 90 jours)
5. Clique **"Create Database"**
6. Sur la page de la base, copie l'**Internal Database URL** (commence par `postgres://`)

### 3. Déploie le serveur Node.js

1. Clique **"New +"** → **"Web Service"**
2. Connecte ton repo GitHub `le47-raison-detre`
3. Configure :
   - **Name** : `le47`
   - **Runtime** : `Node`
   - **Build Command** : `npm install`
   - **Start Command** : `node server.js`
   - **Plan** : Free
4. Dans **"Environment Variables"**, ajoute :
   - Clé : `DATABASE_URL`
   - Valeur : colle l'**Internal Database URL** copiée à l'étape 2
5. Clique **"Deploy"**

En 2-3 minutes, ton site est en ligne sur `https://le47.onrender.com` (ou le nom que tu as choisi).

### 4. (Optionnel) Nom de domaine personnalisé

Dans les settings du Web Service → **"Custom Domain"** → ajoute ton domaine et configure le DNS.

## Développement local

### Prérequis
- Node.js 18+
- PostgreSQL installé localement (ou utilise un service cloud)

### Lancer

```bash
# Installe les dépendances
npm install

# Configure la connexion à la base locale
export DATABASE_URL=postgres://user:password@localhost:5432/le47

# Lance le serveur
npm start
```

Ouvre http://localhost:3000

## API

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/contributions` | Liste toutes les contributions |
| POST | `/api/contributions` | Ajoute une contribution |
| DELETE | `/api/contributions/last` | Supprime la dernière contribution |
| POST | `/api/import/merge` | Import — ajoute sans écraser |
| POST | `/api/import/replace` | Import — remplace tout |

## Notes

- La table `contributions` est créée automatiquement au premier lancement
- Les causes sont stockées en JSONB (PostgreSQL)
- Le tier gratuit de Render met le service en veille après 15 min d'inactivité (redémarrage en ~30s)
- La base PostgreSQL gratuite est supprimée après 90 jours — exporte tes données régulièrement via le bouton JSON !
