const { createDeck, canPlayOn, getCardPoints, shuffleArray, CARD_COLORS } = require('./Card');

class GameManager {
  constructor(roomId, players) {
    this.roomId = roomId;
    this.players = players; // Array of Player instances
    this.deck = [];
    this.discardPile = [];
    this.currentPlayerIndex = 0;
    this.direction = 1; // 1 = clockwise, -1 = counter
    this.currentColor = null;
    this.state = 'waiting'; // waiting | playing | finished
    this.winnerId = null;
    this.pendingWild4 = null; // { playerId, card } for challenge window
    this.wild4Timer = null;
    this.turnTimer = null;
    this.turnTimeLimit = 30000; // 30 seconds
    this.drawnThisTurn = false; // Track if current player already drew
  }

  startGame() {
    this.deck = createDeck();
    this.discardPile = [];
    this.direction = 1;
    this.state = 'playing';
    this.winnerId = null;
    this.drawnThisTurn = false;

    // Deal 7 cards to each player
    for (const player of this.players) {
      player.hand = [];
      player.calledUno = false;
      for (let i = 0; i < 7; i++) {
        player.hand.push(this.drawFromDeck());
      }
    }

    // Flip first card - redraw if Wild Draw Four
    let firstCard = this.drawFromDeck();
    while (firstCard.value === 'wild4') {
      this.deck.push(firstCard);
      shuffleArray(this.deck);
      firstCard = this.drawFromDeck();
    }
    this.discardPile.push(firstCard);

    if (firstCard.color === 'wild') {
      // Random color for wild start
      this.currentColor = CARD_COLORS[Math.floor(Math.random() * 4)];
    } else {
      this.currentColor = firstCard.color;
    }

    // Random first player
    this.currentPlayerIndex = Math.floor(Math.random() * this.players.length);

    // Apply first card effect if it's an action card
    const startEffects = this.applyFirstCardEffect(firstCard);

    return { startEffects };
  }

  applyFirstCardEffect(card) {
    const effects = [];
    switch (card.value) {
      case 'skip':
        effects.push({ type: 'skip', playerId: this.getCurrentPlayer().id });
        this.advanceTurn();
        break;
      case 'reverse':
        this.direction *= -1;
        effects.push({ type: 'reverse' });
        if (this.players.length === 2) {
          this.advanceTurn();
        }
        break;
      case 'draw2': {
        const target = this.getCurrentPlayer();
        for (let i = 0; i < 2; i++) {
          target.hand.push(this.drawFromDeck());
        }
        effects.push({ type: 'draw2', playerId: target.id });
        this.advanceTurn();
        break;
      }
    }
    return effects;
  }

  drawFromDeck() {
    if (this.deck.length === 0) {
      this.recycleDeck();
    }
    return this.deck.pop();
  }

  recycleDeck() {
    if (this.discardPile.length <= 1) return;
    const topCard = this.discardPile.pop();
    this.deck = shuffleArray([...this.discardPile]);
    this.discardPile = [topCard];
  }

  getCurrentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  getNextPlayerIndex() {
    return (this.currentPlayerIndex + this.direction + this.players.length) % this.players.length;
  }

  getNextPlayer() {
    return this.players[this.getNextPlayerIndex()];
  }

  advanceTurn() {
    this.currentPlayerIndex = this.getNextPlayerIndex();
    this.drawnThisTurn = false;
    // Reset UNO state for previous players
  }

  playCard(playerId, cardId, chosenColor = null) {
    if (this.state !== 'playing') {
      return { error: 'ゲームが進行中ではありません' };
    }

    const currentPlayer = this.getCurrentPlayer();
    if (currentPlayer.id !== playerId) {
      return { error: 'あなたのターンではありません' };
    }

    const cardIndex = currentPlayer.hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) {
      return { error: 'そのカードは持っていません' };
    }

    const card = currentPlayer.hand[cardIndex];
    const topCard = this.discardPile[this.discardPile.length - 1];

    if (!canPlayOn(card, topCard, this.currentColor)) {
      return { error: 'そのカードは出せません' };
    }

    if (card.color === 'wild' && chosenColor) {
      if (!CARD_COLORS.includes(chosenColor)) {
        return { error: '無効な色です' };
      }
    }

    // Remove card from hand
    currentPlayer.hand.splice(cardIndex, 1);
    this.discardPile.push(card);

    // Update color
    if (card.color === 'wild') {
      this.currentColor = chosenColor || 'red';
    } else {
      this.currentColor = card.color;
    }

    const effects = [];

    // Check win
    if (currentPlayer.hand.length === 0) {
      this.state = 'finished';
      this.winnerId = currentPlayer.id;
      return {
        card,
        effects,
        gameOver: true,
        scores: this.calculateScores(),
      };
    }

    // Check UNO (down to 1 card without calling)
    if (currentPlayer.hand.length === 1 && !currentPlayer.calledUno) {
      effects.push({ type: 'uno-not-called', playerId: currentPlayer.id });
    }

    // Apply card effects
    switch (card.value) {
      case 'skip':
        effects.push({ type: 'skip', playerId: this.getNextPlayer().id });
        this.advanceTurn(); // skip next player
        break;

      case 'reverse':
        this.direction *= -1;
        effects.push({ type: 'reverse', direction: this.direction });
        if (this.players.length === 2) {
          this.advanceTurn(); // acts as skip in 2-player
        }
        break;

      case 'draw2': {
        const target = this.getNextPlayer();
        for (let i = 0; i < 2; i++) {
          target.hand.push(this.drawFromDeck());
        }
        effects.push({ type: 'draw2', playerId: target.id });
        this.advanceTurn(); // skip drawing player
        break;
      }

      case 'wild4': {
        const target = this.getNextPlayer();
        for (let i = 0; i < 4; i++) {
          target.hand.push(this.drawFromDeck());
        }
        effects.push({ type: 'wild4', playerId: target.id });
        this.advanceTurn(); // skip drawing player
        break;
      }
    }

    // Advance to next player's turn
    this.advanceTurn();

    // Only reset calledUno if player has more than 1 card
    // (keep it if they have 1 card so challenge can check it)
    if (currentPlayer.hand.length !== 1) {
      currentPlayer.calledUno = false;
    }

    return {
      card,
      effects,
      gameOver: false,
    };
  }

  drawCard(playerId) {
    if (this.state !== 'playing') {
      return { error: 'ゲームが進行中ではありません' };
    }

    const currentPlayer = this.getCurrentPlayer();
    if (currentPlayer.id !== playerId) {
      return { error: 'あなたのターンではありません' };
    }

    if (this.drawnThisTurn) {
      return { error: 'このターンは既にカードを引いています' };
    }

    // Keep drawing until a playable card is found
    const topCard = this.discardPile[this.discardPile.length - 1];
    const drawnCards = [];
    let playableCard = null;

    // Safety limit to prevent infinite loop (max 50 cards)
    const maxDraw = Math.min(50, this.deck.length + this.discardPile.length - 1);
    for (let i = 0; i < maxDraw; i++) {
      if (this.deck.length === 0 && this.discardPile.length <= 1) break;
      const card = this.drawFromDeck();
      currentPlayer.hand.push(card);
      drawnCards.push(card);
      if (canPlayOn(card, topCard, this.currentColor)) {
        playableCard = card;
        break;
      }
    }

    this.drawnThisTurn = true;

    // If no playable card found (deck exhausted), auto-pass
    if (!playableCard) {
      this.advanceTurn();
    }

    return {
      drawnCards,
      playableCard,
      drawCount: drawnCards.length,
      autoPassed: !playableCard,
    };
  }

  passTurn(playerId) {
    if (this.state !== 'playing') {
      return { error: 'ゲームが進行中ではありません' };
    }

    const currentPlayer = this.getCurrentPlayer();
    if (currentPlayer.id !== playerId) {
      return { error: 'あなたのターンではありません' };
    }

    if (!this.drawnThisTurn) {
      return { error: 'まずカードを引いてください' };
    }

    this.advanceTurn();
    return { success: true };
  }

  callUno(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return { error: 'プレイヤーが見つかりません' };

    if (player.hand.length <= 2) {
      player.calledUno = true;
      return { success: true, playerId };
    }

    return { error: 'UNOを宣言できません' };
  }

  challengeUno(challengerId, targetPlayerId) {
    const target = this.players.find(p => p.id === targetPlayerId);
    if (!target) return { error: 'プレイヤーが見つかりません' };

    if (target.hand.length === 1 && !target.calledUno) {
      // Penalty: draw 2 cards
      const drawn = [];
      for (let i = 0; i < 2; i++) {
        const c = this.drawFromDeck();
        target.hand.push(c);
        drawn.push(c);
      }
      target.calledUno = false;
      return {
        success: true,
        targetPlayerId,
        cards: drawn,
      };
    }

    return { success: false };
  }

  calculateScores() {
    let winnerScore = 0;
    const breakdown = [];

    for (const player of this.players) {
      if (player.id === this.winnerId) continue;
      let penalty = 0;
      for (const card of player.hand) {
        penalty += getCardPoints(card);
      }
      winnerScore += penalty;
      breakdown.push({
        playerId: player.id,
        name: player.name,
        penalty,
        cardsLeft: player.hand.length,
      });
    }

    const winner = this.players.find(p => p.id === this.winnerId);
    return {
      winnerId: this.winnerId,
      winnerName: winner.name,
      winnerScore,
      breakdown,
    };
  }

  getStateForPlayer(playerId) {
    const player = this.players.find(p => p.id === playerId);
    const topCard = this.discardPile[this.discardPile.length - 1];
    const currentPlayer = this.getCurrentPlayer();

    return {
      myHand: player ? player.hand : [],
      myId: playerId,
      players: this.players.map(p => ({
        ...p.toPublic(),
        isCurrentTurn: p.id === currentPlayer.id,
      })),
      topCard,
      currentColor: this.currentColor,
      direction: this.direction,
      myTurn: currentPlayer.id === playerId,
      state: this.state,
      canDraw: currentPlayer.id === playerId && !this.drawnThisTurn,
      canPass: false, // No longer needed - draw until playable
      drawPileCount: this.deck.length,
    };
  }
}

module.exports = GameManager;
