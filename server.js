const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const { BatakGame, STATES } = require('./game/js/BatakGame');
const { AIPlayer } = require('./game/js/AIPlayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// rooms: Map<roomId, RoomData>
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function getRoomBySocket(socketId) {
  for (const [roomId, room] of rooms) {
    if (room.sockets.has(socketId)) return { roomId, room };
  }
  return null;
}

function broadcastRoom(room) {
  const playerList = [];
  for (const [socketId, player] of room.sockets) {
    playerList.push({
      socketId,
      name: player.name,
      avatar: player.avatar,
      seat: player.seat,
      isAI: player.isAI,
      score: room.game ? room.game.scores[player.seat] : 0
    });
  }
  room.sockets.forEach((player, sid) => {
    const state = room.game ? room.game.getStateForSeat(player.seat) : null;
    io.to(sid).emit('room_state', {
      roomId: room.roomId,
      mode: room.mode,
      players: playerList,
      mySeat: player.seat,
      gameState: state,
      host: room.host
    });
  });
}

function scheduleAI(room) {
  if (!room.game || room.game.state !== STATES.PLAYING) return;

  const currentSeat = room.game.leadSeat;
  const trickLen = room.game.currentTrick.length;
  const nextSeat = trickLen === 0 ? currentSeat :
    (room.game.currentTrick[trickLen - 1].seatIndex + 1) % 4;

  // Find if nextSeat is AI
  let aiPlayer = null;
  for (const [sid, p] of room.sockets) {
    if (p.seat === nextSeat && p.isAI) { aiPlayer = p; break; }
  }
  if (!aiPlayer) return;

  const delay = 600 + Math.random() * 700;
  setTimeout(() => {
    if (!rooms.has(room.roomId)) return;
    if (room.game.state !== STATES.PLAYING) return;

    const hand = room.game.hands[nextSeat];
    if (!hand || hand.length === 0) return;

    const card = aiPlayer.aiInstance.decideCard(
      hand,
      room.game.currentTrick,
      room.game.trump,
      nextSeat,
      room.game.declarer,
      room.game.mode
    );

    const result = room.game.playCard(nextSeat, card.id);
    broadcastPlay(room, nextSeat, card, result);
  }, delay);
}

function scheduleAIBid(room) {
  if (!room.game || room.game.state !== STATES.BIDDING) return;
  const currentBidder = room.game.biddingEngine?.currentBidder;
  if (currentBidder === undefined) return;

  let aiPlayer = null;
  for (const [sid, p] of room.sockets) {
    if (p.seat === currentBidder && p.isAI) { aiPlayer = p; break; }
  }
  if (!aiPlayer) return;

  const delay = 800 + Math.random() * 800;
  setTimeout(() => {
    if (!rooms.has(room.roomId)) return;
    if (room.game.state !== STATES.BIDDING) return;
    if (room.game.biddingEngine?.currentBidder !== currentBidder) return;

    const hand = room.game.hands[currentBidder];
    const bid = aiPlayer.aiInstance.decideBid(
      hand,
      room.game.biddingEngine.highBid,
      7,
      room.game.mode
    );

    const result = room.game.processBid(currentBidder, bid);
    broadcastBid(room, currentBidder, bid, result);
  }, delay);
}

function scheduleAITrump(room) {
  if (!room.game || room.game.state !== STATES.TRUMP_SELECTION) return;
  const declarer = room.game.declarer;

  let aiPlayer = null;
  for (const [sid, p] of room.sockets) {
    if (p.seat === declarer && p.isAI) { aiPlayer = p; break; }
  }
  if (!aiPlayer) return;

  setTimeout(() => {
    if (!rooms.has(room.roomId)) return;
    if (room.game.state !== STATES.TRUMP_SELECTION) return;

    const hand = room.game.hands[declarer];
    const suit = aiPlayer.aiInstance.decideTrump(hand);
    const result = room.game.selectTrump(declarer, suit);
    if (result.ok) {
      io.to(room.roomId).emit('trump_selected', { suit, declarer, leadSeat: result.leadSeat });
      broadcastRoom(room);
      setTimeout(() => scheduleAI(room), 500);
    }
  }, 1000);
}

function scheduleAIBury(room) {
  if (!room.game || room.game.state !== STATES.BURYING) return;
  const dealer = room.game.dealer;

  let aiPlayer = null;
  for (const [sid, p] of room.sockets) {
    if (p.seat === dealer && p.isAI) { aiPlayer = p; break; }
  }
  if (!aiPlayer) return;

  setTimeout(() => {
    if (!rooms.has(room.roomId)) return;
    if (room.game.state !== STATES.BURYING) return;

    const extra = room.game.extraCards;
    const hand = room.game.hands[dealer];
    const tobury = aiPlayer.aiInstance.decidebury(extra, hand);
    const result = room.game.processBury(dealer, tobury.map(c => c.id));
    if (result.ok) {
      io.to(room.roomId).emit('buried', { dealer });
      broadcastRoom(room);
      scheduleAIBid(room);
    }
  }, 800);
}

function broadcastBid(room, seat, bid, result) {
  io.to(room.roomId).emit('bid_placed', { seat, bid });
  if (result.done) {
    if (result.isHediye) {
      io.to(room.roomId).emit('hediye', {});
      broadcastRoom(room);
      setTimeout(() => scheduleAI(room), 500);
    } else {
      io.to(room.roomId).emit('bidding_won', { winner: result.winner, bid: result.bid });
      broadcastRoom(room);
      scheduleAITrump(room);
    }
  } else {
    broadcastRoom(room);
    scheduleAIBid(room);
  }
}

function broadcastPlay(room, seatIndex, card, result) {
  if (!result.ok) return;

  io.to(room.roomId).emit('card_played', {
    seatIndex,
    card: { id: card.id, suit: card.suit, rank: card.rank },
    trickComplete: result.trickComplete
  });

  if (result.trickComplete) {
    setTimeout(() => {
      io.to(room.roomId).emit('trick_won', {
        winner: result.trickWinner,
        tricks: result.tricks,
        roundOver: result.roundOver,
        scores: result.scores,
        delta: result.delta,
        made: result.made,
        gameOver: result.gameOver
      });
      broadcastRoom(room);

      if (!result.roundOver) {
        setTimeout(() => scheduleAI(room), 1200);
      }
    }, 800);
  } else {
    broadcastRoom(room);
    setTimeout(() => scheduleAI(room), 100);
  }
}

io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  socket.on('create_room', ({ name, avatar, mode, vsAI }) => {
    const roomId = generateRoomCode();
    const room = {
      roomId,
      host: socket.id,
      mode: mode || 'ihaleli',
      vsAI: vsAI || false,
      game: null,
      sockets: new Map()
    };

    const seat = 0;
    room.sockets.set(socket.id, { name, avatar: avatar || 1, seat, isAI: false });
    rooms.set(roomId, room);
    socket.join(roomId);

    if (vsAI) {
      for (let i = 1; i <= 3; i++) {
        const aiNames = ['Ahmet', 'Ayşe', 'Mehmet'];
        const aiId = `AI_${roomId}_${i}`;
        const aiInstance = new AIPlayer('medium');
        room.sockets.set(aiId, { name: aiNames[i - 1], avatar: i + 1, seat: i, isAI: true, aiInstance });
      }
    }

    socket.emit('room_created', { roomId, seat });
    broadcastRoom(room);
  });

  socket.on('join_room', ({ roomId, name, avatar }) => {
    const room = rooms.get(roomId);
    if (!room) { socket.emit('error', { msg: 'Oda bulunamadı' }); return; }

    const takenSeats = new Set([...room.sockets.values()].map(p => p.seat));
    let seat = -1;
    for (let i = 0; i < 4; i++) { if (!takenSeats.has(i)) { seat = i; break; } }
    if (seat === -1) { socket.emit('error', { msg: 'Oda dolu' }); return; }

    room.sockets.set(socket.id, { name, avatar: avatar || 1, seat, isAI: false });
    socket.join(roomId);
    socket.emit('room_joined', { roomId, seat });
    broadcastRoom(room);
  });

  // Reconnect after page redirect (lobby -> game.html)
  socket.on('rejoin_game', ({ roomId, seat, name }) => {
    const room = rooms.get(roomId);
    if (!room) { socket.emit('error', { msg: 'Oda bulunamadı' }); return; }

    // Find existing human player at this seat and replace their socket
    let existingKey = null;
    for (const [sid, p] of room.sockets) {
      if (p.seat === seat && !p.isAI) { existingKey = sid; break; }
    }

    let playerData;
    if (existingKey) {
      playerData = room.sockets.get(existingKey);
      room.sockets.delete(existingKey);
    } else {
      playerData = { name, avatar: 1, seat, isAI: false };
    }

    room.sockets.set(socket.id, playerData);
    if (room.host === existingKey) room.host = socket.id;
    socket.join(roomId);

    // Send current game state to rejoining player
    const state = room.game ? room.game.getStateForSeat(seat) : null;
    socket.emit('rejoined', { roomId, seat, gameState: state, mode: room.mode });
    broadcastRoom(room);

    // Resume AI if game is mid-play
    if (room.game) {
      const gs = room.game.state;
      if (gs === 'BIDDING') setTimeout(() => scheduleAIBid(room), 500);
      else if (gs === 'TRUMP_SELECTION') setTimeout(() => scheduleAITrump(room), 500);
      else if (gs === 'PLAYING') setTimeout(() => scheduleAI(room), 500);
    }
  });

  socket.on('start_game', () => {
    const found = getRoomBySocket(socket.id);
    if (!found) return;
    const { room } = found;
    if (room.host !== socket.id) return;
    if (room.sockets.size < 4) { socket.emit('error', { msg: 'Yeterli oyuncu yok' }); return; }

    room.game = new BatakGame({ mode: room.mode, maxRounds: 4 });
    for (const [sid, p] of room.sockets) {
      room.game.addPlayer({ id: sid, name: p.name, avatar: p.avatar, isAI: p.isAI });
    }

    const roundResult = room.game.startRound();
    io.to(room.roomId).emit('game_started', { mode: room.mode, round: 1 });
    broadcastRoom(room);

    if (roundResult.state === STATES.BURYING) {
      const dealerSeat = room.game.dealer;
      for (const [sid, p] of room.sockets) {
        if (p.seat === dealerSeat && !p.isAI) {
          io.to(sid).emit('bury_prompt', {
            extraCards: room.game.extraCards.map(c => ({ id: c.id, suit: c.suit, rank: c.rank }))
          });
        }
      }
      scheduleAIBury(room);
    } else if (roundResult.state === STATES.BIDDING) {
      io.to(room.roomId).emit('bidding_started', {
        currentBidder: roundResult.currentBidder,
        minBid: 7
      });
      scheduleAIBid(room);
    } else if (roundResult.state === STATES.PLAYING) {
      io.to(room.roomId).emit('playing_started', { trump: roundResult.trump });
      scheduleAI(room);
    }
  });

  socket.on('bury_cards', ({ cardIds }) => {
    const found = getRoomBySocket(socket.id);
    if (!found) return;
    const { room } = found;
    const player = room.sockets.get(socket.id);
    if (!player) return;

    const result = room.game.processBury(player.seat, cardIds);
    if (!result.ok) { socket.emit('error', { msg: result.error }); return; }

    io.to(room.roomId).emit('buried', { dealer: player.seat });
    io.to(room.roomId).emit('bidding_started', { currentBidder: result.currentBidder, minBid: 8 });
    broadcastRoom(room);
    scheduleAIBid(room);
  });

  socket.on('place_bid', ({ value }) => {
    const found = getRoomBySocket(socket.id);
    if (!found) return;
    const { room } = found;
    const player = room.sockets.get(socket.id);
    if (!player) return;

    const result = room.game.processBid(player.seat, value);
    if (!result.ok) { socket.emit('error', { msg: result.error }); return; }

    broadcastBid(room, player.seat, value, result);
  });

  socket.on('select_trump', ({ suit }) => {
    const found = getRoomBySocket(socket.id);
    if (!found) return;
    const { room } = found;
    const player = room.sockets.get(socket.id);
    if (!player) return;

    const result = room.game.selectTrump(player.seat, suit);
    if (!result.ok) { socket.emit('error', { msg: result.error }); return; }

    io.to(room.roomId).emit('trump_selected', { suit, declarer: player.seat, leadSeat: result.leadSeat });
    broadcastRoom(room);
    setTimeout(() => scheduleAI(room), 500);
  });

  socket.on('play_card', ({ cardId }) => {
    const found = getRoomBySocket(socket.id);
    if (!found) return;
    const { room } = found;
    const player = room.sockets.get(socket.id);
    if (!player) return;

    const card = room.game.hands[player.seat]?.find(c => c.id === cardId)
      || { id: cardId, suit: cardId.split('_')[1], rank: cardId.split('_')[0] };

    const result = room.game.playCard(player.seat, cardId);
    if (!result.ok) { socket.emit('error', { msg: result.error }); return; }

    broadcastPlay(room, player.seat, card, result);
  });

  socket.on('next_round', () => {
    const found = getRoomBySocket(socket.id);
    if (!found) return;
    const { room } = found;
    if (!room.game || room.game.state === STATES.GAME_OVER) return;

    const roundResult = room.game.startRound();
    io.to(room.roomId).emit('round_started', { round: room.game.round });
    broadcastRoom(room);

    if (roundResult.state === STATES.BURYING) {
      const dealerSeat = room.game.dealer;
      for (const [sid, p] of room.sockets) {
        if (p.seat === dealerSeat && !p.isAI) {
          io.to(sid).emit('bury_prompt', {
            extraCards: room.game.extraCards.map(c => ({ id: c.id, suit: c.suit, rank: c.rank }))
          });
        }
      }
      scheduleAIBury(room);
    } else if (roundResult.state === STATES.BIDDING) {
      io.to(room.roomId).emit('bidding_started', { currentBidder: roundResult.currentBidder, minBid: 8 });
      scheduleAIBid(room);
    } else if (roundResult.state === STATES.PLAYING) {
      io.to(room.roomId).emit('playing_started', { trump: roundResult.trump });
      scheduleAI(room);
    }
  });

  socket.on('send_chat', ({ message }) => {
    const found = getRoomBySocket(socket.id);
    if (!found) return;
    const { room } = found;
    const player = room.sockets.get(socket.id);
    if (!player || !message) return;
    io.to(room.roomId).emit('chat_message', {
      name: player.name,
      message: message.substring(0, 200),
      seat: player.seat
    });
  });

  socket.on('disconnect', () => {
    const found = getRoomBySocket(socket.id);
    if (!found) return;
    const { roomId, room } = found;
    room.sockets.delete(socket.id);
    if (room.sockets.size === 0) {
      rooms.delete(roomId);
    } else {
      broadcastRoom(room);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🃏 Batak oyunu çalışıyor: http://localhost:${PORT}`);
});
