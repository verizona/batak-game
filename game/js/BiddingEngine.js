class BiddingEngine {
  constructor(numPlayers, startSeat) {
    this.numPlayers = numPlayers;
    this.startSeat = startSeat;
    this.currentBidder = startSeat;
    this.highBid = 6; // minimum is 7
    this.highBidder = -1;
    this.passes = new Array(numPlayers).fill(false);
    this.bids = new Array(numPlayers).fill(null);
    this.consecutivePasses = 0;
    this.done = false;
    this.isHediye = false;
  }

  isValidBid(seatIndex, value) {
    if (seatIndex !== this.currentBidder) return false;
    if (this.passes[seatIndex]) return false;
    if (value === 'PAS') return true;
    const num = parseInt(value);
    if (isNaN(num)) return false;
    return num >= 7 && num <= 13 && num > this.highBid;
  }

  processBid(seatIndex, value) {
    if (!this.isValidBid(seatIndex, value)) {
      return { ok: false, error: 'Geçersiz hamle' };
    }

    if (value === 'PAS') {
      this.passes[seatIndex] = true;
      this.bids[seatIndex] = 'PAS';
      this.consecutivePasses++;
    } else {
      const num = parseInt(value);
      this.highBid = num;
      this.highBidder = seatIndex;
      this.bids[seatIndex] = num;
      this.consecutivePasses = 0;
    }

    // Advance to next non-passed player
    let next = (seatIndex + 1) % this.numPlayers;
    while (this.passes[next] && next !== seatIndex) {
      next = (next + 1) % this.numPlayers;
    }

    // Check if bidding is done
    const activePlayers = this.bids.filter(b => b !== 'PAS' && b !== null).length;
    const passedCount = this.passes.filter(Boolean).length;

    // All passed = Hediye
    if (passedCount === this.numPlayers) {
      this.done = true;
      this.isHediye = true;
      return { ok: true, done: true, isHediye: true };
    }

    // All but one passed = bidding over
    if (passedCount === this.numPlayers - 1 && this.highBidder !== -1) {
      this.done = true;
      return { ok: true, done: true, winner: this.highBidder, bid: this.highBid };
    }

    this.currentBidder = next;
    return { ok: true, done: false, currentBidder: next };
  }

  getActiveBidders() {
    return this.passes.map((p, i) => !p ? i : -1).filter(i => i >= 0);
  }
}

if (typeof module !== 'undefined') {
  module.exports = { BiddingEngine };
}
