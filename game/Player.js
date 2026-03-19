const crypto = require('crypto');

class Player {
  constructor(socketId, name) {
    this.id = crypto.randomUUID();
    this.socketId = socketId;
    this.name = name;
    this.hand = [];
    this.connected = true;
    this.calledUno = false;
  }

  toPublic() {
    return {
      id: this.id,
      name: this.name,
      cardCount: this.hand.length,
      connected: this.connected,
      calledUno: this.calledUno,
    };
  }
}

module.exports = Player;
