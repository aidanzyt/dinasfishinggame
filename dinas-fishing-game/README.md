# Dina's Fishing Game 🎣

A real-time multiplayer Go Fish game for 2–6 players.

## Setup

### Requirements
- Node.js 16+

### Install & run
```bash
npm install
node server.js
```

The server starts at **http://localhost:3000**

## How to play
1. Both players go to the same URL
2. Enter your name and the **same room name** (e.g. `cozy-dock`)
3. Once everyone has joined, any player can click **Start Game**
4. The game follows standard Go Fish rules — ask any opponent for a rank you hold, collect books of 4, most books wins!

## Deploying to the web (so you can play from anywhere)

### Option A — Railway (free, easiest)
1. Push this folder to a GitHub repo
2. Go to [railway.app](https://railway.app), connect your repo
3. Railway auto-detects Node and deploys — share the URL!

### Option B — Render
1. Push to GitHub
2. Go to [render.com](https://render.com) → New Web Service
3. Set build command: `npm install`, start command: `node server.js`

### Option C — VPS (DigitalOcean, Linode, etc.)
```bash
# On your server
git clone <your-repo>
cd dinas-fishing-game
npm install
# Use PM2 to keep it running
npm install -g pm2
pm2 start server.js --name "fishing-game"
pm2 save
```

## File structure
```
dinas-fishing-game/
├── server.js          ← Node.js + Express + Socket.io backend
└── public/
    ├── index.html     ← Lobby (join with name + room)
    ├── game.html      ← Game table
    ├── game.js        ← Client-side game logic
    └── style.css      ← All styles
```
