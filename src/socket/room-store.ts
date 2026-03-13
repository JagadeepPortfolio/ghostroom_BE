export interface Message {
  id: string;
  sender: string;
  text: string;
  roomId: string;
  createdAt: number;
  readBy: Record<string, number>;
}

export interface Room {
  id: string;
  users: Map<string, string>; // socketId -> username
  messages: Map<string, Message>; // messageId -> Message
}

class RoomStore {
  private rooms: Map<string, Room> = new Map();

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

  addUser(roomId: string, socketId: string, username: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    // Check username uniqueness in this room
    for (const [, existingName] of room.users) {
      if (existingName === username) return false;
    }

    room.users.set(socketId, username);
    return true;
  }

  removeUser(roomId: string, socketId: string): string | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;

    const username = room.users.get(socketId);
    if (!username) return undefined;

    room.users.delete(socketId);

    // Check if any messages can now be burned (user left without reading)
    this.cleanupMessagesForRoom(roomId);

    // Delete room if empty
    if (room.users.size === 0) {
      this.rooms.delete(roomId);
    }

    return username;
  }

  getUsernames(roomId: string): string[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return Array.from(room.users.values());
  }

  getUsernameBySocketId(roomId: string, socketId: string): string | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    return room.users.get(socketId);
  }

  isUsernameTaken(roomId: string, username: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    for (const [, existingName] of room.users) {
      if (existingName === username) return true;
    }
    return false;
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

  /**
   * Check if a message has been read by all current room users.
   * If so, delete it from the store and return true.
   */
  tryBurnMessage(roomId: string, messageId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const message = room.messages.get(messageId);
    if (!message) return false;

    const currentUsers = Array.from(room.users.values());
    const allRead = currentUsers.every((user) => message.readBy[user]);

    if (allRead) {
      room.messages.delete(messageId);
      return true;
    }

    return false;
  }

  /**
   * After a user disconnects, re-check all messages in the room.
   * Some messages may now qualify for burning since the disconnected
   * user is no longer in the required readers list.
   */
  private cleanupMessagesForRoom(roomId: string): string[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    const burnedIds: string[] = [];
    const currentUsers = Array.from(room.users.values());

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
