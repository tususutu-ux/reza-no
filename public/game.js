(function () {
  'use strict';

  // === State ===
  let socket = null;
  let myId = null;
  let myHand = [];
  let roomCode = null;
  let isHost = false;
  let gameState = null;
  let pendingWildCardId = null;

  // === Card Display ===
  const VALUE_DISPLAY = {
    '0': '0', '1': '1', '2': '2', '3': '3', '4': '4',
    '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
    'skip': '⊘', 'reverse': '⟳', 'draw2': '+2',
    'wild': 'W', 'wild4': '+4',
  };

  const VALUE_LABEL = {
    'skip': 'スキップ', 'reverse': 'リバース', 'draw2': 'ドロー2',
    'wild': 'ワイルド', 'wild4': 'ワイルド+4',
  };

  const COLOR_NAMES = {
    'red': '赤', 'blue': '青', 'green': '緑', 'yellow': '黄',
  };

  // === DOM Elements ===
  const $ = (id) => document.getElementById(id);

  // Screens
  const lobbyScreen = $('lobby-screen');
  const gameScreen = $('game-screen');
  const resultScreen = $('result-screen');

  // Lobby
  const playerNameInput = $('player-name');
  const roomCodeInput = $('room-code-input');
  const btnCreate = $('btn-create');
  const btnJoin = $('btn-join');
  const lobbyMenu = $('lobby-menu');
  const lobbyRoom = $('lobby-room');
  const roomCodeDisplay = $('room-code-display');
  const btnCopy = $('btn-copy');
  const playerList = $('player-list');
  const btnStart = $('btn-start');
  const btnLeave = $('btn-leave');
  const waitingMsg = $('waiting-msg');

  // Game
  const opponentsArea = $('opponents-area');
  const directionIndicator = $('direction-indicator');
  const directionArrow = $('direction-arrow');
  const currentColorIndicator = $('current-color-indicator');
  const deckCount = $('deck-count');
  const drawPile = $('draw-pile');
  const topCardEl = $('top-card');
  const myHandEl = $('my-hand');
  const btnUno = $('btn-uno');
  const btnPass = $('btn-pass');
  const colorPicker = $('color-picker');
  const turnIndicator = $('turn-indicator');
  const unoChallenge = $('uno-challenge');
  const notifications = $('notifications');

  // Result
  const resultTitle = $('result-title');
  const resultScores = $('result-scores');
  const btnPlayAgain = $('btn-play-again');
  const btnBackLobby = $('btn-back-lobby');

  // Error
  const errorToast = $('error-toast');

  // === Screen Management ===
  function showScreen(screen) {
    [lobbyScreen, gameScreen, resultScreen].forEach(s => {
      s.classList.remove('active');
      s.classList.add('hidden');
    });
    screen.classList.remove('hidden');
    screen.classList.add('active');
  }

  // === Socket Connection ===
  function connectSocket() {
    socket = io();

    // Room events
    socket.on('room-created', onRoomCreated);
    socket.on('room-joined', onRoomJoined);
    socket.on('player-joined', onPlayerJoined);
    socket.on('player-left', onPlayerLeft);

    // Game events
    socket.on('game-started', onGameStarted);
    socket.on('game-state', onGameState);
    socket.on('card-played', onCardPlayed);
    socket.on('card-drawn', onCardDrawn);
    socket.on('your-draw', onYourDraw);
    socket.on('uno-called', onUnoCalled);
    socket.on('uno-penalty', onUnoPenalty);
    socket.on('game-over', onGameOver);
    socket.on('player-disconnected', onPlayerDisconnected);
    socket.on('player-reconnected', onPlayerReconnected);

    socket.on('error', onError);

    socket.on('disconnect', () => {
      showNotification('接続が切れました...', 'skip');
    });

    socket.on('connect', () => {
      // Attempt reconnection
      const savedRoom = sessionStorage.getItem('roomCode');
      const savedId = sessionStorage.getItem('playerId');
      if (savedRoom && savedId) {
        myId = savedId;
        roomCode = savedRoom;
        socket.emit('reconnect-player', { roomCode: savedRoom, playerId: savedId });
      }
    });
  }

  // === Lobby Handlers ===
  function onRoomCreated({ roomCode: code, playerId }) {
    myId = playerId;
    roomCode = code;
    isHost = true;
    sessionStorage.setItem('roomCode', code);
    sessionStorage.setItem('playerId', playerId);

    roomCodeDisplay.textContent = code;
    lobbyMenu.classList.add('hidden');
    lobbyRoom.classList.remove('hidden');
    btnStart.classList.remove('hidden');
    updatePlayerList([{ name: playerNameInput.value.trim(), id: playerId, isHost: true }]);
  }

  function onRoomJoined({ roomCode: code, playerId, players }) {
    myId = playerId;
    roomCode = code;
    sessionStorage.setItem('roomCode', code);
    sessionStorage.setItem('playerId', playerId);

    // Check if I'm the host
    const me = players.find(p => p.id === playerId);
    isHost = me ? me.isHost : false;

    roomCodeDisplay.textContent = code;
    lobbyMenu.classList.add('hidden');
    lobbyRoom.classList.remove('hidden');
    if (isHost) btnStart.classList.remove('hidden');
    else btnStart.classList.add('hidden');
    updatePlayerList(players);
  }

  function onPlayerJoined({ players }) {
    updatePlayerList(players);
  }

  function onPlayerLeft({ players }) {
    updatePlayerList(players);
  }

  function updatePlayerList(players) {
    playerList.innerHTML = '';
    players.forEach(p => {
      const tag = document.createElement('div');
      tag.className = 'player-tag' + (p.isHost ? ' host' : '');
      tag.textContent = p.name + (p.isHost ? ' (ホスト)' : '');
      playerList.appendChild(tag);
    });

    if (players.length >= 2) {
      waitingMsg.textContent = `${players.length}人参加中`;
    } else {
      waitingMsg.textContent = 'プレイヤーを待っています...';
    }
  }

  // === Game Handlers ===
  function onGameStarted(state) {
    gameState = state;
    myHand = state.myHand;
    showScreen(gameScreen);
    renderGameState(state);
    if (state.myTurn) {
      showTurnIndicator('あなたのターンです！');
    }
  }

  function onGameState(state) {
    gameState = state;
    myHand = state.myHand;
    renderGameState(state);
    // Always show turn indicator when it's my turn
    if (state.myTurn) {
      showTurnIndicator('あなたのターンです！');
    }
  }

  function onCardPlayed({ playerId, card, effects, currentColor, direction }) {
    // Show effects
    effects.forEach(effect => {
      switch (effect.type) {
        case 'skip': {
          const p = gameState?.players.find(pl => pl.id === effect.playerId);
          showNotification(`${p?.name || '?'} スキップ！`, 'skip');
          break;
        }
        case 'reverse':
          showNotification('リバース！', 'reverse');
          break;
        case 'draw2': {
          const p = gameState?.players.find(pl => pl.id === effect.playerId);
          showNotification(`${p?.name || '?'} +2！`, 'draw');
          break;
        }
        case 'wild4': {
          const p = gameState?.players.find(pl => pl.id === effect.playerId);
          showNotification(`${p?.name || '?'} +4！`, 'draw');
          break;
        }
        case 'uno-not-called': {
          // Show challenge button for others
          if (effect.playerId !== myId) {
            showUnoChallenge(effect.playerId);
          }
          break;
        }
      }
    });
  }

  function onCardDrawn({ playerId }) {
    if (playerId !== myId) {
      const p = gameState?.players.find(pl => pl.id === playerId);
      // Subtle notification (optional)
    }
  }

  function onYourDraw({ card, canPlay }) {
    if (canPlay) {
      showNotification('引いたカードが出せます！', 'draw');
    }
  }

  function onUnoCalled({ playerId, playerName }) {
    showNotification(`${playerName} UNO！`, 'uno');
  }

  function onUnoPenalty({ targetPlayerId, cardCount }) {
    const p = gameState?.players.find(pl => pl.id === targetPlayerId);
    showNotification(`${p?.name || '?'} ペナルティ +${cardCount}！`, 'skip');
  }

  function onGameOver(scores) {
    showScreen(resultScreen);

    const isWinner = scores.winnerId === myId;
    resultTitle.textContent = isWinner ? '🎉 あなたの勝ち！' : `${scores.winnerName} さんの勝ち！`;

    resultScores.innerHTML = '';

    // Winner row
    const winnerRow = document.createElement('div');
    winnerRow.className = 'score-row winner';
    winnerRow.innerHTML = `<span>👑 ${scores.winnerName}</span><span>+${scores.winnerScore}点</span>`;
    resultScores.appendChild(winnerRow);

    // Other players
    scores.breakdown.forEach(entry => {
      const row = document.createElement('div');
      row.className = 'score-row';
      row.innerHTML = `<span>${entry.name} (残り${entry.cardsLeft}枚)</span><span>-${entry.penalty}点</span>`;
      resultScores.appendChild(row);
    });

    if (isWinner) spawnConfetti();

    // Show play again button only for host
    if (isHost) {
      btnPlayAgain.classList.remove('hidden');
    } else {
      btnPlayAgain.classList.add('hidden');
    }
  }

  function onPlayerDisconnected({ playerName }) {
    showNotification(`${playerName} 接続切断`, 'skip');
  }

  function onPlayerReconnected({ playerName }) {
    showNotification(`${playerName} 再接続`, 'draw');
  }

  function onError({ message }) {
    showError(message);
  }

  // === Rendering ===
  function renderGameState(state) {
    renderOpponents(state.players);
    renderTopCard(state.topCard, state.currentColor);
    renderHand(state.myHand, state);
    updateGameInfo(state);
    updateActionButtons(state);
  }

  function renderOpponents(players) {
    opponentsArea.innerHTML = '';
    players.forEach(p => {
      if (p.id === myId) return;

      const div = document.createElement('div');
      div.className = 'opponent' +
        (p.isCurrentTurn ? ' current-turn' : '') +
        (!p.connected ? ' disconnected' : '');

      let html = `<div class="opponent-name">${escapeHtml(p.name)}</div>`;
      html += '<div class="opponent-cards">';
      const displayCount = Math.min(p.cardCount, 10);
      for (let i = 0; i < displayCount; i++) {
        html += '<div class="mini-card"></div>';
      }
      html += '</div>';
      html += `<div class="opponent-count">${p.cardCount}枚</div>`;
      if (p.calledUno && p.cardCount === 1) {
        html += '<div class="uno-badge">UNO</div>';
      }

      div.innerHTML = html;
      opponentsArea.appendChild(div);
    });
  }

  function renderTopCard(card, currentColor) {
    if (!card) return;
    topCardEl.className = 'card ' + (card.color === 'wild' ? currentColor : card.color);
    topCardEl.innerHTML = `
      <span class="card-corner">${VALUE_DISPLAY[card.value] || card.value}</span>
      <span class="card-value">${VALUE_DISPLAY[card.value] || card.value}</span>
      ${VALUE_LABEL[card.value] ? `<span class="card-label">${VALUE_LABEL[card.value]}</span>` : ''}
    `;
  }

  function renderHand(cards, state) {
    myHandEl.innerHTML = '';
    const topCard = state.topCard;
    const currentColor = state.currentColor;

    cards.forEach(card => {
      const el = document.createElement('div');
      const playable = state.myTurn && canPlayOn(card, topCard, currentColor);
      el.className = 'card ' + (card.color === 'wild' ? 'wild' : card.color) +
        (playable ? ' playable' : ' not-playable');
      el.innerHTML = `
        <span class="card-corner">${VALUE_DISPLAY[card.value] || card.value}</span>
        <span class="card-value">${VALUE_DISPLAY[card.value] || card.value}</span>
        ${VALUE_LABEL[card.value] ? `<span class="card-label">${VALUE_LABEL[card.value]}</span>` : ''}
      `;

      if (playable) {
        el.addEventListener('click', () => onCardClick(card));
      }

      myHandEl.appendChild(el);
    });
  }

  function canPlayOn(card, topCard, currentColor) {
    if (card.color === 'wild') return true;
    if (card.color === currentColor) return true;
    if (card.value === topCard.value) return true;
    return false;
  }

  function updateGameInfo(state) {
    // Direction
    if (state.direction === -1) {
      directionIndicator.classList.add('reversed');
    } else {
      directionIndicator.classList.remove('reversed');
    }

    // Current color
    const colorMap = { red: '#ef4444', blue: '#3b82f6', green: '#22c55e', yellow: '#eab308' };
    currentColorIndicator.style.backgroundColor = colorMap[state.currentColor] || '#666';

    // Deck count - update badge and stack visibility
    const badge = $('draw-pile-count');
    if (badge) badge.textContent = state.drawPileCount;
    const drawStack = $('draw-pile');
    if (drawStack) {
      if (state.drawPileCount <= 10) {
        drawStack.classList.add('draw-pile-low');
      } else {
        drawStack.classList.remove('draw-pile-low');
      }
      // Hide extra stack cards when deck is low
      const stackCards = drawStack.querySelectorAll('.stack-card');
      if (stackCards.length >= 4) {
        stackCards[0].style.display = state.drawPileCount > 20 ? '' : 'none';
        stackCards[1].style.display = state.drawPileCount > 10 ? '' : 'none';
        stackCards[2].style.display = state.drawPileCount > 5 ? '' : 'none';
      }
    }
    deckCount.textContent = `${state.drawPileCount}枚`;

    // Turn indicator
    if (state.myTurn) {
      showTurnIndicator('あなたのターンです！');
    }
  }

  function updateActionButtons(state) {
    // UNO button
    btnUno.disabled = !(state.myTurn && myHand.length === 2);

    // Pass button
    if (state.canPass) {
      btnPass.classList.remove('hidden');
    } else {
      btnPass.classList.add('hidden');
    }

    // Draw pile
    if (state.myTurn && state.canDraw) {
      drawPile.style.opacity = '1';
      drawPile.style.cursor = 'pointer';
    } else {
      drawPile.style.opacity = '0.5';
      drawPile.style.cursor = 'default';
    }
  }

  // === Game Actions ===
  function onCardClick(card) {
    if (!gameState || !gameState.myTurn) return;

    if (card.color === 'wild') {
      // Show color picker
      pendingWildCardId = card.id;
      colorPicker.classList.remove('hidden');
    } else {
      socket.emit('play-card', { roomCode, cardId: card.id });
    }
  }

  function onColorChosen(color) {
    colorPicker.classList.add('hidden');
    if (pendingWildCardId) {
      socket.emit('play-card', { roomCode, cardId: pendingWildCardId, chosenColor: color });
      pendingWildCardId = null;
    }
  }

  function showUnoChallenge(targetPlayerId) {
    unoChallenge.classList.remove('hidden');
    unoChallenge.innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = 'UNOチャレンジ！';
    btn.addEventListener('click', () => {
      socket.emit('challenge-uno', { roomCode, targetPlayerId });
      unoChallenge.classList.add('hidden');
    });
    unoChallenge.appendChild(btn);

    // Auto-hide after 5 seconds
    setTimeout(() => {
      unoChallenge.classList.add('hidden');
    }, 5000);
  }

  // === UI Helpers ===
  function showTurnIndicator(text) {
    turnIndicator.textContent = text;
    turnIndicator.classList.remove('hidden');
    setTimeout(() => {
      turnIndicator.classList.add('hidden');
    }, 2000);
  }

  function showNotification(text, type = '') {
    const el = document.createElement('div');
    el.className = 'notification ' + type;
    el.textContent = text;
    notifications.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  function showError(message) {
    errorToast.textContent = message;
    errorToast.classList.remove('hidden');
    setTimeout(() => errorToast.classList.add('hidden'), 3000);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function spawnConfetti() {
    const container = $('confetti');
    container.innerHTML = '';
    const colors = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#8b5cf6', '#f97316'];
    for (let i = 0; i < 60; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + '%';
      piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDuration = (2 + Math.random() * 3) + 's';
      piece.style.animationDelay = Math.random() * 2 + 's';
      piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
      piece.style.width = (6 + Math.random() * 8) + 'px';
      piece.style.height = (6 + Math.random() * 8) + 'px';
      container.appendChild(piece);
    }
  }

  // === Event Listeners ===
  function setupUIListeners() {
    btnCreate.addEventListener('click', () => {
      const name = playerNameInput.value.trim();
      if (!name) return showError('名前を入力してください');
      socket.emit('create-room', { playerName: name });
    });

    btnJoin.addEventListener('click', () => {
      const name = playerNameInput.value.trim();
      const code = roomCodeInput.value.trim().toUpperCase();
      if (!name) return showError('名前を入力してください');
      if (!code) return showError('ルームコードを入力してください');
      socket.emit('join-room', { roomCode: code, playerName: name });
    });

    btnCopy.addEventListener('click', () => {
      navigator.clipboard.writeText(roomCodeDisplay.textContent).then(() => {
        btnCopy.textContent = '✓';
        setTimeout(() => btnCopy.textContent = '📋', 1500);
      });
    });

    btnStart.addEventListener('click', () => {
      socket.emit('start-game', { roomCode });
    });

    btnLeave.addEventListener('click', () => {
      socket.emit('leave-room');
      sessionStorage.removeItem('roomCode');
      sessionStorage.removeItem('playerId');
      roomCode = null;
      myId = null;
      isHost = false;
      lobbyRoom.classList.add('hidden');
      lobbyMenu.classList.remove('hidden');
    });

    drawPile.addEventListener('click', () => {
      if (!gameState || !gameState.myTurn || !gameState.canDraw) return;
      socket.emit('draw-card', { roomCode });
    });

    btnUno.addEventListener('click', () => {
      if (!roomCode) return;
      socket.emit('call-uno', { roomCode });
    });

    btnPass.addEventListener('click', () => {
      if (!roomCode) return;
      socket.emit('pass-turn', { roomCode });
    });

    // Color picker buttons
    document.querySelectorAll('.color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        onColorChosen(btn.dataset.color);
      });
    });

    // Play again
    btnPlayAgain.addEventListener('click', () => {
      socket.emit('restart-game', { roomCode });
    });

    btnBackLobby.addEventListener('click', () => {
      showScreen(lobbyScreen);
      lobbyRoom.classList.add('hidden');
      lobbyMenu.classList.remove('hidden');
      sessionStorage.removeItem('roomCode');
      sessionStorage.removeItem('playerId');
    });

    // Enter key on inputs
    playerNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btnCreate.click();
    });

    roomCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btnJoin.click();
    });
  }

  // === Init ===
  function init() {
    connectSocket();
    setupUIListeners();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
