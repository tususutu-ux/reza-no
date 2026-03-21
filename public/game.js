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
  let selectedCards = []; // For multi-card play
  let totalRounds = 1;
  let currentRound = 0;
  let gameMode = 'normal';

  // === Stats ===
  const STATS_KEY = 'resano-stats';

  function loadStats() {
    try {
      const raw = localStorage.getItem(STATS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return null;
  }

  function saveStats(stats) {
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch (e) { /* ignore */ }
  }

  function updateStatsOnGameOver(playerName, isWinner, score) {
    let stats = loadStats() || { name: playerName, gamesPlayed: 0, wins: 0, totalScore: 0, bestScore: 0 };
    stats.name = playerName;
    stats.gamesPlayed++;
    if (isWinner) stats.wins++;
    stats.totalScore += score;
    if (score > stats.bestScore) stats.bestScore = score;
    saveStats(stats);
    return stats;
  }

  function renderStatsModal() {
    const body = document.getElementById('stats-body');
    const stats = loadStats();
    if (!stats || stats.gamesPlayed === 0) {
      body.innerHTML = '<div class="stats-empty">まだプレイしていません</div>';
      return;
    }
    const winRate = stats.gamesPlayed > 0 ? Math.round((stats.wins / stats.gamesPlayed) * 100) : 0;
    body.innerHTML = `
      <div class="stats-name">${escapeHtml(stats.name)} さんの成績</div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${stats.gamesPlayed}</div>
          <div class="stat-label">プレイ回数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.wins}</div>
          <div class="stat-label">勝利数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${winRate}%</div>
          <div class="stat-label">勝率</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.bestScore}</div>
          <div class="stat-label">最高スコア</div>
        </div>
        <div class="stat-card wide">
          <div class="stat-value">${stats.totalScore}</div>
          <div class="stat-label">累計スコア</div>
        </div>
      </div>
      <div class="stats-reset-row">
        <button class="btn-stats-reset" id="btn-stats-reset">成績をリセット</button>
      </div>
    `;
    const resetBtn = document.getElementById('btn-stats-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (confirm('成績をリセットしますか？')) {
          localStorage.removeItem(STATS_KEY);
          renderStatsModal();
        }
      });
    }
  }

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
    socket.on('chat-message', onChatMessage);
    socket.on('ball-thrown', onBallThrown);
    socket.on('cat-event', onCatEvent);

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
  function showLobbySettings() {
    const roundSettings = $('round-settings');
    const rulesBox = $('rules-box');
    const modeSettings = $('mode-settings');
    if (isHost) {
      if (roundSettings) roundSettings.classList.remove('hidden');
      if (modeSettings) modeSettings.classList.remove('hidden');
    }
    if (rulesBox) rulesBox.classList.remove('hidden');
  }

  function onRoomCreated({ roomCode: code, playerId }) {
    myId = playerId;
    roomCode = code;
    isHost = true;
    currentRound = 0;
    sessionStorage.setItem('roomCode', code);
    sessionStorage.setItem('playerId', playerId);

    roomCodeDisplay.textContent = code;
    lobbyMenu.classList.add('hidden');
    lobbyRoom.classList.remove('hidden');
    btnStart.classList.remove('hidden');
    showLobbySettings();
    updatePlayerList([{ name: playerNameInput.value.trim(), id: playerId, isHost: true }]);
  }

  function onRoomJoined({ roomCode: code, playerId, players }) {
    myId = playerId;
    roomCode = code;
    currentRound = 0;
    sessionStorage.setItem('roomCode', code);
    sessionStorage.setItem('playerId', playerId);

    const me = players.find(p => p.id === playerId);
    isHost = me ? me.isHost : false;

    roomCodeDisplay.textContent = code;
    lobbyMenu.classList.add('hidden');
    lobbyRoom.classList.remove('hidden');
    if (isHost) btnStart.classList.remove('hidden');
    else btnStart.classList.add('hidden');
    showLobbySettings();
    updatePlayerList(players);
  }

  function onPlayerJoined({ players }) {
    updatePlayerList(players);
  }

  function onPlayerLeft({ players, youAreHost }) {
    if (youAreHost !== undefined) {
      isHost = youAreHost;
      if (isHost) {
        btnStart.classList.remove('hidden');
        const roundSettings = $('round-settings');
        if (roundSettings) roundSettings.classList.remove('hidden');
      }
    }
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
    currentRound++;
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
    // Clear multi-select when state changes (new turn)
    if (!state.myTurn) selectedCards = [];
    renderGameState(state);
    if (state.myTurn) {
      if (state.pendingDrawCount > 0) {
        const stackType = state.pendingDrawType === 'draw2' ? '+2' : '+4';
        if (state.canStackDraw) {
          showTurnIndicator(`${stackType}を出すか ${state.pendingDrawCount}枚引く！`);
        } else {
          // Auto-draw after a short delay so player sees what happened
          showTurnIndicator(`${state.pendingDrawCount}枚引きます...`);
          setTimeout(() => {
            if (gameState && gameState.myTurn && gameState.pendingDrawCount > 0 && !gameState.canStackDraw) {
              socket.emit('draw-card', { roomCode });
            }
          }, 1500);
        }
      } else {
        showTurnIndicator('あなたのターンです！');
      }
    }
  }

  function onCardPlayed({ playerId, card, effects, currentColor, direction, multiPlay }) {
    if (multiPlay && multiPlay > 1) {
      const p = gameState?.players.find(pl => pl.id === playerId);
      showNotification(`${p?.name || '?'} ${multiPlay}枚重ね出し！`, 'draw');
    }
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
        case 'draw2-stacked': {
          showNotification(`+2 スタック！ 合計${effect.count}枚！`, 'draw');
          break;
        }
        case 'wild4-stacked': {
          showNotification(`+4 スタック！ 合計${effect.count}枚！`, 'draw');
          break;
        }
        case 'wild4': {
          const p = gameState?.players.find(pl => pl.id === effect.playerId);
          showNotification(`${p?.name || '?'} +4！`, 'draw');
          break;
        }
        case 'multi-play': {
          showNotification(`${effect.count}枚重ね出し！`, 'draw');
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

  function onCardDrawn({ playerId, drawCount }) {
    if (playerId !== myId) {
      const p = gameState?.players.find(pl => pl.id === playerId);
      if (drawCount > 1) {
        // Show counting animation for other player's draw
        showDrawCounting(`${p?.name || '?'} カード探し中...`, drawCount, false);
      }
    }
  }

  function onYourDraw({ drawnCards, playableCard, drawCount, wasPenalty, penaltyCount }) {
    if (wasPenalty) {
      showDrawCounting('ペナルティ！', penaltyCount, true);
    } else if (drawCount > 1) {
      // Show 1-by-1 counting animation
      showDrawCounting('出せるカードを探し中...', drawCount, false, playableCard);
    } else if (drawCount === 1 && playableCard) {
      showNotification('出せるカードが来た！', 'draw');
    }
  }

  function showDrawCounting(title, totalCards, isPenalty, foundPlayable) {
    // Create or reuse draw counter overlay
    let overlay = $('draw-counter-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'draw-counter-overlay';
      overlay.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:110;pointer-events:none;text-align:center;';
      document.getElementById('game-screen').appendChild(overlay);
    }

    overlay.innerHTML = `
      <div style="background:rgba(0,0,0,0.85);color:white;padding:16px 32px;border-radius:16px;font-weight:800;min-width:200px;">
        <div style="font-size:14px;margin-bottom:8px;opacity:0.8;">${title}</div>
        <div id="draw-counter-num" style="font-size:48px;color:#f472b6;">0</div>
        <div style="font-size:12px;margin-top:4px;opacity:0.6;">枚引いた</div>
      </div>
    `;
    overlay.style.display = 'block';

    const counterEl = document.getElementById('draw-counter-num');
    let count = 0;
    const interval = Math.min(500, Math.max(200, 2000 / totalCards)); // Adaptive speed

    const timer = setInterval(() => {
      count++;
      if (counterEl) {
        counterEl.textContent = count;
        counterEl.style.transform = 'scale(1.3)';
        setTimeout(() => { if (counterEl) counterEl.style.transform = 'scale(1)'; }, 100);
      }

      if (count >= totalCards) {
        clearInterval(timer);
        // Show final message
        setTimeout(() => {
          if (counterEl) {
            if (isPenalty) {
              counterEl.style.color = '#ef4444';
            } else if (foundPlayable) {
              counterEl.style.color = '#22c55e';
              const parent = counterEl.parentElement;
              if (parent) {
                const msg = document.createElement('div');
                msg.style.cssText = 'font-size:16px;color:#22c55e;margin-top:8px;font-weight:800;';
                msg.textContent = '出せるカード来た！';
                parent.appendChild(msg);
              }
            }
          }
          // Hide after a moment
          setTimeout(() => { overlay.style.display = 'none'; }, 1200);
        }, 300);
      }
    }, interval);
  }

  function onUnoCalled({ playerId, playerName }) {
    showNotification(`${playerName} UNO！`, 'uno');
  }

  function onUnoPenalty({ targetPlayerId, cardCount }) {
    const p = gameState?.players.find(pl => pl.id === targetPlayerId);
    const isMe = targetPlayerId === myId;
    if (isMe) {
      showNotification('UNO忘れた！ペナルティ +2枚！', 'skip');
    } else {
      showNotification(`${p?.name || '?'} UNO忘れ！+${cardCount}枚ペナルティ！`, 'skip');
    }
  }

  function onGameOver(scores) {
    showScreen(resultScreen);

    const isLastRound = currentRound >= totalRounds;
    const isWinner = scores.winnerId === myId;

    if (isLastRound && totalRounds > 1) {
      // Final results - show total scores
      resultTitle.textContent = `全${totalRounds}ラウンド終了！`;
    } else if (totalRounds > 1) {
      resultTitle.textContent = `ラウンド ${currentRound}/${totalRounds} - ${scores.winnerName} の勝ち！`;
    } else {
      resultTitle.textContent = isWinner ? '🎉 あなたの勝ち！' : `${scores.winnerName} さんの勝ち！`;
    }

    resultScores.innerHTML = '';

    if (totalRounds > 1 && scores.totalScores) {
      // Show round result header
      const roundHeader = document.createElement('div');
      roundHeader.className = 'score-row';
      roundHeader.style.background = 'transparent';
      roundHeader.style.boxShadow = 'none';
      roundHeader.style.fontWeight = '700';
      roundHeader.style.fontSize = '13px';
      roundHeader.innerHTML = `<span>このラウンド: ${scores.winnerName} +${scores.winnerScore}点</span>`;
      resultScores.appendChild(roundHeader);

      // Show cumulative scores sorted by total
      const sortedPlayers = Object.entries(scores.totalScores)
        .map(([id, total]) => {
          const name = id === scores.winnerId ? scores.winnerName
            : scores.breakdown.find(b => b.playerId === id)?.name
            || gameState?.players.find(p => p.id === id)?.name || '?';
          return { id, name, total };
        })
        .sort((a, b) => b.total - a.total);

      sortedPlayers.forEach((entry, i) => {
        const row = document.createElement('div');
        row.className = 'score-row' + (i === 0 ? ' winner' : '');
        const icon = i === 0 ? '👑 ' : '';
        row.innerHTML = `<span>${icon}${entry.name}</span><span>${entry.total}点</span>`;
        resultScores.appendChild(row);
      });
    } else {
      // Single round - show as before
      const winnerRow = document.createElement('div');
      winnerRow.className = 'score-row winner';
      winnerRow.innerHTML = `<span>👑 ${scores.winnerName}</span><span>+${scores.winnerScore}点</span>`;
      resultScores.appendChild(winnerRow);

      scores.breakdown.forEach(entry => {
        const row = document.createElement('div');
        row.className = 'score-row';
        row.innerHTML = `<span>${entry.name} (残り${entry.cardsLeft}枚)</span><span>+0点</span>`;
        resultScores.appendChild(row);
      });
    }

    if (isWinner || (isLastRound && totalRounds > 1)) spawnConfetti();

    // Save stats to localStorage
    const playerName = playerNameInput.value.trim() || 'Player';
    const myScore = isWinner ? scores.winnerScore : 0;
    updateStatsOnGameOver(playerName, isWinner, myScore);

    // Show play again / next round button
    if (isHost) {
      btnPlayAgain.classList.remove('hidden');
      btnPlayAgain.textContent = isLastRound ? 'もう一回' : `次のラウンドへ (${currentRound}/${totalRounds})`;
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

  function onChatMessage({ playerName, message, isStamp }) {
    const chatArea = $('chat-area');
    if (!chatArea) return;
    const bubble = document.createElement('div');
    if (isStamp) {
      bubble.className = 'chat-bubble stamp';
      bubble.textContent = message;
    } else {
      bubble.className = 'chat-bubble';
      bubble.innerHTML = `<span class="chat-name">${escapeHtml(playerName)}</span>${escapeHtml(message)}`;
    }
    chatArea.appendChild(bubble);
    setTimeout(() => bubble.remove(), isStamp ? 3500 : 8500);
    while (chatArea.children.length > 10) {
      chatArea.removeChild(chatArea.firstChild);
    }
  }

  function onBallThrown({ throwerId, throwerName, targetPlayerId, targetName, swappedCount }) {
    const isTarget = targetPlayerId === myId;

    // Show notification
    if (isTarget) {
      showNotification(`🎳 ${throwerName} があなたにボールを投げた！手札シャッフル！`, 'skip');
    } else {
      showNotification(`🎳 ${throwerName} → ${targetName} ボール！手札シャッフル！`, 'draw');
    }

    // Show ball animation
    const ballAnim = $('ball-animation');
    if (ballAnim) {
      ballAnim.classList.remove('hidden');
      setTimeout(() => ballAnim.classList.add('hidden'), 1200);
    }

    // Add shuffling animation to target opponent
    setTimeout(() => {
      const opponents = document.querySelectorAll('.opponent');
      opponents.forEach(opp => {
        const nameEl = opp.querySelector('.opponent-name');
        if (nameEl && nameEl.textContent === targetName) {
          opp.classList.add('shuffling');
          setTimeout(() => opp.classList.remove('shuffling'), 1500);
        }
      });
    }, 600);
  }

  function onCatEvent() {
    const catOverlay = $('cat-overlay');
    if (catOverlay) {
      catOverlay.classList.remove('hidden');

      // Add shuffle animation to own hand
      const handEl = $('my-hand');
      if (handEl) {
        handEl.classList.add('cat-shuffle');
        setTimeout(() => handEl.classList.remove('cat-shuffle'), 2000);
      }

      // Add shuffling to all opponents
      document.querySelectorAll('.opponent').forEach(opp => {
        opp.classList.add('shuffling');
        setTimeout(() => opp.classList.remove('shuffling'), 2000);
      });

      // Hide overlay after animation
      setTimeout(() => {
        catOverlay.classList.add('hidden');
      }, 2500);
    }
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

    // Count how many of each value we have (for multi-play indicator)
    const valueCounts = {};
    cards.forEach(c => {
      valueCounts[c.value] = (valueCounts[c.value] || 0) + 1;
    });

    // Check which values have at least one playable card
    const playableValues = new Set();
    cards.forEach(card => {
      let p;
      if (state.pendingDrawCount > 0) {
        p = state.myTurn && card.value === state.pendingDrawType;
      } else {
        p = state.myTurn && canPlayOn(card, topCard, currentColor);
      }
      if (p) playableValues.add(card.value);
    });

    cards.forEach(card => {
      const el = document.createElement('div');
      let playable;

      const isAction = ['skip', 'reverse', 'draw2', 'wild', 'wild4'].includes(card.value);

      if (state.pendingDrawCount > 0) {
        playable = state.myTurn && card.value === state.pendingDrawType;
      } else {
        playable = state.myTurn && (canPlayOn(card, topCard, currentColor) || (playableValues.has(card.value) && valueCounts[card.value] >= 2));
      }

      // Can't finish with action cards
      if (playable && cards.length === 1 && isAction) {
        playable = false;
      }

      const isSelected = selectedCards.includes(card.id);
      const canMulti = playable && valueCounts[card.value] >= 2;

      el.className = 'card ' + (card.color === 'wild' ? 'wild' : card.color) +
        (playable ? ' playable' : ' not-playable') +
        (isSelected ? ' selected' : '') +
        (canMulti ? ' multi-able' : '');
      el.dataset.cardId = card.id;
      el.innerHTML = `
        <span class="card-corner">${VALUE_DISPLAY[card.value] || card.value}</span>
        <span class="card-value">${VALUE_DISPLAY[card.value] || card.value}</span>
        ${VALUE_LABEL[card.value] ? `<span class="card-label">${VALUE_LABEL[card.value]}</span>` : ''}
        ${canMulti && !isSelected ? '<span class="multi-badge">×' + valueCounts[card.value] + '</span>' : ''}
        ${isSelected ? '<span class="selected-badge">✓</span>' : ''}
      `;

      if (playable) {
        el.addEventListener('click', () => onCardClick(card));
      }

      myHandEl.appendChild(el);
    });

    // Show multi-play button if cards are selected
    updateMultiPlayButton();
  }

  function updateMultiPlayButton() {
    let btn = $('btn-multi-play');
    if (selectedCards.length >= 2) {
      if (!btn) {
        btn = document.createElement('button');
        btn.id = 'btn-multi-play';
        btn.className = 'btn btn-multi-play';
        btn.addEventListener('click', onMultiPlay);
        document.querySelector('.action-buttons').appendChild(btn);
      }
      btn.textContent = `${selectedCards.length}枚まとめて出す！`;
      btn.classList.remove('hidden');
    } else if (btn) {
      btn.classList.add('hidden');
    }
  }

  function onMultiPlay() {
    if (selectedCards.length < 2) return;

    // Check if any are wild - need color picker
    const firstCard = myHand.find(c => c.id === selectedCards[0]);
    if (firstCard && firstCard.color === 'wild') {
      colorPicker.classList.remove('hidden');
      document.querySelectorAll('.color-btn').forEach(btn => {
        btn.onclick = () => {
          colorPicker.classList.add('hidden');
          socket.emit('play-multiple', { roomCode, cardIds: [...selectedCards], chosenColor: btn.dataset.color });
          selectedCards = [];
        };
      });
    } else {
      socket.emit('play-multiple', { roomCode, cardIds: [...selectedCards] });
      selectedCards = [];
    }
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

    // Pending draw indicator
    let pendingEl = $('pending-draw-indicator');
    if (!pendingEl) {
      pendingEl = document.createElement('div');
      pendingEl.id = 'pending-draw-indicator';
      pendingEl.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-80px);background:rgba(239,68,68,0.95);color:white;padding:8px 20px;border-radius:20px;font-size:18px;font-weight:800;z-index:95;pointer-events:none;display:none;animation:pulse 0.8s infinite;';
      document.getElementById('game-screen').appendChild(pendingEl);
    }
    if (state.pendingDrawCount > 0) {
      pendingEl.textContent = `+${state.pendingDrawCount} スタック中！`;
      pendingEl.style.display = 'block';
    } else {
      pendingEl.style.display = 'none';
    }

    // Turn indicator
    if (state.myTurn) {
      showTurnIndicator('あなたのターンです！');
    }
  }

  function updateActionButtons(state) {
    // UNO button - show when playing cards could leave you with 1 card
    // Standard: 2 cards in hand (play 1 → 1 left)
    // Multi-play: check if same-value cards could reduce hand to 1
    let shouldShowUno = false;
    if (state.myTurn && myHand.length >= 2) {
      if (myHand.length === 2) {
        shouldShowUno = true;
      } else {
        // Check if multi-play could leave 1 card
        const valueCounts = {};
        myHand.forEach(c => { valueCounts[c.value] = (valueCounts[c.value] || 0) + 1; });
        for (const [val, count] of Object.entries(valueCounts)) {
          if (count >= myHand.length - 1) {
            // Playing count cards would leave 1 or fewer
            shouldShowUno = true;
            break;
          }
        }
      }
    }
    btnUno.disabled = !shouldShowUno;
    if (shouldShowUno) {
      btnUno.classList.add('uno-active');
      btnUno.textContent = 'UNO! 押して!';
    } else {
      btnUno.classList.remove('uno-active');
      btnUno.textContent = 'UNO!';
    }

    // Pass button
    if (state.canPass) {
      btnPass.classList.remove('hidden');
    } else {
      btnPass.classList.add('hidden');
    }

    // Ball button (Ultimate mode only)
    const btnBall = $('btn-ball');
    if (btnBall) {
      if (state.canThrowBall) {
        btnBall.classList.remove('hidden');
        btnBall.disabled = false;
      } else {
        btnBall.classList.add('hidden');
      }
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

    // Check if there are other cards of the same value in hand
    const sameValueCards = myHand.filter(c => c.value === card.value);

    if (sameValueCards.length >= 2 && card.color !== 'wild') {
      // Toggle selection for multi-play
      const idx = selectedCards.indexOf(card.id);
      if (idx >= 0) {
        selectedCards.splice(idx, 1);
      } else {
        // Only allow selecting same value cards
        if (selectedCards.length > 0) {
          const firstSelected = myHand.find(c => c.id === selectedCards[0]);
          if (firstSelected && firstSelected.value !== card.value) {
            // Different value - clear selection and start fresh
            selectedCards = [];
          }
        }
        selectedCards.push(card.id);
      }

      // If only 1 selected, double-tap to play it immediately
      if (selectedCards.length === 1) {
        // Set a timeout - if no second card selected within 500ms, play the single card
        clearTimeout(window._multiSelectTimer);
        window._multiSelectTimer = setTimeout(() => {
          if (selectedCards.length === 1) {
            const singleCardId = selectedCards[0];
            selectedCards = [];
            const singleCard = myHand.find(c => c.id === singleCardId);
            if (singleCard && singleCard.color === 'wild') {
              pendingWildCardId = singleCard.id;
              colorPicker.classList.remove('hidden');
            } else {
              socket.emit('play-card', { roomCode, cardId: singleCardId });
            }
          }
        }, 600);
      }

      // Re-render hand to show selection
      renderHand(myHand, gameState);
    } else {
      // Single card or wild - play immediately
      selectedCards = [];
      if (card.color === 'wild') {
        pendingWildCardId = card.id;
        colorPicker.classList.remove('hidden');
      } else {
        socket.emit('play-card', { roomCode, cardId: card.id });
      }
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
    const targetPlayer = gameState?.players.find(p => p.id === targetPlayerId);
    const btn = document.createElement('button');
    btn.className = 'btn uno-challenge-btn';
    btn.textContent = `${targetPlayer?.name || '?'} UNO忘れてる! 指摘する!`;
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

    // Share button - share URL with room code via LINE or native share
    const btnShare = $('btn-share');
    if (btnShare) {
      btnShare.addEventListener('click', () => {
        const code = roomCodeDisplay.textContent;
        const shareUrl = `${location.origin}?room=${code}`;
        const shareText = `リザーノで遊ぼう！\nルームコード: ${code}\n${shareUrl}`;

        if (navigator.share) {
          navigator.share({ title: 'リザーノ', text: shareText, url: shareUrl }).catch(() => {});
        } else {
          // Fallback: open LINE share
          const lineUrl = `https://line.me/R/msg/text/?${encodeURIComponent(shareText)}`;
          window.open(lineUrl, '_blank');
        }
      });
    }

    btnStart.addEventListener('click', () => {
      currentRound = 0;
      socket.emit('start-game', { roomCode, gameMode });
    });

    // Round selection buttons
    document.querySelectorAll('.round-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.round-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        totalRounds = parseInt(btn.dataset.rounds);
      });
    });

    // Mode selection buttons
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        gameMode = btn.dataset.mode;
        const desc = $('ultimate-desc');
        if (desc) {
          if (gameMode === 'ultimate') desc.classList.remove('hidden');
          else desc.classList.add('hidden');
        }
      });
    });

    // Ball throw button
    const btnBall = $('btn-ball');
    const ballPicker = $('ball-picker');
    const ballTargets = $('ball-targets');
    const btnBallCancel = $('btn-ball-cancel');

    if (btnBall) {
      btnBall.addEventListener('click', () => {
        if (!gameState || !gameState.canThrowBall) return;
        // Show target picker with opponent list
        ballTargets.innerHTML = '';
        gameState.players.forEach(p => {
          if (p.id === myId) return;
          const btn = document.createElement('button');
          btn.className = 'ball-target-btn';
          btn.textContent = `🎳 ${p.name}`;
          btn.addEventListener('click', () => {
            socket.emit('throw-ball', { roomCode, targetPlayerId: p.id });
            ballPicker.classList.add('hidden');
          });
          ballTargets.appendChild(btn);
        });
        ballPicker.classList.remove('hidden');
      });
    }

    if (btnBallCancel) {
      btnBallCancel.addEventListener('click', () => {
        ballPicker.classList.add('hidden');
      });
    }

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
    // Don't auto-create room on Enter in name field - just move focus to room code
    playerNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        roomCodeInput.focus();
      }
    });

    roomCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btnJoin.click();
    });

    // Chat
    const chatInput = $('chat-input');
    const btnChatSend = $('btn-chat-send');
    function sendChat() {
      if (!roomCode || !chatInput.value.trim()) return;
      socket.emit('chat-message', { roomCode, message: chatInput.value.trim() });
      chatInput.value = '';
    }
    btnChatSend.addEventListener('click', sendChat);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendChat();
    });

    // Chat toggle
    const chatToggle = $('btn-chat-toggle');
    const chatPanel = $('chat-panel');
    chatToggle.addEventListener('click', () => {
      chatPanel.classList.toggle('hidden');
      chatToggle.classList.toggle('active');
    });

    // Drag chat container
    const chatContainer = $('chat-container');
    const dragHandle = $('chat-drag-handle');
    if (chatContainer && dragHandle) {
      let isDragging = false;
      let dragStartX, dragStartY, startLeft, startBottom;

      function onDragStart(e) {
        isDragging = true;
        const touch = e.touches ? e.touches[0] : e;
        dragStartX = touch.clientX;
        dragStartY = touch.clientY;
        const rect = chatContainer.getBoundingClientRect();
        startLeft = rect.left;
        startBottom = window.innerHeight - rect.bottom;
        e.preventDefault();
      }

      function onDragMove(e) {
        if (!isDragging) return;
        const touch = e.touches ? e.touches[0] : e;
        const dx = touch.clientX - dragStartX;
        const dy = touch.clientY - dragStartY;
        const newLeft = Math.max(0, Math.min(window.innerWidth - 60, startLeft + dx));
        const newBottom = Math.max(0, Math.min(window.innerHeight - 60, startBottom - dy));
        chatContainer.style.left = newLeft + 'px';
        chatContainer.style.bottom = newBottom + 'px';
        chatContainer.style.right = 'auto';
        chatContainer.style.top = 'auto';
        e.preventDefault();
      }

      function onDragEnd() {
        isDragging = false;
      }

      dragHandle.addEventListener('mousedown', onDragStart);
      dragHandle.addEventListener('touchstart', onDragStart, { passive: false });
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('touchmove', onDragMove, { passive: false });
      document.addEventListener('mouseup', onDragEnd);
      document.addEventListener('touchend', onDragEnd);
    }

    // Stats modal
    const btnStats = $('btn-stats');
    const statsModal = $('stats-modal');
    const btnStatsClose = $('btn-stats-close');
    if (btnStats) {
      btnStats.addEventListener('click', () => {
        renderStatsModal();
        statsModal.classList.remove('hidden');
      });
    }
    if (btnStatsClose) {
      btnStatsClose.addEventListener('click', () => {
        statsModal.classList.add('hidden');
      });
    }
    if (statsModal) {
      statsModal.addEventListener('click', (e) => {
        if (e.target === statsModal) statsModal.classList.add('hidden');
      });
    }

    // Stamps
    document.querySelectorAll('.stamp-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!roomCode) return;
        socket.emit('chat-message', { roomCode, message: btn.dataset.stamp, isStamp: true });
      });
    });
  }

  // === Init ===
  function init() {
    connectSocket();
    setupUIListeners();

    // Auto-fill room code from URL parameter (e.g., ?room=ABCD)
    const urlParams = new URLSearchParams(window.location.search);
    const urlRoom = urlParams.get('room');
    if (urlRoom) {
      roomCodeInput.value = urlRoom.toUpperCase();
      // Clean the URL without reloading
      window.history.replaceState({}, '', window.location.pathname);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
