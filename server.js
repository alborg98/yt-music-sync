const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let session = {
  videoId: null,
  time: 0,
  paused: true,
  lastUpdate: Date.now()
};

let clients = [];

wss.on("connection", (ws) => {
  console.log("Client connected");
  clients.push(ws);

  ws.send(JSON.stringify({
    type: "session",
    ...session
  }));

  ws.on("message", (message) => {
    const data = JSON.parse(message);

    if (data.type === "sync") {
      session = {
        videoId: data.videoId || null,
        time: data.time || 0,
        paused: data.paused,
        lastUpdate: Date.now()
      };

      clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: "sync",
            ...session
          }));
        }
      });
    }
  });

  ws.on("close", () => {
    clients = clients.filter((c) => c !== ws);
  });
});

app.get("/", (req, res) => {
  res.send("YT Music Sync Server Running");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});