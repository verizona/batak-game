class ScoreEngine {
  constructor(mode) {
    this.mode = mode;
  }

  calculate(state) {
    const { mode, declarer, contract, tricks, buriedCards, partners } = state;
    switch (mode) {
      case 'ihaleli': return this.calcIhaleli(declarer, contract, tricks);
      case 'goemmeli': return this.calcGoemmeli(declarer, contract, tricks, buriedCards);
      case 'esli': return this.calcEsli(declarer, contract, tricks, partners);
      case 'ihalesiz': return this.calcIhalesiz(tricks);
      case 'hediye': return this.calcHediye(tricks);
      default: return this.calcIhaleli(declarer, contract, tricks);
    }
  }

  calcIhaleli(declarer, contract, tricks) {
    const delta = [0, 0, 0, 0];
    const declarerTricks = tricks[declarer];
    if (declarerTricks >= contract) {
      delta[declarer] = contract;
      for (let i = 0; i < 4; i++) {
        if (i !== declarer) {
          delta[i] = tricks[i];
          delta[declarer] -= tricks[i];
        }
      }
    } else {
      delta[declarer] = -contract;
      for (let i = 0; i < 4; i++) {
        if (i !== declarer) delta[i] = tricks[i];
      }
    }
    return { delta, made: declarerTricks >= contract };
  }

  calcGoemmeli(declarer, contract, tricks, buriedCount) {
    const adjustedTricks = [...tricks];
    adjustedTricks[declarer] += (buriedCount || 0);
    return this.calcIhaleli(declarer, contract, adjustedTricks);
  }

  calcEsli(declarer, contract, tricks, partners) {
    // partners = [[0,2],[1,3]] or similar
    const delta = [0, 0, 0, 0];
    const declarerTeam = partners.find(p => p.includes(declarer));
    const opponentTeam = partners.find(p => !p.includes(declarer));
    const teamTricks = declarerTeam.reduce((s, i) => s + tricks[i], 0);

    if (teamTricks >= contract) {
      declarerTeam.forEach(i => delta[i] = Math.floor(contract / 2));
      opponentTeam.forEach(i => delta[i] = tricks[i]);
    } else {
      declarerTeam.forEach(i => delta[i] = -Math.floor(contract / 2));
      opponentTeam.forEach(i => delta[i] = tricks[i]);
    }
    return { delta, made: teamTricks >= contract };
  }

  calcIhalesiz(tricks) {
    const delta = tricks.map(t => t);
    return { delta, made: true };
  }

  calcHediye(tricks) {
    // Hediye: all pass. Most tricks = penalty (double)
    const maxTricks = Math.max(...tricks);
    const delta = tricks.map(t => t === maxTricks ? -maxTricks * 2 : t);
    return { delta, made: true };
  }
}

if (typeof module !== 'undefined') {
  module.exports = { ScoreEngine };
}
