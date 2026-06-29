// ── Session ───────────────────────────────────────────────────────────────────
const myName = sessionStorage.getItem('dfg_name');
const myRoom = sessionStorage.getItem('dfg_room');
if (!myName || !myRoom) window.location.href = '/';

// ── State ─────────────────────────────────────────────────────────────────────
let myId = sessionStorage.getItem('dfg_id');
let myHand = [];
let gameState = null;

// ── Socket ────────────────────────────────────────────────────────────────────
const socket = io();

socket.on('connect', () => {
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
    return;
  }
  showGame();
  renderOpponents();
  renderPond();
  renderAskPanel();
  renderHand();

  const badge = document.getElementById('rulesetBadge');
  if (gameState.ruleset) {
    badge.textContent = gameState.ruleset === 'dinas' ? "Dina's Rules ✨" : 'Classic';
    badge.className = 'ruleset-badge' + (gameState.ruleset === 'dinas' ? ' ruleset-badge-dinas' : '');
    badge.style.display = '';
  }

  if (gameState.phase === 'ended' && gameState.winner) {
    showWinner(gameState.winner);
  } else {
    document.getElementById('winnerOverlay').style.display = 'none';
  }
}

function showLobby() {
  document.getElementById('lobbyArea').style.display = 'flex';
  document.getElementById('gameArea').style.display = 'none';
  document.getElementById('roomLabel').textContent = myRoom;
  const list = document.getElementById('playerList');
  list.innerHTML = '';
  if (gameState && gameState.players) {
    for (const p of gameState.players) {
      const div = document.createElement('div');
      div.className = 'player-chip' + (p.id === myId ? ' me' : '');
      div.textContent = p.name + (p.id === myId ? ' (you)' : '');
      list.appendChild(div);
    }
  }
}

function showGame() {
  document.getElementById('lobbyArea').style.display = 'none';
  document.getElementById('gameArea').style.display = 'flex';
  document.getElementById('yourName').textContent = myName;
}

function renderOpponents() {
  if (!gameState) return;
  const arc = document.getElementById('opponentArc');
  arc.innerHTML = '';
  const others = gameState.players.filter(p => p.id !== myId);
  others.forEach((p, i) => {
    const isCurrent = p.id === gameState.currentTurnId;
    const div = document.createElement('div');
    div.className = 'opponent' + (isCurrent ? ' active' : '') + (p.out ? ' out' : '');

    // Fan of face-down cards
    let facedown = '';
    const count = Math.min(p.handSize, 7);
    for (let c = 0; c < count; c++) {
      const rot = (c - (count - 1) / 2) * 8;
      facedown += `<div class="fd-card" style="transform:rotate(${rot}deg) translateY(${Math.abs(rot) * 0.5}px)"></div>`;
    }

    div.innerHTML = `
      <div class="opp-fan">${facedown}</div>
      <div class="opp-info">
        <div class="opp-name">${p.name}${p.out ? ' 🚫' : ''}</div>
        <div class="opp-stats">
          <span>${p.handSize} cards</span>
          ${p.books.length ? `<span>📚 ${p.books.join(' ')}</span>` : ''}
        </div>
      </div>
      ${isCurrent ? '<div class="turn-dot"></div>' : ''}
    `;
    arc.appendChild(div);
  });
}

function renderPond() {
  if (!gameState) return;
  document.getElementById('pondCount').textContent = gameState.pondSize;
}

function renderHand() {
  const el = document.getElementById('yourHand');
  el.innerHTML = '';

  if (!myHand || myHand.length === 0) {
    el.innerHTML = '<div class="empty-hand">No cards in hand</div>';
    renderBooks();
    return;
  }

  // Sort: group by rank, then by rank order
  const rankOrder = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const sorted = [...myHand].sort((a, b) => {
    const ri = rankOrder.indexOf(a.rank) - rankOrder.indexOf(b.rank);
    if (ri !== 0) return ri;
    return a.suit.localeCompare(b.suit);
  });

  const total = sorted.length;
  sorted.forEach((card, i) => {
    const isRed = card.suit === '♥' || card.suit === '♦';
    const div = document.createElement('div');
    div.className = 'card' + (isRed ? ' red' : '');

    // Fan rotation
    const spread = Math.min(total * 5, 50);
    const rot = total > 1 ? (i / (total - 1) - 0.5) * spread : 0;
    const lift = Math.abs(rot) * 0.4;
    div.style.setProperty('--rot', rot + 'deg');
    div.style.setProperty('--lift', lift + 'px');

    div.innerHTML = `
      <div class="card-tl"><div class="card-rank">${card.rank}</div><div class="card-suit">${card.suit}</div></div>
      <div class="card-center-suit">${card.suit}</div>
      <div class="card-br"><div class="card-rank">${card.rank}</div><div class="card-suit">${card.suit}</div></div>
    `;
    el.appendChild(div);
  });

  renderBooks();
}

function renderBooks() {
  const me = gameState && gameState.players.find(p => p.id === myId);
  const el = document.getElementById('yourBooks');
  if (me && me.books.length) {
    el.innerHTML = me.books.map(r => `<span class="book-chip">${r}</span>`).join('');
  } else {
    el.innerHTML = '';
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
    askPanel.style.display = 'flex';
    waitPanel.style.display = 'none';
    populateAskSelects();
  } else {
    askPanel.style.display = 'none';
    waitPanel.style.display = 'flex';
    const cur = gameState.players.find(p => p.id === gameState.currentTurnId);
    waitMsg.textContent = cur ? `Waiting for ${cur.name}…` : 'Waiting…';
  }
}

function populateAskSelects() {
  const targetSelect = document.getElementById('targetSelect');
  const rankSelect = document.getElementById('rankSelect');

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

  const prevRank = rankSelect.value;
  rankSelect.innerHTML = '';
  const rankOrder = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const heldRanks = [...new Set(myHand.map(c => c.rank))].sort((a,b) => rankOrder.indexOf(a) - rankOrder.indexOf(b));
  for (const rank of heldRanks) {
    const opt = document.createElement('option');
    opt.value = rank;
    opt.textContent = rank;
    rankSelect.appendChild(opt);
  }
  if (prevRank && heldRanks.includes(prevRank)) rankSelect.value = prevRank;
}

// ── Result flash ──────────────────────────────────────────────────────────────
let lastLogLength = 0;

function checkForNewEvents() {
  if (!gameState || !gameState.log) return;
  if (gameState.log.length === lastLogLength) return;

  // The newest entry is at index 0
  const newest = gameState.log[0];
  lastLogLength = gameState.log.length;

  if (!newest) return;

  // Only show flash for events involving me
  if (newest.includes(myName)) {
    if (newest.includes('GO FISH')) {
      showFlash('🐟', 'Go Fish!', 'gofish');
    } else if (newest.includes('got') && newest.includes('card')) {
      showFlash('✅', newest.replace(/^[^ ]+ /, ''), 'success');
    } else if (newest.includes('book')) {
      showFlash('📚', 'Book complete!', 'book');
    } else if (newest.includes('drew a card')) {
      showFlash('🎴', 'Drew a card', 'draw');
    }
  } else if (newest.includes('GO FISH') && newest.includes(myName.split(' ')[0])) {
    showFlash('🐟', 'Go Fish!', 'gofish');
  }
}

function showFlash(icon, msg, type) {
  const flash = document.getElementById('resultFlash');
  document.getElementById('resultIcon').textContent = icon;
  document.getElementById('resultMsg').textContent = msg;
  flash.className = 'result-flash flash-' + type;
  flash.style.display = 'flex';
  // Trigger animation
  flash.classList.remove('flash-in');
  void flash.offsetWidth;
  flash.classList.add('flash-in');
  clearTimeout(flash._timer);
  flash._timer = setTimeout(() => {
    flash.classList.add('flash-out');
    setTimeout(() => { flash.style.display = 'none'; flash.classList.remove('flash-out', 'flash-in'); }, 400);
  }, 1800);
}

function showWinner(winner) {
  document.getElementById('winnerTitle').textContent = winner.id === myId ? '🎉 You won!' : `${winner.name} wins!`;
  document.getElementById('winnerDesc').textContent = `${winner.name} finished with ${winner.books} book${winner.books !== 1 ? 's' : ''}.`;
  document.getElementById('winnerOverlay').style.display = 'flex';
}

// ── Hook into gameState updates for flash ─────────────────────────────────────
const _origGameState = socket.listeners('gameState');
socket.on('gameState', (state) => {
  // called after the main handler sets gameState
  setTimeout(checkForNewEvents, 50);
});

// ── Button handlers ───────────────────────────────────────────────────────────
document.getElementById('startBtn').addEventListener('click', () => {
  document.getElementById('startError').style.display = 'none';
  const ruleset = document.querySelector('input[name="lobbyRuleset"]:checked').value;
  socket.emit('startGame', { roomId: myRoom, ruleset });
});

const lobbyRulesetDesc = document.getElementById('lobbyRulesetDesc');
const rulesetDescriptions = {
  classic: 'Getting cards earns you another turn.',
  dinas: 'Getting cards ends your turn — no bonus go.',
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
