// ============================================================
// Batak Game Client
// ============================================================

const SUIT_SYMBOLS = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
const SUIT_NAMES = { spades: 'Maça', hearts: 'Kupa', diamonds: 'Karo', clubs: 'Sinek' };
const AVATARS = ['👤','😎','🎩','🦊','🐱','🐻','🦁','🐯','🐸','🎭','👑','🤠'];

let socket = null;
let myRoomId = localStorage.getItem('batak_room');
let mySeat = parseInt(localStorage.getItem('batak_seat') || '0');
let myName = localStorage.getItem('batak_name') || 'Oyuncu';

let gameState = null;
let players = [];
let pendingBuryCards = [];
let chatVisible = false;

// Seat layout: local player always at South
// seatIndex -> position: 0=north, 1=east, 2=south, 3=west (relative)
function seatToPosition(seat) {
  const relative = (seat - mySeat + 4) % 4;
  // 0=same=south, 1=left=east, 2=opposite=north, 3=right=west
  const map = { 0: 'south', 1: 'east', 2: 'north', 3: 'west' };
  return map[relative];
}

function positionToSeat(pos) {
  const map = { south: 0, east: 1, north: 2, west: 3 };
  const rel = map[pos];
  return (mySeat + rel) % 4;
}

// ---- Socket Setup ----
function initSocket() {
  socket = io();

  socket.on('connect', () => {
    if (!myRoomId) { window.location.href = '/'; return; }
    socket.emit('rejoin_game', { roomId: myRoomId, seat: mySeat, name: myName });
  });

  socket.on('rejoined', ({ roomId, seat, gameState: gs, mode }) => {
    mySeat = seat;
    gameState = gs;
    document.getElementById('mode-label').textContent = modeLabel(mode || localStorage.getItem('batak_mode') || 'ihaleli');
    if (gs) applyGameState(gs);
    else showStatus('Oyun yükleniyor...');
  });

  socket.on('room_state', (state) => {
    players = state.players;
    if (state.mySeat !== undefined) mySeat = state.mySeat;
    if (state.gameState) gameState = state.gameState;
    renderPlayers();
    if (gameState) applyGameState(gameState);
  });

  socket.on('game_started', ({ mode, round }) => {
    document.getElementById('mode-label').textContent = modeLabel(mode);
    document.getElementById('round-label').textContent = `El 1/4`;
    showStatus('Kartlar dağıtılıyor...');
  });

  socket.on('round_started', ({ round }) => {
    document.getElementById('round-label').textContent = `El ${round}/4`;
    clearTable();
    hideAllPanels();
    showStatus('Yeni el başlıyor...');
  });

  socket.on('bury_prompt', ({ extraCards }) => {
    showBuryPanel(extraCards);
  });

  socket.on('buried', ({ dealer }) => {
    hideBuryPanel();
    showSystemChat(`Dağıtıcı kartları gömdü`);
  });

  socket.on('bidding_started', ({ currentBidder, minBid }) => {
    const isMe = currentBidder === mySeat;
    showBidPanel(minBid, isMe, currentBidder);
    showStatus(isMe ? 'İhale yapın' : `${getPlayerName(currentBidder)} ihale yapıyor...`);
    highlightTurn(currentBidder);
  });

  socket.on('bid_placed', ({ seat, bid }) => {
    const name = getPlayerName(seat);
    showSystemChat(`${name}: ${bid === 'PAS' ? 'PAS' : bid}`);
    if (gameState) {
      if (!gameState.bids) gameState.bids = [null,null,null,null];
      gameState.bids[seat] = bid;
    }
  });

  socket.on('bidding_won', ({ winner, bid }) => {
    hideBidPanel();
    showSystemChat(`${getPlayerName(winner)} ${bid} ile açtı!`);
    showStatus(`${getPlayerName(winner)} koz seçiyor...`);
    if (winner === mySeat) showTrumpPanel();
  });

  socket.on('hediye', () => {
    hideBidPanel();
    showToast('🎁 HEDİYE! Kimse açmadı!');
    showSystemChat('Hediye! Tüm oyuncular pas geçti.');
  });

  socket.on('trump_selected', ({ suit, declarer, leadSeat }) => {
    hideTrumpPanel();
    const suitName = SUIT_NAMES[suit];
    const suitSymbol = SUIT_SYMBOLS[suit];
    showToast(`${suitSymbol} ${suitName} koz seçildi!`);
    showSystemChat(`${getPlayerName(declarer)} koz: ${suitSymbol} ${suitName}`);
    document.getElementById('trump-display').style.display = 'inline';
    document.getElementById('trump-display').textContent = `Koz: ${suitSymbol} ${suitName}`;
    if (gameState) gameState.trump = suit;
  });

  socket.on('card_played', ({ seatIndex, card, trickComplete }) => {
    renderTrickCard(seatIndex, card);
    if (!trickComplete) {
      const nextSeat = (seatIndex + 1) % 4;
      highlightTurn(nextSeat);
      if (nextSeat === mySeat) showStatus('Sıra sizde!');
      else showStatus(`${getPlayerName(nextSeat)} oynuyor...`);
    }
  });

  socket.on('trick_won', ({ winner, tricks, roundOver, scores, delta, made, gameOver }) => {
    highlightTrickWinner(winner);
    showSystemChat(`${getPlayerName(winner)} eli aldı (${tricks[winner]})`);

    setTimeout(() => {
      clearTrickArea();
      if (roundOver) {
        showScorePanel(scores, delta, made, tricks, gameOver);
      } else {
        highlightTurn(winner);
        showStatus(`${getPlayerName(winner)} oynuyor...`);
      }
    }, 1000);

    if (gameState) gameState.tricks = tricks;
    updateTrickCounts(tricks);
  });

  socket.on('playing_started', ({ trump }) => {
    if (trump) {
      document.getElementById('trump-display').style.display = 'inline';
      document.getElementById('trump-display').textContent = `Koz: ${SUIT_SYMBOLS[trump]} ${SUIT_NAMES[trump]}`;
    }
  });

  socket.on('chat_message', ({ name, message, seat }) => {
    addChatMessage(name, message, false);
  });

  socket.on('error', ({ msg }) => {
    showToast(`⚠ ${msg}`, true);
    // If room not found (server restarted), go back to lobby
    if (msg.includes('bulunamadı') || msg.includes('dolu')) {
      localStorage.removeItem('batak_room');
      localStorage.removeItem('batak_seat');
      setTimeout(() => { window.location.href = '/'; }, 2000);
    }
  });
}

// ---- Rendering ----
function renderPlayers() {
  const positions = ['south', 'east', 'north', 'west'];
  positions.forEach(pos => {
    const seat = positionToSeat(pos);
    const player = players.find(p => p.seat === seat);
    document.getElementById(`name-${pos}`).textContent = player ? player.name : '-';
    document.getElementById(`score-${pos}`).textContent = player ? `${player.score} puan` : '';
    document.getElementById(`avatar-${pos}`).textContent = player ? (AVATARS[player.avatar] || '👤') : '?';
  });
}

function applyGameState(state) {
  if (!state) return;

  // Update scores
  ['south','east','north','west'].forEach(pos => {
    const seat = positionToSeat(pos);
    if (state.scores) document.getElementById(`score-${pos}`).textContent = `${state.scores[seat]} puan`;
  });

  // Update trick counts
  if (state.tricks) updateTrickCounts(state.tricks);

  // Update round
  if (state.round) document.getElementById('round-label').textContent = `El ${state.round}/${state.maxRounds}`;

  // Render hand
  if (state.hand) renderHand(state.hand, state);

  // Trump display
  if (state.trump) {
    document.getElementById('trump-display').style.display = 'inline';
    document.getElementById('trump-display').textContent = `Koz: ${SUIT_SYMBOLS[state.trump]} ${SUIT_NAMES[state.trump]}`;
  }

  // Contract display
  if (state.contract) {
    document.getElementById('contract-display').style.display = 'inline';
    document.getElementById('contract-display').textContent = `${getPlayerName(state.declarer)}: ${state.contract}`;
  }

  // Current trick
  if (state.currentTrick) {
    state.currentTrick.forEach(t => renderTrickCard(t.seatIndex, t.card));
  }

  // State-based UI
  if (state.state === 'BIDDING' && state.currentBidder !== undefined) {
    const isMe = state.currentBidder === mySeat;
    showBidPanel(state.highBid, isMe, state.currentBidder);
    highlightTurn(state.currentBidder);
    showStatus(isMe ? 'İhale sırası sizde!' : `${getPlayerName(state.currentBidder)} ihale yapıyor...`);
  } else if (state.state === 'TRUMP_SELECTION') {
    if (state.declarer === mySeat) showTrumpPanel();
    else showStatus(`${getPlayerName(state.declarer)} koz seçiyor...`);
  } else if (state.state === 'BURYING') {
    if (state.dealer === mySeat && state.extraCards?.length) showBuryPanel(state.extraCards);
    else showStatus('Dağıtıcı kartları gömüyor...');
  } else if (state.state === 'PLAYING') {
    const trickLen = state.currentTrick?.length || 0;
    const nextSeat = trickLen === 0 ? state.leadSeat :
      (state.currentTrick[trickLen - 1].seatIndex + 1) % 4;
    if (nextSeat !== undefined) {
      highlightTurn(nextSeat);
      showStatus(nextSeat === mySeat ? 'Sıra sizde!' : `${getPlayerName(nextSeat)} oynuyor...`);
    }
  }
}

function renderHand(cards, state) {
  const container = document.getElementById('cards-south');
  container.innerHTML = '';
  const playable = getPlayableCards(cards, state);

  cards.forEach(card => {
    const isPlayable = playable.includes(card.id);
    const el = createCardEl(card, isPlayable);
    if (isPlayable) el.onclick = () => playCard(card.id);
    container.appendChild(el);
  });

  // Render other players' backs
  ['north','east','west'].forEach(pos => {
    const seat = positionToSeat(pos);
    const count = state.handCounts ? state.handCounts[seat] : 0;
    const container = document.getElementById(`cards-${pos}`);
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const back = document.createElement('div');
      back.className = `card back suit-${pos}`;
      back.innerHTML = '';
      container.appendChild(back);
    }
  });
}

function createCardEl(card, isPlayable = false) {
  const div = document.createElement('div');
  div.className = `card suit-${card.suit}${isPlayable ? ' playable' : ''}`;
  div.dataset.cardId = card.id;
  div.innerHTML = `
    <div class="card-corner-top">
      <div class="card-rank">${card.rank}</div>
      <div class="card-suit-small">${SUIT_SYMBOLS[card.suit]}</div>
    </div>
    <div class="card-center">${SUIT_SYMBOLS[card.suit]}</div>
    <div class="card-corner-bot">
      <div class="card-rank">${card.rank}</div>
      <div class="card-suit-small">${SUIT_SYMBOLS[card.suit]}</div>
    </div>`;
  return div;
}

function renderTrickCard(seatIndex, card) {
  const pos = seatToPosition(seatIndex);
  const slot = document.getElementById(`trick-${pos}-slot`);
  if (!slot) return;
  slot.innerHTML = '';
  const el = createCardEl(card, false);
  el.classList.add('card-deal-anim');
  slot.appendChild(el);
}

function clearTrickArea() {
  ['north','east','south','west'].forEach(pos => {
    const slot = document.getElementById(`trick-${pos}-slot`);
    if (slot) slot.innerHTML = '';
  });
}

function clearTable() {
  clearTrickArea();
  ['south','north','east','west'].forEach(pos => {
    const c = document.getElementById(`cards-${pos}`);
    if (c) c.innerHTML = '';
  });
  document.getElementById('trump-display').style.display = 'none';
  document.getElementById('contract-display').style.display = 'none';
}

function updateTrickCounts(tricks) {
  ['south','north','east','west'].forEach(pos => {
    const seat = positionToSeat(pos);
    const el = document.getElementById(`tricks-${pos}`);
    if (el) el.textContent = tricks[seat] || 0;
  });
}

function highlightTurn(seat) {
  document.querySelectorAll('.player-zone').forEach(el => el.classList.remove('active-turn'));
  const pos = seatToPosition(seat);
  const zone = document.getElementById(`player-${pos}`);
  if (zone) zone.classList.add('active-turn');
}

function highlightTrickWinner(seat) {
  const pos = seatToPosition(seat);
  const slot = document.getElementById(`trick-${pos}-slot`);
  if (slot) slot.classList.add('trick-winner-flash');
  setTimeout(() => { if (slot) slot.classList.remove('trick-winner-flash'); }, 900);
}

// ---- Game Logic ----
function getPlayableCards(hand, state) {
  if (!state || state.state !== 'PLAYING') return [];
  const trickLen = state.currentTrick?.length || 0;
  const nextSeat = trickLen === 0 ? state.leadSeat :
    (state.currentTrick[trickLen - 1].seatIndex + 1) % 4;
  if (nextSeat !== mySeat) return [];

  if (trickLen === 0) return hand.map(c => c.id);

  const ledSuit = state.currentTrick[0].card.suit;
  const haveSuit = hand.filter(c => c.suit === ledSuit);
  return haveSuit.length > 0 ? haveSuit.map(c => c.id) : hand.map(c => c.id);
}

function playCard(cardId) {
  socket.emit('play_card', { cardId });
}

function placeBid(value) {
  socket.emit('place_bid', { value });
  hideBidPanel();
}

function selectTrump(suit) {
  socket.emit('select_trump', { suit });
  hideTrumpPanel();
}

// ---- Panels ----
function showBidPanel(highBid, isMyTurn, currentBidder) {
  const panel = document.getElementById('bid-panel');
  const grid = document.getElementById('bid-grid');
  const pasBtn = document.getElementById('btn-pas');
  document.getElementById('bid-current').textContent =
    highBid >= 8 ? `Güncel ihale: ${highBid}` : 'Açılış: 8';

  grid.innerHTML = '';
  for (let i = 8; i <= 16; i++) {
    const btn = document.createElement('button');
    btn.className = 'bid-btn';
    btn.textContent = i;
    if (!isMyTurn || i <= highBid) btn.disabled = true;
    btn.onclick = () => placeBid(i);
    grid.appendChild(btn);
  }

  pasBtn.disabled = !isMyTurn;
  // Always show panel when it's my turn; hide when AI's turn
  panel.style.display = isMyTurn ? 'flex' : 'none';
}

function hideBidPanel() { document.getElementById('bid-panel').style.display = 'none'; }
function showTrumpPanel() { document.getElementById('trump-panel').style.display = 'flex'; }
function hideTrumpPanel() { document.getElementById('trump-panel').style.display = 'none'; }
function hideBuryPanel() { document.getElementById('bury-panel').style.display = 'none'; }

function showBuryPanel(extraCards) {
  const panel = document.getElementById('bury-panel');
  const container = document.getElementById('bury-cards');
  pendingBuryCards = [];
  container.innerHTML = '';

  // Show hand + extra cards for selection
  const allForBury = [...(gameState?.hand || []), ...extraCards];
  allForBury.forEach(card => {
    const wrap = document.createElement('div');
    wrap.className = 'bury-card-wrap';
    const el = createCardEl(card);
    wrap.appendChild(el);
    wrap.onclick = () => toggleBuryCard(card.id, wrap);
    container.appendChild(wrap);
  });

  panel.style.display = 'flex';
  updateBuryButton();
}

function toggleBuryCard(cardId, el) {
  const idx = pendingBuryCards.indexOf(cardId);
  if (idx >= 0) {
    pendingBuryCards.splice(idx, 1);
    el.classList.remove('selected-bury');
  } else {
    if (pendingBuryCards.length >= 3) return;
    pendingBuryCards.push(cardId);
    el.classList.add('selected-bury');
  }
  updateBuryButton();
}

function updateBuryButton() {
  const btn = document.getElementById('btn-bury-confirm');
  btn.textContent = `Göm (${pendingBuryCards.length}/3)`;
  btn.disabled = pendingBuryCards.length !== 3;
}

function confirmBury() {
  if (pendingBuryCards.length !== 3) return;
  socket.emit('bury_cards', { cardIds: pendingBuryCards });
  hideBuryPanel();
}

function showScorePanel(scores, delta, made, tricks, gameOver) {
  const panel = document.getElementById('score-panel');
  const table = document.getElementById('score-table');
  const title = document.getElementById('score-title');
  const nextBtn = document.getElementById('btn-next-round');

  title.textContent = gameOver ? 'OYUN SONA ERDİ' : 'EL SONUCU';

  table.innerHTML = '';
  players.forEach(player => {
    const i = player.seat;
    const d = delta ? delta[i] : 0;
    const row = document.createElement('div');
    row.className = `score-row${d > 0 ? ' winner' : d < 0 ? ' loser' : ''}`;
    row.innerHTML = `
      <span class="score-player-name">${player.name}</span>
      <span class="score-tricks">${tricks ? tricks[i] : 0} el</span>
      <span class="score-delta ${d >= 0 ? 'pos' : 'neg'}">${d >= 0 ? '+' : ''}${d}</span>
      <span class="score-total">${scores ? scores[i] : 0} pt</span>
    `;
    table.appendChild(row);
  });

  if (gameOver) {
    nextBtn.textContent = 'Ana Menü';
    nextBtn.onclick = () => { window.location.href = '/'; };
  } else {
    nextBtn.textContent = 'Devam';
    nextBtn.onclick = nextRound;
  }

  panel.style.display = 'flex';
}

function hideAllPanels() {
  ['bid-panel','trump-panel','bury-panel','score-panel'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
}

function nextRound() {
  document.getElementById('score-panel').style.display = 'none';
  socket.emit('next_round');
}

// ---- Chat ----
function toggleChat() {
  chatVisible = !chatVisible;
  const panel = document.getElementById('chat-panel');
  panel.style.display = chatVisible ? 'flex' : 'none';
}

function showSystemChat(msg) {
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg system';
  div.textContent = msg;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function addChatMessage(name, message) {
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<span class="chat-msg-name">${name}:</span>${message}`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  socket.emit('send_chat', { message: msg });
  addChatMessage(myName, msg);
  input.value = '';
}

function chatKeydown(e) {
  if (e.key === 'Enter') sendChat();
}

// ---- Utils ----
function showStatus(msg) {
  document.getElementById('status-text').textContent = msg;
}

function showToast(msg, isError = false) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  if (isError) toast.style.borderColor = '#f87171';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function getPlayerName(seat) {
  const p = players.find(pl => pl.seat === seat);
  return p ? p.name : `Oyuncu ${seat + 1}`;
}

function modeLabel(mode) {
  const labels = { goemmeli: 'Gömmeli', ihaleli: 'İhaleli', esli: 'Eşli', ihalesiz: 'İhalesiz' };
  return labels[mode] || mode;
}

function leaveGame() {
  if (confirm('Oyundan çıkmak istediğinize emin misiniz?')) {
    window.location.href = '/';
  }
}

// ---- Init ----
initSocket();
