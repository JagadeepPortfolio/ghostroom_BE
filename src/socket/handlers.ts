import { Server, Socket } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import { roomStore, Message } from "./room-store";
import { isRateLimited, clearRateLimit } from "./rate-limiter";

// Basic XSS sanitization
function sanitize(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export function registerSocketHandlers(io: Server): void {
  io.on("connection", (socket: Socket) => {
    console.log(`[connect] ${socket.id}`);

    // Create a new room
    socket.on("create_room", (callback: (data: { roomId: string }) => void) => {
      const roomId = generateRoomId();
      roomStore.createRoom(roomId);
      callback({ roomId });
    });

    // Check if room exists
    socket.on(
      "check_room",
      (
        { roomId }: { roomId: string },
        callback: (data: { exists: boolean }) => void
      ) => {
        callback({ exists: roomStore.roomExists(roomId) });
      }
    );

    // Check username availability
    socket.on(
      "check_username",
      (
        { roomId, username }: { roomId: string; username: string },
        callback: (data: { available: boolean }) => void
      ) => {
        const taken = roomStore.isUsernameTaken(roomId, username);
        callback({ available: !taken });
      }
    );

    // Join room
    socket.on(
      "join_room",
      (
        { roomId, username }: { roomId: string; username: string },
        callback: (data: { success: boolean; error?: string }) => void
      ) => {
        if (!roomStore.roomExists(roomId)) {
          callback({ success: false, error: "Room not found" });
          return;
        }

        const sanitizedName = sanitize(username.trim());
        if (!sanitizedName || sanitizedName.length > 30) {
          callback({ success: false, error: "Invalid username" });
          return;
        }

        const added = roomStore.addUser(roomId, socket.id, sanitizedName);
        if (!added) {
          callback({ success: false, error: "Username already taken in this room" });
          return;
        }

        socket.join(roomId);
        callback({ success: true });

        // Broadcast updated user list
        const users = roomStore.getUsernames(roomId);
        io.to(roomId).emit("room_users", users);
        socket.to(roomId).emit("user_joined", { username: sanitizedName });
      }
    );

    // Send message
    socket.on(
      "send_message",
      ({ roomId, text }: { roomId: string; text: string }) => {
        if (isRateLimited(socket.id)) {
          socket.emit("rate_limited");
          return;
        }

        const sender = roomStore.getUsernameBySocketId(roomId, socket.id);
        if (!sender) return;

        const sanitizedText = sanitize(text.trim());
        if (!sanitizedText || sanitizedText.length > 2000) return;

        const message: Message = {
          id: uuidv4(),
          sender,
          text: sanitizedText,
          roomId,
          createdAt: Date.now(),
          readBy: { [sender]: Date.now() }, // Sender auto-reads
        };

        roomStore.addMessage(roomId, message);
        io.to(roomId).emit("new_message", message);

        // Check if single user in room — auto-burn
        roomStore.tryBurnMessage(roomId, message.id);
      }
    );

    // Message read
    socket.on(
      "message_read",
      ({
        roomId,
        messageId,
        username,
      }: {
        roomId: string;
        messageId: string;
        username: string;
      }) => {
        const msg = roomStore.markMessageRead(roomId, messageId, username);
        if (!msg) return;

        // Broadcast updated readBy to room
        io.to(roomId).emit("message_read_ack", {
          messageId,
          readBy: msg.readBy,
        });

        // Try to burn if all current users have read
        roomStore.tryBurnMessage(roomId, messageId);
      }
    );

    // Typing start
    socket.on(
      "typing_start",
      ({ roomId, username }: { roomId: string; username: string }) => {
        socket.to(roomId).emit("user_typing", { username });
      }
    );

    // Typing stop
    socket.on(
      "typing_stop",
      ({ roomId, username }: { roomId: string; username: string }) => {
        socket.to(roomId).emit("user_stop_typing", { username });
      }
    );

    // Disconnect
    socket.on("disconnect", () => {
      console.log(`[disconnect] ${socket.id}`);
      clearRateLimit(socket.id);

      const roomId = roomStore.findRoomBySocketId(socket.id);
      if (!roomId) return;

      const username = roomStore.removeUser(roomId, socket.id);
      if (!username) return;

      // Broadcast updated user list and departure
      const users = roomStore.getUsernames(roomId);
      io.to(roomId).emit("room_users", users);
      io.to(roomId).emit("user_left", { username });
    });
  });
}

function generateRoomId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const segments = [3, 3, 2];
  return segments
    .map((len) =>
      Array.from({ length: len }, () =>
        chars[Math.floor(Math.random() * chars.length)]
      ).join("")
    )
    .join("-");
}
