export interface Message {
  id: string;
  sender: string;
  text: string;
  roomId: string;
  createdAt: number;
  readBy: Record<string, number>;
}

export interface UserInfo {
  username: string;
  sessionId: string;
}

export interface Room {
  id: string;
  users: Map<string, UserInfo>; // socketId -> { username, sessionId }
  messages: Map<string, Message>; // messageId -> Message
}

class RoomStore {
  private rooms: Map<string, Room> = new Map();
  private disconnectTimers: Map<string, NodeJS.Timeout> = new Map(); // sessionId -> timer

  createRoom(roomId: string): Room {
    const room: Room = {
      id: roomId,
      users: new Map(),
      messages: new Map(),
    };
    this.rooms.set(roomId, room);
    return room;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  roomExists(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  addUser(
    roomId: string,
    socketId: string,
    username: string,
    sessionId: string
  ): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    // Check username uniqueness — allow if same sessionId
    for (const [, info] of room.users) {
      if (info.username === username && info.sessionId !== sessionId) {
        return false;
      }
    }

    room.users.set(socketId, { username, sessionId });
    return true;
  }

  removeUser(roomId: string, socketId: string): string | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;

    const info = room.users.get(socketId);
    if (!info) return undefined;

    room.users.delete(socketId);

    // Check if any messages can now be burned (user left without reading)
    this.cleanupMessagesForRoom(roomId);

    // Delete room if empty
    if (room.users.size === 0) {
      this.rooms.delete(roomId);
    }

    return info.username;
  }

  getUsernames(roomId: string): string[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return Array.from(room.users.values()).map((u) => u.username);
  }

  getUsernameBySocketId(roomId: string, socketId: string): string | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    return room.users.get(socketId)?.username;
  }

  isUsernameTaken(
    roomId: string,
    username: string,
    sessionId?: string
  ): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    for (const [, info] of room.users) {
      if (info.username === username && info.sessionId !== sessionId) {
        return true;
      }
    }
    return false;
  }

  findBySessionId(
    roomId: string,
    sessionId: string
  ): { socketId: string; username: string } | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    for (const [socketId, info] of room.users) {
      if (info.sessionId === sessionId) {
        return { socketId, username: info.username };
      }
    }
    return undefined;
  }

  replaceSocket(
    roomId: string,
    oldSocketId: string,
    newSocketId: string,
    username: string,
    sessionId: string
  ): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    room.users.delete(oldSocketId);
    room.users.set(newSocketId, { username, sessionId });
    return true;
  }

  // Grace period management
  setDisconnectTimer(sessionId: string, timer: NodeJS.Timeout): void {
    this.disconnectTimers.set(sessionId, timer);
  }

  cancelDisconnectTimer(sessionId: string): boolean {
    const timer = this.disconnectTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(sessionId);
      return true;
    }
    return false;
  }

  getSessionIdBySocketId(roomId: string, socketId: string): string | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    return room.users.get(socketId)?.sessionId;
  }

  addMessage(roomId: string, message: Message): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    room.messages.set(message.id, message);
    return true;
  }

  markMessageRead(
    roomId: string,
    messageId: string,
    username: string
  ): Message | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;

    const message = room.messages.get(messageId);
    if (!message) return undefined;

    if (!message.readBy[username]) {
      message.readBy[username] = Date.now();
    }

    return message;
  }

  getUnburnedMessages(roomId: string): Message[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return Array.from(room.messages.values());
  }

  tryBurnMessage(roomId: string, messageId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const message = room.messages.get(messageId);
    if (!message) return false;

    const currentUsers = Array.from(room.users.values()).map(
      (u) => u.username
    );
    const allRead = currentUsers.every((user) => message.readBy[user]);

    if (allRead) {
      room.messages.delete(messageId);
      return true;
    }

    return false;
  }

  private cleanupMessagesForRoom(roomId: string): string[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    const burnedIds: string[] = [];
    const currentUsers = Array.from(room.users.values()).map(
      (u) => u.username
    );

    if (currentUsers.length === 0) return burnedIds;

    for (const [msgId, msg] of room.messages) {
      const allRead = currentUsers.every((user) => msg.readBy[user]);
      if (allRead) {
        room.messages.delete(msgId);
        burnedIds.push(msgId);
      }
    }

    return burnedIds;
  }

  findRoomBySocketId(socketId: string): string | undefined {
    for (const [roomId, room] of this.rooms) {
      if (room.users.has(socketId)) return roomId;
    }
    return undefined;
  }
}

export const roomStore = new RoomStore();
