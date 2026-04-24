const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      hostId: null,
      clients: new Map(),
      mediaUrl: null,
      time: 0,
      paused: true
    });
  }
  return rooms.get(roomId);
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(roomId, data, exceptWs = null) {
  const room = rooms.get(roomId);
  if (!room) return;

  for (const client of room.clients.values()) {
    if (client !== exceptWs) send(client, data);
  }
}

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Watch Sync Lobby</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background: #111;
      color: white;
      display: flex;
      justify-content: center;
      padding-top: 80px;
    }
    .box {
      width: 420px;
      background: #1c1c1c;
      padding: 24px;
      border-radius: 14px;
      box-shadow: 0 0 20px rgba(0,0,0,0.5);
    }
    input, button {
      width: 100%;
      padding: 12px;
      margin-top: 10px;
      border-radius: 8px;
      border: none;
      box-sizing: border-box;
    }
    button {
      cursor: pointer;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <div class="box">
    <h2>Watch Sync Lobby</h2>

    <input id="roomInput" placeholder="Room ID, e.g. anime-night">
    <button id="joinBtn">Join Room</button>

    <div id="panel" style="display:none;">
      <p id="status"></p>
      <input id="mediaUrl" placeholder="Paste anime / YouTube / video URL">
      <button id="startBtn">Start Session</button>
      <button id="copyBtn">Copy Invite Link</button>
    </div>
  </div>

  <script>
    const ws = new WebSocket(location.origin.replace("http", "ws"));
    const clientId = crypto.randomUUID();

    let roomId = new URLSearchParams(location.search).get("room") || "";
    let isHost = false;

    const roomInput = document.getElementById("roomInput");
    const joinBtn = document.getElementById("joinBtn");
    const panel = document.getElementById("panel");
    const status = document.getElementById("status");
    const mediaUrl = document.getElementById("mediaUrl");
    const startBtn = document.getElementById("startBtn");
    const copyBtn = document.getElementById("copyBtn");

    roomInput.value = roomId;

    function joinRoom() {
      roomId = roomInput.value.trim();
      if (!roomId) {
        alert("Enter a room ID");
        return;
      }

      ws.send(JSON.stringify({
        type: "join-room",
        roomId,
        clientId
      }));

      history.replaceState(null, "", "/?room=" + encodeURIComponent(roomId));
      panel.style.display = "block";
    }

    joinBtn.onclick = joinRoom;

    startBtn.onclick = () => {
      if (!roomId) return alert("Join a room first");
      if (!mediaUrl.value.trim()) return alert("Paste a media URL first");

      ws.send(JSON.stringify({
        type: "start-session",
        roomId,
        mediaUrl: mediaUrl.value.trim()
      }));
    };

    copyBtn.onclick = async () => {
      const link = location.origin + "/?room=" + encodeURIComponent(roomId);
      await navigator.clipboard.writeText(link);
      alert("Invite link copied");
    };

    ws.onopen = () => {
      if (roomId) joinRoom();
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      console.log("Lobby message:", msg);

      if (msg.type === "room-joined") {
        isHost = msg.isHost;
        status.textContent = isHost
          ? "You are host. Paste a URL and start the session."
          : "You joined as follower. Wait for host to start.";
      }

      if (msg.type === "session-started") {
        const url = new URL(msg.mediaUrl);
        url.searchParams.set("syncRoom", msg.roomId);
        url.searchParams.set("syncRole", isHost ? "host" : "follower");
        window.open(url.toString(), "_blank");
      }
    };
  </script>
</body>
</html>
  `);
});

wss.on("connection", (ws) => {
  ws.id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);

  ws.on("message", (raw) => {
    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    if (data.type === "join-room") {
      const room = getRoom(data.roomId);

      ws.roomId = data.roomId;
      ws.clientId = data.clientId || ws.id;

      room.clients.set(ws.clientId, ws);

      if (!room.hostId) {
        room.hostId = ws.clientId;
      }

      send(ws, {
        type: "room-joined",
        roomId: data.roomId,
        clientId: ws.clientId,
        isHost: room.hostId === ws.clientId
      });

      return;
    }

    if (data.type === "start-session") {
      const room = getRoom(data.roomId);
      room.mediaUrl = data.mediaUrl;
      room.time = 0;
      room.paused = true;

      broadcast(data.roomId, {
        type: "session-started",
        roomId: data.roomId,
        mediaUrl: data.mediaUrl
      });

      return;
    }

    if (data.type === "media-tab-join") {
      const room = getRoom(data.roomId);

      ws.roomId = data.roomId;
      ws.clientId = data.clientId || ws.id;
      ws.role = data.role;

      room.clients.set(ws.clientId, ws);

      return;
    }

    if (data.type === "sync") {
      const room = getRoom(data.roomId);

      room.time = data.time;
      room.paused = data.paused;

      broadcast(data.roomId, {
        type: "sync",
        roomId: data.roomId,
        time: data.time,
        paused: data.paused
      }, ws);

      return;
    }
  });

  ws.on("close", () => {
    if (!ws.roomId || !ws.clientId) return;

    const room = rooms.get(ws.roomId);
    if (!room) return;

    room.clients.delete(ws.clientId);

    if (room.hostId === ws.clientId) {
      room.hostId = null;
    }

    if (room.clients.size === 0) {
      rooms.delete(ws.roomId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
