const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const RoomManager = require('./game/RoomManager');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.status(200).send('OK'));

const roomManager = new RoomManager();

io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  // === Room Events ===

  socket.on('create-room', ({ playerName }) => {
    if (!playerName || playerName.trim().length === 0) {
      return socket.emit('error', { message: '名前を入力してください' });
    }
    const { code, playerId } = roomManager.createRoom(socket.id, playerName.trim());
    socket.join(code);
    socket.emit('room-created', { roomCode: code, playerId });
  });

  socket.on('join-room', ({ roomCode, playerName }) => {
    if (!playerName || playerName.trim().length === 0) {
      return socket.emit('error', { message: '名前を入力してください' });
    }
    if (!roomCode) {
      return socket.emit('error', { message: 'ルームコードを入力してください' });
    }

    const result = roomManager.joinRoom(roomCode.toUpperCase(), socket.id, playerName.trim());
    if (result.error) {
      return socket.emit('error', { message: result.error });
    }

    socket.join(roomCode.toUpperCase());
    socket.emit('room-joined', {
      roomCode: roomCode.toUpperCase(),
      playerId: result.playerId,
      players: result.players,
    });

    // Broadcast to others in room
    socket.to(roomCode.toUpperCase()).emit('player-joined', {
      players: result.players,
    });
  });

  socket.on('leave-room', () => {
    const result = roomManager.leaveRoom(socket.id);
    if (result) {
      socket.leave(result.roomCode);
      socket.to(result.roomCode).emit('player-left', {
        playerId: result.player?.id,
        playerName: result.player?.name,
        players: roomManager.getRoom(result.roomCode)?.getPlayerList() || [],
        hostSocketId: result.hostSocketId,
      });
    }
  });

  // === Game Events ===

  socket.on('start-game', ({ roomCode }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room) return socket.emit('error', { message: '部屋が見つかりません' });
    if (socket.id !== room.hostSocketId) {
      return socket.emit('error', { message: 'ホストのみ開始できます' });
    }

    const result = room.startGame();
    if (result.error) return socket.emit('error', { message: result.error });

    // Send personalized state to each player
    for (const [sid, player] of room.players) {
      io.to(sid).emit('game-started', room.game.getStateForPlayer(player.id));
    }
  });

  socket.on('play-card', ({ roomCode, cardId, chosenColor }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room || !room.game) {
      return socket.emit('error', { message: 'ゲームが見つかりません' });
    }

    const playerId = room.getPlayerIdBySocket(socket.id);
    if (!playerId) return socket.emit('error', { message: 'プレイヤーが見つかりません' });

    const result = room.game.playCard(playerId, cardId, chosenColor);
    if (result.error) return socket.emit('error', { message: result.error });

    // Broadcast card played
    io.to(roomCode).emit('card-played', {
      playerId,
      card: result.card,
      effects: result.effects,
      currentColor: room.game.currentColor,
      direction: room.game.direction,
    });

    // Send updated state to each player
    for (const [sid, player] of room.players) {
      io.to(sid).emit('game-state', room.game.getStateForPlayer(player.id));
    }

    // Handle game over
    if (result.gameOver) {
      // Update total scores
      room.totalScores.set(result.scores.winnerId,
        (room.totalScores.get(result.scores.winnerId) || 0) + result.scores.winnerScore);

      io.to(roomCode).emit('game-over', {
        ...result.scores,
        totalScores: Object.fromEntries(room.totalScores),
      });
    }
  });

  socket.on('draw-card', ({ roomCode }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room || !room.game) {
      return socket.emit('error', { message: 'ゲームが見つかりません' });
    }

    const playerId = room.getPlayerIdBySocket(socket.id);
    if (!playerId) return socket.emit('error', { message: 'プレイヤーが見つかりません' });

    const result = room.game.drawCard(playerId);
    if (result.error) return socket.emit('error', { message: result.error });

    // Tell the drawing player what they got
    socket.emit('your-draw', {
      drawnCards: result.drawnCards,
      playableCard: result.playableCard,
      drawCount: result.drawCount,
    });

    // Tell everyone else someone drew (and how many)
    socket.to(roomCode).emit('card-drawn', { playerId, drawCount: result.drawCount });

    // Send updated state to each player
    for (const [sid, player] of room.players) {
      io.to(sid).emit('game-state', room.game.getStateForPlayer(player.id));
    }
  });

  socket.on('pass-turn', ({ roomCode }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room || !room.game) {
      return socket.emit('error', { message: 'ゲームが見つかりません' });
    }

    const playerId = room.getPlayerIdBySocket(socket.id);
    if (!playerId) return socket.emit('error', { message: 'プレイヤーが見つかりません' });

    const result = room.game.passTurn(playerId);
    if (result.error) return socket.emit('error', { message: result.error });

    // Send updated state to each player
    for (const [sid, player] of room.players) {
      io.to(sid).emit('game-state', room.game.getStateForPlayer(player.id));
    }
  });

  socket.on('call-uno', ({ roomCode }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room || !room.game) return;

    const playerId = room.getPlayerIdBySocket(socket.id);
    if (!playerId) return;

    const result = room.game.callUno(playerId);
    if (result.success) {
      io.to(roomCode).emit('uno-called', { playerId, playerName: room.getPlayerBySocketId(socket.id)?.name });
    }
  });

  socket.on('challenge-uno', ({ roomCode, targetPlayerId }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room || !room.game) return;

    const challengerId = room.getPlayerIdBySocket(socket.id);
    if (!challengerId) return;

    const result = room.game.challengeUno(challengerId, targetPlayerId);
    if (result.success) {
      io.to(roomCode).emit('uno-penalty', {
        targetPlayerId,
        challengerId,
        cardCount: result.cards.length,
      });

      // Send updated state to each player
      for (const [sid, player] of room.players) {
        io.to(sid).emit('game-state', room.game.getStateForPlayer(player.id));
      }
    }
  });

  socket.on('restart-game', ({ roomCode }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room) return socket.emit('error', { message: '部屋が見つかりません' });
    if (socket.id !== room.hostSocketId) {
      return socket.emit('error', { message: 'ホストのみ再開できます' });
    }

    const result = room.startGame();
    if (result.error) return socket.emit('error', { message: result.error });

    for (const [sid, player] of room.players) {
      io.to(sid).emit('game-started', room.game.getStateForPlayer(player.id));
    }
  });

  // === Reconnection ===

  socket.on('reconnect-player', ({ roomCode, playerId }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room) return socket.emit('error', { message: '部屋が見つかりません' });

    const player = room.reconnectPlayer(playerId, socket.id);
    if (!player) return socket.emit('error', { message: '再接続できませんでした' });

    socket.join(roomCode);
    roomManager.socketToRoom.set(socket.id, roomCode);

    if (room.game && room.game.state === 'playing') {
      socket.emit('game-started', room.game.getStateForPlayer(playerId));
    } else {
      socket.emit('room-joined', {
        roomCode,
        playerId,
        players: room.getPlayerList(),
      });
    }

    socket.to(roomCode).emit('player-reconnected', {
      playerId,
      playerName: player.name,
    });
  });

  // === Disconnect ===

  socket.on('disconnect', () => {
    console.log(`Disconnected: ${socket.id}`);
    const result = roomManager.handleDisconnect(socket.id);
    if (result && result.roomCode) {
      if (result.disconnected) {
        io.to(result.roomCode).emit('player-disconnected', {
          playerId: result.player?.id,
          playerName: result.player?.name,
        });
        // Also send updated game state
        const room = roomManager.getRoom(result.roomCode);
        if (room && room.game) {
          for (const [sid, player] of room.players) {
            if (player.connected) {
              io.to(sid).emit('game-state', room.game.getStateForPlayer(player.id));
            }
          }
        }
      } else if (result.removed) {
        const room = roomManager.getRoom(result.roomCode);
        io.to(result.roomCode).emit('player-left', {
          playerId: result.player?.id,
          playerName: result.player?.name,
          players: room ? room.getPlayerList() : [],
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  io.close();
  httpServer.close(() => process.exit(0));
});
