const CARD_COLORS = ['red', 'blue', 'green', 'yellow'];

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createDeck() {
  const deck = [];
  let idx = 0;

  for (const color of CARD_COLORS) {
    // One 0 card per color
    deck.push({ id: `${color}-0-${idx++}`, color, value: '0' });

    // Two each of 1-9
    for (let n = 1; n <= 9; n++) {
      deck.push({ id: `${color}-${n}-${idx++}`, color, value: String(n) });
      deck.push({ id: `${color}-${n}-${idx++}`, color, value: String(n) });
    }

    // Two each of action cards
    for (const action of ['skip', 'reverse', 'draw2']) {
      deck.push({ id: `${color}-${action}-${idx++}`, color, value: action });
      deck.push({ id: `${color}-${action}-${idx++}`, color, value: action });
    }
  }

  // 4 Wild cards
  for (let i = 0; i < 4; i++) {
    deck.push({ id: `wild-wild-${idx++}`, color: 'wild', value: 'wild' });
  }

  // 4 Wild Draw Four cards
  for (let i = 0; i < 4; i++) {
    deck.push({ id: `wild-wild4-${idx++}`, color: 'wild', value: 'wild4' });
  }

  return shuffleArray(deck);
}

function canPlayOn(card, topCard, currentColor) {
  // Wild cards can always be played
  if (card.color === 'wild') return true;
  // Match by current color
  if (card.color === currentColor) return true;
  // Match by value
  if (card.value === topCard.value) return true;
  return false;
}

function getCardPoints(card) {
  if (card.color === 'wild') return 50;
  if (['skip', 'reverse', 'draw2'].includes(card.value)) return 20;
  return parseInt(card.value);
}

module.exports = { CARD_COLORS, shuffleArray, createDeck, canPlayOn, getCardPoints };
