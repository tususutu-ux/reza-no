const Player = require('./Player');
const GameManager = require('./GameManager');

class Room {
  constructor(code, hostSocketId, hostName) {
    this.code = code;
    this.players = new Map(); // socketId -> Player
    this.playerIdMap = new Map(); // playerId -> socketId
    this.game = null;
    this.hostSocketId = hostSocketId;
    this.createdAt = Date.now();
    this.maxPlayers = 8;
    this.totalScores = new Map(); // playerId -> cumulative score

    // Add host
    this.addPlayer(hostSocketId, hostName);
  }

  addPlayer(socketId, name) {
    if (this.players.size >= this.maxPlayers) return null;
    const player = new Player(socketId, name);
    this.players.set(socketId, player);
    this.playerIdMap.set(player.id, socketId);
    this.totalScores.set(player.id, 0);
    return player;
  }

  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (!player) return null;
    this.players.delete(socketId);
    this.playerIdMap.delete(player.id);
    // Transfer host if needed
    if (socketId === this.hostSocketId && this.players.size > 0) {
      this.hostSocketId = this.players.keys().next().value;
    }
    return player;
  }

  getPlayerBySocketId(socketId) {
    return this.players.get(socketId);
  }

  getPlayerById(playerId) {
    const socketId = this.playerIdMap.get(playerId);
    if (!socketId) return null;
    return this.players.get(socketId);
  }

  getPlayerIdBySocket(socketId) {
    const player = this.players.get(socketId);
    return player ? player.id : null;
  }

  getPlayerList() {
    return Array.from(this.players.values()).map(p => ({
      ...p.toPublic(),
      isHost: this.players.get(this.hostSocketId)?.id === p.id,
    }));
  }

  startGame(gameMode = 'normal') {
    if (this.players.size < 2) return { error: 'プレイヤーが2人以上必要です' };
    const playerArray = Array.from(this.players.values());
    this.game = new GameManager(this.code, playerArray, gameMode);
    return this.game.startGame();
  }

  reconnectPlayer(playerId, newSocketId) {
    const oldSocketId = this.playerIdMap.get(playerId);
    if (!oldSocketId) return null;

    const player = this.players.get(oldSocketId);
    if (!player) return null;

    // Clear disconnect timer
    if (player._disconnectTimer) {
      clearTimeout(player._disconnectTimer);
      player._disconnectTimer = null;
    }

    // Update mappings
    this.players.delete(oldSocketId);
    player.socketId = newSocketId;
    player.connected = true;
    this.players.set(newSocketId, player);
    this.playerIdMap.set(playerId, newSocketId);

    // Transfer host if old host reconnected
    if (oldSocketId === this.hostSocketId) {
      this.hostSocketId = newSocketId;
    }

    return player;
  }

  handleDisconnect(socketId) {
    const player = this.players.get(socketId);
    if (!player) return null;

    // Always keep player for reconnection (both lobby and game)
    player.connected = false;

    // Set a timeout to actually remove if they don't reconnect
    if (!this.game || this.game.state !== 'playing') {
      // In lobby: remove after 30 seconds if not reconnected
      player._disconnectTimer = setTimeout(() => {
        if (!player.connected) {
          this.removePlayer(socketId);
        }
      }, 30000);
    }

    return { disconnected: true, player };
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomCode -> Room
    this.socketToRoom = new Map(); // socketId -> roomCode

    // Cleanup inactive rooms every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code;
    do {
      code = '';
      for (let i = 0; i < 4; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
    } while (this.rooms.has(code));
    return code;
  }

  createRoom(socketId, playerName) {
    const code = this.generateRoomCode();
    const room = new Room(code, socketId, playerName);
    this.rooms.set(code, room);
    this.socketToRoom.set(socketId, code);
    const player = room.getPlayerBySocketId(socketId);
    return { code, playerId: player.id };
  }

  joinRoom(roomCode, socketId, playerName) {
    const room = this.rooms.get(roomCode);
    if (!room) return { error: '部屋が見つかりません' };
    if (room.game && room.game.state === 'playing') return { error: 'ゲームが既に開始されています' };
    if (room.players.size >= room.maxPlayers) return { error: '部屋が満員です' };

    const player = room.addPlayer(socketId, playerName);
    if (!player) return { error: '参加できませんでした' };

    this.socketToRoom.set(socketId, roomCode);
    return { playerId: player.id, players: room.getPlayerList() };
  }

  getRoom(roomCode) {
    return this.rooms.get(roomCode);
  }

  getRoomBySocket(socketId) {
    const code = this.socketToRoom.get(socketId);
    return code ? this.rooms.get(code) : null;
  }

  getRoomCodeBySocket(socketId) {
    return this.socketToRoom.get(socketId);
  }

  handleDisconnect(socketId) {
    const roomCode = this.socketToRoom.get(socketId);
    if (!roomCode) return null;

    const room = this.rooms.get(roomCode);
    if (!room) return null;

    const result = room.handleDisconnect(socketId);

    if (result && result.removed) {
      this.socketToRoom.delete(socketId);
      // Delete room if empty
      if (room.players.size === 0) {
        this.rooms.delete(roomCode);
      }
    }

    return { roomCode, ...result };
  }

  leaveRoom(socketId) {
    const roomCode = this.socketToRoom.get(socketId);
    if (!roomCode) return null;

    const room = this.rooms.get(roomCode);
    if (!room) return null;

    const player = room.removePlayer(socketId);
    this.socketToRoom.delete(socketId);

    if (room.players.size === 0) {
      this.rooms.delete(roomCode);
    }

    return { roomCode, player, hostSocketId: room.hostSocketId };
  }

  cleanup() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      // Remove rooms older than 30 minutes with no active game
      if (!room.game && now - room.createdAt > 30 * 60 * 1000 && room.players.size === 0) {
        this.rooms.delete(code);
      }
    }
  }
}

module.exports = RoomManager;
