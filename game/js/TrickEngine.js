const { RANK_VALUES } = typeof require !== 'undefined' ? require('./Deck') : window;

class TrickEngine {
  constructor() {
    this.trump = null;
    this.ledSuit = null;
    this.trick = []; // [{seatIndex, card}]
    this.leadSeat = 0;
  }

  reset(leadSeat, trump) {
    this.leadSeat = leadSeat;
    this.trump = trump;
    this.trick = [];
    this.ledSuit = null;
  }

  isValidPlay(hand, card) {
    if (this.ledSuit === null) return true; // First card of trick
    if (card.suit === this.ledSuit) return true;
    const hasSuit = hand.some(c => c.suit === this.ledSuit);
    return !hasSuit;
  }

  addCard(seatIndex, card) {
    if (this.trick.length === 0) {
      this.ledSuit = card.suit;
    }
    this.trick.push({ seatIndex, card });
  }

  resolveTrick() {
    let winnerIndex = 0;
    let winner = this.trick[0];

    for (let i = 1; i < this.trick.length; i++) {
      const current = this.trick[i];
      if (this._beats(current.card, winner.card)) {
        winner = current;
        winnerIndex = i;
      }
    }

    return {
      winner: winner.seatIndex,
      cards: this.trick.map(t => t.card),
      ledSuit: this.ledSuit
    };
  }

  _beats(card, against) {
    const trump = this.trump;
    const led = this.ledSuit;

    // Trump beats non-trump
    if (card.suit === trump && against.suit !== trump) return true;
    if (card.suit !== trump && against.suit === trump) return false;

    // Both trump: higher wins
    if (card.suit === trump && against.suit === trump) {
      return RANK_VALUES[card.rank] > RANK_VALUES[against.rank];
    }

    // Neither trump: led suit beats off-suit
    if (card.suit === led && against.suit !== led) return true;
    if (card.suit !== led && against.suit === led) return false;

    // Same suit: higher rank wins
    if (card.suit === against.suit) {
      return RANK_VALUES[card.rank] > RANK_VALUES[against.rank];
    }

    return false;
  }
}

if (typeof module !== 'undefined') {
  module.exports = { TrickEngine };
}
