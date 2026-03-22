const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A'];
const RANK_VALUES = { 2:0, 3:1, 4:2, 5:3, 6:4, 7:5, 8:6, 9:7, 10:8, 'J':9, 'Q':10, 'K':11, 'A':12 };

class Card {
  constructor(suit, rank) {
    this.suit = suit;
    this.rank = rank;
    this.id = `${rank}_${suit}`;
  }
  getValue() {
    return RANK_VALUES[this.rank];
  }
  toString() {
    const suitSymbols = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
    return `${this.rank}${suitSymbols[this.suit]}`;
  }
}

class Deck {
  constructor() {
    this.cards = [];
    this.reset();
  }

  reset() {
    this.cards = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        this.cards.push(new Card(suit, rank));
      }
    }
  }

  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
    return this;
  }

  deal(numPlayers, cardsEach) {
    const hands = Array.from({ length: numPlayers }, () => []);
    for (let i = 0; i < cardsEach * numPlayers; i++) {
      hands[i % numPlayers].push(this.cards[i]);
    }
    this.cards = this.cards.slice(cardsEach * numPlayers);
    return hands;
  }

  draw(n = 1) {
    return this.cards.splice(0, n);
  }
}

if (typeof module !== 'undefined') {
  module.exports = { Card, Deck, SUITS, RANKS, RANK_VALUES };
}
