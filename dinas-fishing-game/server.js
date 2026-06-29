const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ── Game state ──────────────────────────────────────────────────────────────

const rooms = {}; // roomId → RoomState

function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ suit, rank });
    }
  }
  return shuffle(deck);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dealGame(players) {
  const deck = createDeck();
  const handSize = players.length > 4 ? 5 : 7;
  const hands = {};
  for (const p of players) {
    hands[p.id] = deck.splice(0, handSize);
  }
  return { hands, pond: deck };
}

function checkBooks(hand) {
  const groups = {};
  for (const card of hand) {
    if (!groups[card.rank]) groups[card.rank] = [];
    groups[card.rank].push(card);
  }
  const books = [];
  const remaining = [];
  for (const card of hand) {
    if (groups[card.rank] && groups[card.rank].length === 4) {
      if (!books.includes(card.rank)) books.push(card.rank);
    } else if (!groups[card.rank] || groups[card.rank].length !== 4) {
      remaining.push(card);
    }
  }
  // rebuild remaining without booked ranks
  const bookedRanks = new Set(books);
  const newHand = hand.filter(c => !bookedRanks.has(c.rank));
  return { books, newHand };
}

function getPublicState(room) {
  const players = room.players.map(p => ({
    id: p.id,
    name: p.name,
    handSize: (room.hands[p.id] || []).length,
    books: room.books[p.id] || [],
    out: room.out[p.id] || false,
  }));
  return {
    players,
    pondSize: room.pond.length,
    currentTurnId: room.currentTurnId,
    phase: room.phase,
    log: room.log,
    winner: room.winner || null,
    ruleset: room.ruleset,
  };
}

function nextTurn(room) {
  const active = room.players.filter(p => !room.out[p.id]);
  if (active.length <= 1) {
    endGame(room);
    return;
  }
  const idx = active.findIndex(p => p.id === room.currentTurnId);
  const next = active[(idx + 1) % active.length];
  room.currentTurnId = next.id;
  room.pendingAsk = null;
}

function endGame(room) {
  room.phase = 'ended';
  let winner = null;
  let max = -1;
  for (const p of room.players) {
    const count = (room.books[p.id] || []).length;
    if (count > max) { max = count; winner = p; }
  }
  room.winner = { id: winner.id, name: winner.name, books: max };
  addLog(room, `🏆 Game over! ${winner.name} wins with ${max} book${max !== 1 ? 's' : ''}!`);
  io.to(room.id).emit('gameState', getPublicState(room));
  for (const p of room.players) {
    io.to(p.id).emit('yourHand', room.hands[p.id] || []);
  }
}

function addLog(room, msg) {
  room.log.unshift(msg);
  if (room.log.length > 40) room.log.length = 40;
}

function processBooks(room, playerId) {
  const { books, newHand } = checkBooks(room.hands[playerId]);
  if (books.length) {
    room.books[playerId] = [...(room.books[playerId] || []), ...books];
    room.hands[playerId] = newHand;
    const p = room.players.find(x => x.id === playerId);
    for (const b of books) {
      addLog(room, `📚 ${p.name} completed a book of ${b}s!`);
    }
  }
}

// ── Socket handlers ──────────────────────────────────────────────────────────

io.on('connection', (socket) => {

  socket.on('joinRoom', ({ name, roomId }) => {
    if (!name || !roomId) return;

    if (!rooms[roomId]) {
      rooms[roomId] = {
        id: roomId,
        players: [],
        hands: {},
        books: {},
        out: {},
        pond: [],
        currentTurnId: null,
        phase: 'lobby', // lobby | playing | ended
        log: [],
        pendingAsk: null,
        ruleset: 'classic', // classic | dinas
      };
    }

    const room = rooms[roomId];

    // Reconnect check
    const existing = room.players.find(p => p.name === name);
    if (existing) {
      existing.id = socket.id;
      socket.join(roomId);
      socket.emit('joined', { playerId: socket.id, roomId, name });
      socket.emit('yourHand', room.hands[socket.id] || room.hands[existing.id] || []);
      // re-key hands/books/out to new socket id
      if (room.hands[existing.id] !== undefined) {
        room.hands[socket.id] = room.hands[existing.id];
        delete room.hands[existing.id];
      }
      if (room.books[existing.id] !== undefined) {
        room.books[socket.id] = room.books[existing.id];
        delete room.books[existing.id];
      }
      if (room.out[existing.id] !== undefined) {
        room.out[socket.id] = room.out[existing.id];
        delete room.out[existing.id];
      }
      if (room.currentTurnId === existing.id) room.currentTurnId = socket.id;
      io.to(roomId).emit('gameState', getPublicState(room));
      return;
    }

    if (room.phase !== 'lobby') {
      socket.emit('error', 'Game already in progress.');
      return;
    }
    if (room.players.length >= 6) {
      socket.emit('error', 'Room is full (max 6 players).');
      return;
    }

    room.players.push({ id: socket.id, name });
    room.books[socket.id] = [];
    socket.join(roomId);

    socket.emit('joined', { playerId: socket.id, roomId, name });
    addLog(room, `🎣 ${name} joined the room.`);
    io.to(roomId).emit('gameState', getPublicState(room));
  });

  socket.on('startGame', ({ roomId, ruleset }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.players.length < 2) {
      socket.emit('error', 'Need at least 2 players to start.');
      return;
    }
    if (room.phase !== 'lobby') return;

    room.ruleset = (ruleset === 'dinas') ? 'dinas' : 'classic';

    const { hands, pond } = dealGame(room.players);
    room.hands = hands;
    room.pond = pond;
    room.out = {};
    room.books = {};
    room.log = [];
    for (const p of room.players) room.books[p.id] = [];

    room.phase = 'playing';
    room.currentTurnId = room.players[0].id;

    // Check initial books
    for (const p of room.players) processBooks(room, p.id);

    addLog(room, `🃏 Game started! ${room.players.map(p => p.name).join(', ')} are playing.`);
    addLog(room, `📜 Ruleset: ${room.ruleset === 'dinas' ? "Dina's Rules" : 'Classic'}.`);
    addLog(room, `🎣 ${room.players[0].name}'s turn.`);

    io.to(roomId).emit('gameState', getPublicState(room));
    for (const p of room.players) {
      io.to(p.id).emit('yourHand', room.hands[p.id] || []);
    }
  });

  socket.on('askForCards', ({ roomId, targetId, rank }) => {
    const room = rooms[roomId];
    if (!room || room.phase !== 'playing') return;
    if (room.currentTurnId !== socket.id) {
      socket.emit('error', 'Not your turn.');
      return;
    }

    const asker = room.players.find(p => p.id === socket.id);
    const target = room.players.find(p => p.id === targetId);
    if (!asker || !target || target.id === asker.id) return;

    // Must hold at least one card of that rank
    const myHand = room.hands[socket.id] || [];
    if (!myHand.some(c => c.rank === rank)) {
      socket.emit('error', `You need at least one ${rank} to ask for it.`);
      return;
    }

    const targetHand = room.hands[targetId] || [];
    const given = targetHand.filter(c => c.rank === rank);

    if (given.length > 0) {
      // Transfer cards
      room.hands[targetId] = targetHand.filter(c => c.rank !== rank);
      room.hands[socket.id] = [...myHand, ...given];
      addLog(room, `✅ ${asker.name} asked ${target.name} for ${rank}s — got ${given.length} card${given.length > 1 ? 's' : ''}!`);

      processBooks(room, socket.id);

      // Check if target is now out of cards
      if (room.hands[targetId].length === 0) {
        if (room.pond.length > 0) {
          const drawn = room.pond.splice(0, 1);
          room.hands[targetId] = drawn;
          addLog(room, `🎣 ${target.name} has no cards left — drew 1 from the pond.`);
          processBooks(room, targetId);
        } else {
          room.out[targetId] = true;
          addLog(room, `🚫 ${target.name} is out (no cards, empty pond).`);
        }
      }

      // Classic: asker gets another turn. Dina's Rules: turn ends.
      if (room.ruleset === 'dinas') {
        addLog(room, `✅ ${asker.name} got the cards — turn ends (Dina's Rules).`);
        nextTurn(room);
        const nextPlayer = room.players.find(p => p.id === room.currentTurnId);
        if (nextPlayer) addLog(room, `🎣 ${nextPlayer.name}'s turn.`);
      } else {
        addLog(room, `🎣 ${asker.name} goes again!`);
      }
      io.to(roomId).emit('gameState', getPublicState(room));
      for (const p of room.players) io.to(p.id).emit('yourHand', room.hands[p.id] || []);

      // Check if game over
      const active = room.players.filter(p => !room.out[p.id]);
      const allHandsEmpty = active.every(p => (room.hands[p.id] || []).length === 0);
      if (room.pond.length === 0 && allHandsEmpty) { endGame(room); return; }

      // If asker's hand now empty after books, draw or go out
      if ((room.hands[socket.id] || []).length === 0) {
        // Only relevant if it's still the asker's turn (classic rules)
        if (room.currentTurnId === socket.id) {
          if (room.pond.length > 0) {
            const drawn = room.pond.splice(0, 1);
            room.hands[socket.id] = drawn;
            addLog(room, `🎣 ${asker.name} has no cards left — drew 1 from the pond.`);
            io.to(socket.id).emit('yourHand', room.hands[socket.id]);
          } else {
            room.out[socket.id] = true;
            addLog(room, `🚫 ${asker.name} is out (no cards, empty pond).`);
            nextTurn(room);
          }
          io.to(roomId).emit('gameState', getPublicState(room));
        }
        return;
      }

    } else {
      // Go Fish
      addLog(room, `🐟 ${asker.name} asked ${target.name} for ${rank}s — GO FISH!`);
      if (room.pond.length > 0) {
        const drawn = room.pond.splice(0, 1);
        room.hands[socket.id] = [...myHand, ...drawn];
        addLog(room, `🎣 ${asker.name} drew a card from the pond.`);
        processBooks(room, socket.id);
        io.to(socket.id).emit('yourHand', room.hands[socket.id]);
      } else {
        addLog(room, `🏜️ The pond is empty!`);
        if ((room.hands[socket.id] || []).length === 0) {
          room.out[socket.id] = true;
          addLog(room, `🚫 ${asker.name} is out (no cards, empty pond).`);
        }
      }
      nextTurn(room);
      const nextPlayer = room.players.find(p => p.id === room.currentTurnId);
      if (nextPlayer) addLog(room, `🎣 ${nextPlayer.name}'s turn.`);
      io.to(roomId).emit('gameState', getPublicState(room));
      for (const p of room.players) io.to(p.id).emit('yourHand', room.hands[p.id] || []);
    }

    // Final game-over check
    const active = room.players.filter(p => !room.out[p.id]);
    if (active.length <= 1) endGame(room);
    else {
      const allDone = active.every(p => (room.hands[p.id] || []).length === 0) && room.pond.length === 0;
      if (allDone) endGame(room);
    }
  });

  socket.on('playAgain', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    room.phase = 'lobby';
    room.hands = {};
    room.books = {};
    room.out = {};
    room.pond = [];
    room.log = [];
    room.currentTurnId = null;
    room.winner = null;
    for (const p of room.players) room.books[p.id] = [];
    addLog(room, '🔄 Room reset. Ready to play again!');
    io.to(roomId).emit('gameState', getPublicState(room));
    for (const p of room.players) io.to(p.id).emit('yourHand', []);
  });

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const p = room.players.find(x => x.id === socket.id);
      if (p) {
        addLog(room, `⚠️ ${p.name} disconnected.`);
        io.to(roomId).emit('gameState', getPublicState(room));
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Dina's Fishing Game running on http://localhost:${PORT}`));
