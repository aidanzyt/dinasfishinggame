// ── Session ──────────────────────────────────────────────────────────────────

const myName = sessionStorage.getItem('dfg_name');
const myRoom = sessionStorage.getItem('dfg_room');

if (!myName || !myRoom) {
  window.location.href = '/';
}

document.getElementById('roomLabel').textContent = myRoom;

// ── State ─────────────────────────────────────────────────────────────────────

let myId = sessionStorage.getItem('dfg_id');
let myHand = [];
let gameState = null;

// ── Socket ────────────────────────────────────────────────────────────────────

const socket = io();

socket.on('connect', () => {
  // Re-join on reconnect
  socket.emit('joinRoom', { name: myName, roomId: myRoom });
});

socket.on('joined', ({ playerId }) => {
  myId = playerId;
  sessionStorage.setItem('dfg_id', playerId);
});

socket.on('gameState', (state) => {
  gameState = state;
  render();
});

socket.on('yourHand', (hand) => {
  myHand = hand;
  renderHand();
  renderAskPanel();
});

socket.on('error', (msg) => {
  showToast(msg, true);
});

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  if (!gameState) return;

  if (gameState.phase === 'lobby') {
    showLobby();
  } else {
    showGame();
    renderPlayers();
    renderPond();
    renderLog();
    renderAskPanel();
    renderHand();
    // Show ruleset badge in topbar
    const badge = document.getElementById('rulesetBadge');
    if (gameState.ruleset) {
      badge.textContent = gameState.ruleset === 'dinas' ? "Dina's Rules ✨" : 'Classic Rules';
      badge.className = 'ruleset-badge' + (gameState.ruleset === 'dinas' ? ' ruleset-badge-dinas' : '');
      badge.style.display = '';
    }
    if (gameState.phase === 'ended' && gameState.winner) {
      showWinner(gameState.winner);
    } else {
      document.getElementById('winnerOverlay').style.display = 'none';
    }
  }
}

function showLobby() {
  document.getElementById('lobbyArea').style.display = '';
  document.getElementById('gameArea').style.display = 'none';
  const list = document.getElementById('playerList');
  list.innerHTML = '';
  if (gameState && gameState.players) {
    for (const p of gameState.players) {
      const div = document.createElement('div');
      div.className = 'player-chip';
      div.textContent = p.name + (p.id === myId ? ' (you)' : '');
      list.appendChild(div);
    }
  }
}

function showGame() {
  document.getElementById('lobbyArea').style.display = 'none';
  document.getElementById('gameArea').style.display = '';
}

function renderPlayers() {
  if (!gameState) return;
  const list = document.getElementById('opponentList');
  list.innerHTML = '';

  for (const p of gameState.players) {
    const isCurrent = p.id === gameState.currentTurnId;
    const isMe = p.id === myId;
    const div = document.createElement('div');
    div.className = 'player-row' + (isCurrent ? ' active-turn' : '') + (p.out ? ' out' : '');
    div.innerHTML = `
      <div class="player-name">${isMe ? '👤 ' : ''}${p.name}${p.out ? ' 🚫' : ''}</div>
      <div class="player-meta">
        <span class="card-count">${p.handSize} card${p.handSize !== 1 ? 's' : ''}</span>
        <span class="book-count">${p.books.length} 📚</span>
      </div>
      ${p.books.length ? `<div class="player-books">${p.books.map(r => bookChip(r)).join('')}</div>` : ''}
    `;
    list.appendChild(div);
  }
}

function renderPond() {
  if (!gameState) return;
  document.getElementById('pondCount').textContent = gameState.pondSize;
}

function renderLog() {
  if (!gameState) return;
  const el = document.getElementById('logList');
  el.innerHTML = gameState.log.map(l => `<div class="log-entry">${l}</div>`).join('');
}

function renderHand() {
  const el = document.getElementById('yourHand');
  el.innerHTML = '';

  if (!myHand || myHand.length === 0) {
    el.innerHTML = '<div class="empty-hand">No cards</div>';
  } else {
    for (const card of myHand) {
      const div = document.createElement('div');
      const isRed = card.suit === '♥' || card.suit === '♦';
      div.className = 'card' + (isRed ? ' red' : '');
      div.innerHTML = `<span class="card-rank">${card.rank}</span><span class="card-suit">${card.suit}</span>`;
      el.appendChild(div);
    }
  }

  // Your books
  const me = gameState && gameState.players.find(p => p.id === myId);
  const booksEl = document.getElementById('yourBooks');
  if (me && me.books.length) {
    booksEl.innerHTML = me.books.map(r => bookChip(r)).join('');
  } else {
    booksEl.innerHTML = '<span class="empty-hint">None yet</span>';
  }
}

function renderAskPanel() {
  const askPanel = document.getElementById('askPanel');
  const waitPanel = document.getElementById('waitPanel');
  const waitMsg = document.getElementById('waitMsg');

  if (!gameState || gameState.phase !== 'playing') {
    askPanel.style.display = 'none';
    waitPanel.style.display = 'none';
    return;
  }

  const isMyTurn = gameState.currentTurnId === myId;

  if (isMyTurn) {
    askPanel.style.display = '';
    waitPanel.style.display = 'none';
    populateAskSelects();
  } else {
    askPanel.style.display = 'none';
    waitPanel.style.display = '';
    const currentPlayer = gameState.players.find(p => p.id === gameState.currentTurnId);
    waitMsg.textContent = currentPlayer ? `It's ${currentPlayer.name}'s turn…` : 'Waiting…';
  }
}

function populateAskSelects() {
  const targetSelect = document.getElementById('targetSelect');
  const rankSelect = document.getElementById('rankSelect');

  // Targets: other active players
  const prevTarget = targetSelect.value;
  targetSelect.innerHTML = '';
  if (gameState) {
    for (const p of gameState.players) {
      if (p.id !== myId && !p.out) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        targetSelect.appendChild(opt);
      }
    }
    if (prevTarget) targetSelect.value = prevTarget;
  }

  // Ranks: only ranks the player holds
  const prevRank = rankSelect.value;
  rankSelect.innerHTML = '';
  const rankOrder = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const heldRanks = [...new Set(myHand.map(c => c.rank))].sort((a, b) => rankOrder.indexOf(a) - rankOrder.indexOf(b));
  for (const rank of heldRanks) {
    const opt = document.createElement('option');
    opt.value = rank;
    opt.textContent = rank;
    rankSelect.appendChild(opt);
  }
  if (prevRank && heldRanks.includes(prevRank)) rankSelect.value = prevRank;
}

function bookChip(rank) {
  return `<span class="book-chip">${rank}</span>`;
}

function showWinner(winner) {
  const overlay = document.getElementById('winnerOverlay');
  const title = document.getElementById('winnerTitle');
  const desc = document.getElementById('winnerDesc');
  title.textContent = winner.id === myId ? '🎉 You won!' : `${winner.name} wins!`;
  desc.textContent = `${winner.name} finished with ${winner.books} book${winner.books !== 1 ? 's' : ''}.`;
  overlay.style.display = 'flex';
}

// ── Button handlers ───────────────────────────────────────────────────────────

document.getElementById('startBtn').addEventListener('click', () => {
  const errEl = document.getElementById('startError');
  errEl.style.display = 'none';
  const ruleset = document.querySelector('input[name="lobbyRuleset"]:checked').value;
  socket.emit('startGame', { roomId: myRoom, ruleset });
});

// Lobby ruleset toggle description
const lobbyRulesetDesc = document.getElementById('lobbyRulesetDesc');
const rulesetDescriptions = {
  classic: 'Getting cards from a player earns you another turn.',
  dinas: 'Getting cards from a player ends your turn — no bonus go.',
};
document.querySelectorAll('input[name="lobbyRuleset"]').forEach(radio => {
  radio.addEventListener('change', () => {
    lobbyRulesetDesc.textContent = rulesetDescriptions[radio.value];
  });
});

document.getElementById('askBtn').addEventListener('click', () => {
  const targetId = document.getElementById('targetSelect').value;
  const rank = document.getElementById('rankSelect').value;
  if (!targetId || !rank) return;
  socket.emit('askForCards', { roomId: myRoom, targetId, rank });
});

document.getElementById('playAgainBtn').addEventListener('click', () => {
  socket.emit('playAgain', { roomId: myRoom });
  document.getElementById('winnerOverlay').style.display = 'none';
});

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg, isError = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' toast-error' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('toast-show'), 10);
  setTimeout(() => {
    t.classList.remove('toast-show');
    setTimeout(() => t.remove(), 300);
  }, 3000);
}
