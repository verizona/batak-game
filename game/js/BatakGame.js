const { Deck } = typeof require !== 'undefined' ? require('./Deck') : window;
const { BiddingEngine } = typeof require !== 'undefined' ? require('./BiddingEngine') : window;
const { TrickEngine } = typeof require !== 'undefined' ? require('./TrickEngine') : window;
const { ScoreEngine } = typeof require !== 'undefined' ? require('./ScoreEngine') : window;

const STATES = {
  WAITING: 'WAITING',
  DEALING: 'DEALING',
  BURYING: 'BURYING',
  BIDDING: 'BIDDING',
  TRUMP_SELECTION: 'TRUMP_SELECTION',
  PLAYING: 'PLAYING',
  ROUND_SCORING: 'ROUND_SCORING',
  GAME_OVER: 'GAME_OVER'
};

class BatakGame {
  constructor(settings = {}) {
    this.mode = settings.mode || 'ihaleli';
    this.maxRounds = settings.maxRounds || 4;
    this.state = STATES.WAITING;
    this.players = []; // [{id, name, avatar, isAI}]
    this.deck = new Deck();
    this.hands = [[], [], [], []];
    this.scores = [0, 0, 0, 0];
    this.round = 0;
    this.dealer = 0;
    this.currentTrick = [];
    this.trickNumber = 0;
    this.tricks = [0, 0, 0, 0];
    this.trump = null;
    this.declarer = null;
    this.contract = null;
    this.buriedCards = [];
    this.extraCards = [];
    this.partners = [[0, 2], [1, 3]];
    this.leadSeat = 0;
    this.trickEngine = new TrickEngine();
    this.scoreEngine = new ScoreEngine(this.mode);
    this.biddingEngine = null;
    this.playedCardIds = new Set();
  }

  addPlayer(player) {
    if (this.players.length >= 4) return false;
    this.players.push(player);
    return true;
  }

  canStart() {
    return this.players.length === 4;
  }

  startRound() {
    this.round++;
    this.deck.reset();
    this.deck.shuffle();
    this.tricks = [0, 0, 0, 0];
    this.trump = null;
    this.declarer = null;
    this.contract = null;
    this.buriedCards = [];
    this.extraCards = [];
    this.trickNumber = 0;
    this.currentTrick = [];
    this.playedCardIds = new Set();
    this.state = STATES.DEALING;

    if (this.mode === 'goemmeli') {
      // Draw 3 göm cards first, then dealer gets 13, others get 12 (total 3+13+12*3=52)
      this.extraCards = this.deck.draw(3);
      const hands = [[], [], [], []];
      for (let i = 0; i < 4; i++) {
        hands[i] = this.deck.draw(i === this.dealer ? 13 : 12);
      }
      this.hands = hands;
      this.state = STATES.BURYING;
      return { state: STATES.BURYING, dealer: this.dealer, extraCards: this.extraCards };
    } else if (this.mode === 'ihalesiz') {
      const hands = this.deck.deal(4, 13);
      this.hands = hands;
      this.trump = this.deck.draw(1)[0]?.suit || 'spades';
      this.leadSeat = (this.dealer + 1) % 4;
      this.state = STATES.PLAYING;
      this.trickEngine.reset(this.leadSeat, this.trump);
      return { state: STATES.PLAYING, trump: this.trump };
    } else {
      const hands = this.deck.deal(4, 13);
      this.hands = hands;
      const startBidder = (this.dealer + 1) % 4;
      this.biddingEngine = new BiddingEngine(4, startBidder);
      this.state = STATES.BIDDING;
      return { state: STATES.BIDDING, currentBidder: startBidder };
    }
  }

  processBury(seatIndex, cardIds) {
    if (this.state !== STATES.BURYING) return { ok: false, error: 'Yanlış aşama' };
    if (seatIndex !== this.dealer) return { ok: false, error: 'Sadece dağıtıcı gömer' };
    if (cardIds.length !== 3) return { ok: false, error: '3 kart gömmelisiniz' };

    // Validate cards belong to dealer's hand + extra
    const allAvailable = [...this.hands[seatIndex], ...this.extraCards];
    const tobury = cardIds.map(id => allAvailable.find(c => c.id === id));
    if (tobury.some(c => !c)) return { ok: false, error: 'Geçersiz kart' };

    this.buriedCards = tobury;
    const newHand = allAvailable.filter(c => !cardIds.includes(c.id));
    this.hands[seatIndex] = newHand; // dealer now has 13 cards after burying 3 from 16

    const startBidder = (this.dealer + 1) % 4;
    this.biddingEngine = new BiddingEngine(4, startBidder);
    this.state = STATES.BIDDING;
    return { ok: true, state: STATES.BIDDING, currentBidder: startBidder };
  }

  processBid(seatIndex, value) {
    if (this.state !== STATES.BIDDING) return { ok: false, error: 'Yanlış aşama' };
    const result = this.biddingEngine.processBid(seatIndex, value);
    if (!result.ok) return result;

    if (result.done) {
      if (result.isHediye) {
        this.state = STATES.PLAYING;
        this.trump = null;
        this.declarer = null;
        this.contract = null;
        this.leadSeat = (this.dealer + 1) % 4;
        this.trickEngine.reset(this.leadSeat, null);
        return { ok: true, done: true, isHediye: true, state: STATES.PLAYING };
      }
      this.declarer = result.winner;
      this.contract = result.bid;
      this.state = STATES.TRUMP_SELECTION;
      return { ok: true, done: true, winner: result.winner, bid: result.bid, state: STATES.TRUMP_SELECTION };
    }

    return { ok: true, done: false, currentBidder: result.currentBidder };
  }

  selectTrump(seatIndex, suit) {
    if (this.state !== STATES.TRUMP_SELECTION) return { ok: false, error: 'Yanlış aşama' };
    if (seatIndex !== this.declarer) return { ok: false, error: 'Sadece açan koz seçer' };
    const validSuits = ['spades', 'hearts', 'diamonds', 'clubs'];
    if (!validSuits.includes(suit)) return { ok: false, error: 'Geçersiz koz' };

    this.trump = suit;
    this.leadSeat = this.declarer;
    this.state = STATES.PLAYING;
    this.trickEngine.reset(this.leadSeat, suit);
    return { ok: true, trump: suit, leadSeat: this.leadSeat };
  }

  playCard(seatIndex, cardId) {
    if (this.state !== STATES.PLAYING) return { ok: false, error: 'Yanlış aşama' };

    const expectedSeat = this._currentTurnSeat();
    if (seatIndex !== expectedSeat) return { ok: false, error: 'Sıra sizde değil' };

    const cardIndex = this.hands[seatIndex].findIndex(c => c.id === cardId);
    if (cardIndex === -1) return { ok: false, error: 'Bu kart sizde yok' };

    const card = this.hands[seatIndex][cardIndex];
    if (!this.trickEngine.isValidPlay(this.hands[seatIndex], card)) {
      return { ok: false, error: 'Renk uymak zorundasınız' };
    }

    this.hands[seatIndex].splice(cardIndex, 1);
    this.trickEngine.addCard(seatIndex, card);
    this.currentTrick.push({ seatIndex, card });
    this.playedCardIds.add(cardId);

    if (this.currentTrick.length === 4) {
      return this._resolveTrick();
    }

    return { ok: true, card, seatIndex, trickComplete: false, nextSeat: this._currentTurnSeat() };
  }

  _currentTurnSeat() {
    if (this.currentTrick.length === 0) return this.leadSeat;
    const lastSeat = this.currentTrick[this.currentTrick.length - 1].seatIndex;
    return (lastSeat + 1) % 4;
  }

  _resolveTrick() {
    const result = this.trickEngine.resolveTrick();
    this.tricks[result.winner]++;
    this.trickNumber++;
    this.currentTrick = [];

    if (this.trickNumber === 13) {
      return this._resolveRound(result.winner, result.cards);
    }

    this.leadSeat = result.winner;
    this.trickEngine.reset(this.leadSeat, this.trump);
    return {
      ok: true,
      trickComplete: true,
      trickWinner: result.winner,
      cards: result.cards,
      tricks: [...this.tricks],
      nextSeat: result.winner,
      roundOver: false
    };
  }

  _resolveRound(lastWinner, lastCards) {
    const scoreMode = this.biddingEngine?.isHediye ? 'hediye' : this.mode;
    const scoreResult = this.scoreEngine.calculate({
      mode: scoreMode,
      declarer: this.declarer,
      contract: this.contract,
      tricks: this.tricks,
      buriedCards: this.buriedCards.length,
      partners: this.partners
    });

    scoreResult.delta.forEach((d, i) => { this.scores[i] += d; });

    const roundOver = this.round >= this.maxRounds;
    if (roundOver) this.state = STATES.GAME_OVER;
    else {
      this.state = STATES.ROUND_SCORING;
      this.dealer = (this.dealer + 1) % 4;
    }

    return {
      ok: true,
      trickComplete: true,
      trickWinner: lastWinner,
      cards: lastCards,
      tricks: [...this.tricks],
      roundOver: true,
      scores: [...this.scores],
      delta: scoreResult.delta,
      made: scoreResult.made,
      gameOver: roundOver
    };
  }

  getStateForSeat(seatIndex) {
    return {
      state: this.state,
      mode: this.mode,
      round: this.round,
      maxRounds: this.maxRounds,
      dealer: this.dealer,
      hand: this.hands[seatIndex]?.map(c => ({ id: c.id, suit: c.suit, rank: c.rank })) || [],
      handCounts: this.hands.map((h, i) => i === seatIndex ? h.length : h.length),
      scores: [...this.scores],
      tricks: [...this.tricks],
      trump: this.trump,
      declarer: this.declarer,
      contract: this.contract,
      currentTrick: this.currentTrick.map(t => ({ seatIndex: t.seatIndex, card: { id: t.card.id, suit: t.card.suit, rank: t.card.rank } })),
      trickNumber: this.trickNumber,
      leadSeat: this.leadSeat,
      currentBidder: this.biddingEngine?.currentBidder,
      highBid: this.biddingEngine?.highBid,
      highBidder: this.biddingEngine?.highBidder,
      bids: this.biddingEngine?.bids,
      extraCards: seatIndex === this.dealer ? this.extraCards.map(c => ({ id: c.id, suit: c.suit, rank: c.rank })) : []
    };
  }

  getHandForSeat(seatIndex) {
    return this.hands[seatIndex]?.map(c => ({ id: c.id, suit: c.suit, rank: c.rank })) || [];
  }
}

if (typeof module !== 'undefined') {
  module.exports = { BatakGame, STATES };
}
