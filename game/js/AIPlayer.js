const { RANK_VALUES } = typeof require !== 'undefined' ? require('./Deck') : window;

class AIPlayer {
  constructor(difficulty = 'medium') {
    this.difficulty = difficulty;
    this.playedCards = [];
  }

  resetMemory() {
    this.playedCards = [];
  }

  recordPlayed(card) {
    this.playedCards.push(card.id);
  }

  decideBid(hand, currentHighBid, minBid, mode) {
    if (this.difficulty === 'easy') {
      return Math.random() < 0.6 ? 'PAS' : (currentHighBid + 1 <= 13 ? currentHighBid + 1 : 'PAS');
    }

    const sureTricks = this._countSureTricks(hand);
    const shouldBid = sureTricks >= 4;

    if (!shouldBid) return 'PAS';

    let bid = Math.min(7 + Math.floor(sureTricks * 0.6), 13);
    if (bid <= currentHighBid) bid = currentHighBid + 1;
    if (bid > 13) return 'PAS';
    return bid;
  }

  _countSureTricks(hand) {
    let count = 0;
    const byRank = {};
    hand.forEach(c => {
      if (!byRank[c.rank]) byRank[c.rank] = 0;
      byRank[c.rank]++;
    });
    const aces = byRank['A'] || 0;
    const kings = byRank['K'] || 0;
    const queens = byRank['Q'] || 0;
    count += aces + kings * 0.7 + queens * 0.4;

    const bySuit = {};
    hand.forEach(c => {
      if (!bySuit[c.suit]) bySuit[c.suit] = 0;
      bySuit[c.suit]++;
    });
    Object.values(bySuit).forEach(n => {
      if (n === 0) count += 0.5;
    });

    return Math.round(count);
  }

  decideTrump(hand) {
    const bySuit = { spades: 0, hearts: 0, diamonds: 0, clubs: 0 };
    const valuesBySuit = { spades: 0, hearts: 0, diamonds: 0, clubs: 0 };
    hand.forEach(c => {
      bySuit[c.suit]++;
      valuesBySuit[c.suit] += RANK_VALUES[c.rank];
    });

    return Object.keys(bySuit).reduce((best, suit) => {
      const score = bySuit[suit] * 10 + valuesBySuit[suit];
      const bestScore = bySuit[best] * 10 + valuesBySuit[best];
      return score > bestScore ? suit : best;
    });
  }

  decideCard(hand, trick, trumpSuit, seatIndex, declarerSeat, mode) {
    const validCards = this._getValidCards(hand, trick);

    if (this.difficulty === 'easy') {
      return validCards[Math.floor(Math.random() * validCards.length)];
    }

    const ledSuit = trick.length > 0 ? trick[0].card.suit : null;

    // Leading
    if (trick.length === 0) {
      return this._chooseLead(validCards, trumpSuit, seatIndex, declarerSeat);
    }

    // Following
    return this._chooseFollow(validCards, trick, trumpSuit, ledSuit, seatIndex, declarerSeat);
  }

  _getValidCards(hand, trick) {
    if (trick.length === 0) return [...hand];
    const ledSuit = trick[0].card.suit;
    const haveLedSuit = hand.filter(c => c.suit === ledSuit);
    return haveLedSuit.length > 0 ? haveLedSuit : [...hand];
  }

  _chooseLead(cards, trump, seat, declarerSeat) {
    const isDefender = seat !== declarerSeat;
    const trumpCards = cards.filter(c => c.suit === trump);
    const nonTrump = cards.filter(c => c.suit !== trump);

    if (isDefender && trumpCards.length > 0 && Math.random() < 0.3) {
      return trumpCards.reduce((a, b) => RANK_VALUES[a.rank] > RANK_VALUES[b.rank] ? a : b);
    }

    if (nonTrump.length > 0) {
      return nonTrump.reduce((a, b) => RANK_VALUES[a.rank] > RANK_VALUES[b.rank] ? a : b);
    }

    return cards[0];
  }

  _chooseFollow(cards, trick, trump, ledSuit, seat, declarerSeat) {
    const isDefender = seat !== declarerSeat;
    const currentWinner = this._currentTrickWinner(trick, trump, ledSuit);
    const weAreWinning = currentWinner === seat;

    const winningCards = cards.filter(c => this._wouldWin(c, trick, trump, ledSuit));
    const losingCards = cards.filter(c => !this._wouldWin(c, trick, trump, ledSuit));

    if (isDefender) {
      // Defenders want to win tricks
      if (winningCards.length > 0) {
        return winningCards.reduce((a, b) => RANK_VALUES[a.rank] < RANK_VALUES[b.rank] ? a : b);
      }
      return losingCards.reduce((a, b) => RANK_VALUES[a.rank] < RANK_VALUES[b.rank] ? a : b);
    } else {
      // Declarer wants to make contract
      if (winningCards.length > 0) {
        return winningCards.reduce((a, b) => RANK_VALUES[a.rank] > RANK_VALUES[b.rank] ? a : b);
      }
      return losingCards.reduce((a, b) => RANK_VALUES[a.rank] < RANK_VALUES[b.rank] ? a : b);
    }
  }

  _currentTrickWinner(trick, trump, ledSuit) {
    if (trick.length === 0) return -1;
    let winner = trick[0];
    for (let i = 1; i < trick.length; i++) {
      if (this._beats(trick[i].card, winner.card, trump, ledSuit)) {
        winner = trick[i];
      }
    }
    return winner.seatIndex;
  }

  _wouldWin(card, trick, trump, ledSuit) {
    const currentWinner = trick.reduce((best, t) => {
      return this._beats(t.card, best.card, trump, ledSuit) ? t : best;
    }, trick[0]);
    return this._beats(card, currentWinner.card, trump, ledSuit);
  }

  _beats(card, against, trump, ledSuit) {
    if (card.suit === trump && against.suit !== trump) return true;
    if (card.suit !== trump && against.suit === trump) return false;
    if (card.suit === trump && against.suit === trump) {
      return RANK_VALUES[card.rank] > RANK_VALUES[against.rank];
    }
    if (card.suit === ledSuit && against.suit !== ledSuit) return true;
    if (card.suit !== ledSuit && against.suit === ledSuit) return false;
    return RANK_VALUES[card.rank] > RANK_VALUES[against.rank];
  }

  decidebury(extraCards, hand) {
    // Bury the lowest value cards
    const allCards = [...extraCards];
    allCards.sort((a, b) => RANK_VALUES[a.rank] - RANK_VALUES[b.rank]);
    return allCards.slice(0, 3);
  }
}

if (typeof module !== 'undefined') {
  module.exports = { AIPlayer };
}
