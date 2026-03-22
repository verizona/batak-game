const AVATARS = ['👤','😎','🎩','🦊','🐱','🐻','🦁','🐯','🐸','🎭','👑','🤠'];

let socket = null;
let myRoomId = null;
let mySeat = null;
let myName = localStorage.getItem('batak_name') || '';
let myAvatar = parseInt(localStorage.getItem('batak_avatar') || '0');
let pendingAction = null;
let selectedMode = 'ihaleli';
let isVsAI = false;

const screens = {
  home: 'screen-home',
  'mode-select': 'screen-mode-select',
  join: 'screen-join',
  waiting: 'screen-waiting'
};

function showScreen(name, action) {
  Object.values(screens).forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('active'); el.style.display = ''; }
  });
  const target = document.getElementById(screens[name]);
  if (target) { target.style.display = 'flex'; target.classList.add('active'); }

  if (action) pendingAction = action;

  if (name === 'join') {
    document.getElementById('join-name').value = myName;
  }

  if (!myName && name !== 'join') {
    askName(() => showScreen(name, action));
    return;
  }
}

function goBack() {
  showScreen('home');
}

function askName(callback) {
  const name = prompt('Adınız nedir?', myName || '');
  if (name && name.trim()) {
    myName = name.trim().substring(0, 16);
    localStorage.setItem('batak_name', myName);
    if (callback) callback();
  }
}

function selectMode(mode) {
  selectedMode = mode;
  document.querySelectorAll('.mode-card').forEach(el => {
    el.classList.toggle('selected', el.dataset.mode === mode);
  });
  isVsAI = pendingAction === 'ai';

  setTimeout(() => {
    if (!myName) { askName(() => connectAndCreate()); }
    else connectAndCreate();
  }, 200);
}

function connectAndCreate() {
  connectSocket(() => {
    socket.emit('create_room', {
      name: myName,
      avatar: myAvatar,
      mode: selectedMode,
      vsAI: isVsAI
    });
  });
}

function joinRoom() {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!name) { alert('Adınızı girin'); return; }
  if (!code || code.length < 4) { alert('Oda kodunu girin'); return; }
  myName = name.substring(0, 16);
  localStorage.setItem('batak_name', myName);

  connectSocket(() => {
    socket.emit('join_room', { roomId: code, name: myName, avatar: myAvatar });
  });
}

function connectSocket(callback) {
  if (socket && socket.connected) { callback(); return; }
  socket = io();
  socket.on('connect', callback);

  socket.on('room_created', ({ roomId, seat }) => {
    myRoomId = roomId;
    mySeat = seat;
    document.getElementById('display-room-code').textContent = roomId;
    showScreen('waiting');
    if (isVsAI) {
      document.getElementById('start-btn-area').style.display = 'block';
      document.getElementById('wait-msg').style.display = 'none';
    } else {
      document.getElementById('start-btn-area').style.display = 'block';
    }
  });

  socket.on('room_joined', ({ roomId, seat }) => {
    myRoomId = roomId;
    mySeat = seat;
    document.getElementById('display-room-code').textContent = roomId;
    showScreen('waiting');
    document.getElementById('start-btn-area').style.display = 'none';
    document.getElementById('wait-msg').style.display = 'block';
  });

  socket.on('room_state', (state) => {
    renderSeats(state);
    const isHost = state.host === socket.id;
    const full = state.players.filter(p => !p.isAI || isVsAI).length >= 4 || state.players.length >= 4;
    document.getElementById('start-btn-area').style.display = isHost ? 'block' : 'none';
    document.getElementById('wait-msg').style.display = isHost ? 'none' : 'block';
  });

  socket.on('game_started', ({ mode }) => {
    localStorage.setItem('batak_room', myRoomId);
    localStorage.setItem('batak_seat', String(mySeat));
    localStorage.setItem('batak_name', myName);
    localStorage.setItem('batak_avatar', String(myAvatar));
    localStorage.setItem('batak_mode', mode || selectedMode);
    window.location.href = '/game.html';
  });

  socket.on('error', ({ msg }) => alert(msg));
}

function renderSeats(state) {
  const seatNames = ['Kuzey', 'Doğu', 'Güney', 'Batı'];
  const grid = document.getElementById('seats-grid');
  const seatEls = grid.querySelectorAll('.seat');
  seatEls.forEach((el, i) => {
    const player = state.players.find(p => p.seat === i);
    if (player) {
      el.className = 'seat occupied' + (player.seat === mySeat ? ' me' : '');
      el.innerHTML = `<div class="seat-avatar">${AVATARS[player.avatar] || '👤'}</div><div class="seat-name">${player.name}${player.isAI ? ' 🤖' : ''}</div>`;
    } else {
      el.className = 'seat empty';
      el.innerHTML = `<span>${seatNames[i]}</span>`;
    }
  });
}

function startGame() {
  if (!socket) return;
  socket.emit('start_game');
}

function leaveRoom() {
  if (socket) socket.disconnect();
  showScreen('home');
}

// Initial screen
showScreen('home');
