import express from "express";
import { createServer as createViteServer } from "vite";
import { Server as SocketServer } from "socket.io";
import { createServer as createHttpServer } from "http";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createHttpServer(app);
  const io = new SocketServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Multi-Lobby State
  const lobbies: Record<string, {
    hostId: string | null;
    players: Record<string, any>;
    isMissionActive: boolean;
    gameConfig: {
      weaponId: string;
      mapItems: any[];
    };
  }> = {};

  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);
    
    let currentLobbyCode: string | null = null;

    socket.on("join_lobby", ({ lobbyCode, userData }) => {
      const targetLobby = lobbyCode || "PUBLIC_SECTOR";
      
      // Leave previous lobby if any
      if (currentLobbyCode) {
        socket.leave(currentLobbyCode);
      }

      currentLobbyCode = targetLobby;
      socket.join(targetLobby);

      if (!lobbies[targetLobby]) {
        lobbies[targetLobby] = {
          hostId: socket.id,
          players: {},
          isMissionActive: false,
          gameConfig: {
            weaponId: "RAILGUN",
            mapItems: []
          }
        };
      }

    lobbies[targetLobby].players[socket.id] = { 
        id: socket.id, 
        name: userData?.displayName || `Operator_${socket.id.slice(0, 4)}`,
        photoURL: userData?.photoURL,
        hp: 100,
        x: 400,
        y: 300,
        ready: false
      };

      // Assign host if none
      if (!lobbies[targetLobby].hostId) {
        lobbies[targetLobby].hostId = socket.id;
      }

      socket.emit("host_status", { isHost: lobbies[targetLobby].hostId === socket.id });
      io.to(targetLobby).emit("other_players", lobbies[targetLobby].players);
      socket.emit("sync_config", lobbies[targetLobby].gameConfig);
      
      if (lobbies[targetLobby].isMissionActive) {
        socket.emit("mission_started");
      }
      
      // Broadcast updated lobby list to everyone in the LOBBY_SELECT state (global)
      broadcastLobbies();
      
      console.log(`Player ${socket.id} joined lobby ${targetLobby}`);
    });

    socket.on("toggle_ready", () => {
      if (!currentLobbyCode || !lobbies[currentLobbyCode]) return;
      const player = lobbies[currentLobbyCode].players[socket.id];
      if (player) {
        player.ready = !player.ready;
        io.to(currentLobbyCode).emit("other_players", lobbies[currentLobbyCode].players);
      }
    });

    socket.on("request_lobbies", () => {
      broadcastLobbies();
    });

    function broadcastLobbies() {
      const activeLobbies = Object.entries(lobbies)
        .filter(([_, data]) => Object.keys(data.players).length > 0)
        .map(([code, data]) => ({
          code,
          playerCount: Object.keys(data.players).length,
          isMissionActive: data.isMissionActive,
          weapon: data.gameConfig.weaponId
        }));
      io.emit("lobby_list", activeLobbies);
    }

    socket.on("player_state", (state) => {
      if (!currentLobbyCode || !lobbies[currentLobbyCode]) return;
      
      lobbies[currentLobbyCode].players[socket.id] = { 
        ...lobbies[currentLobbyCode].players[socket.id],
        ...state 
      };
      
      socket.broadcast.to(currentLobbyCode).emit("other_players", lobbies[currentLobbyCode].players);
    });

    socket.on("update_config", (newConfig) => {
      if (!currentLobbyCode || !lobbies[currentLobbyCode]) return;
      
      if (socket.id === lobbies[currentLobbyCode].hostId) {
        lobbies[currentLobbyCode].gameConfig = { ...lobbies[currentLobbyCode].gameConfig, ...newConfig };
        io.to(currentLobbyCode).emit("sync_config", lobbies[currentLobbyCode].gameConfig);
      }
    });

    socket.on("place_building", (building) => {
      if (!currentLobbyCode || !lobbies[currentLobbyCode]) return;
      lobbies[currentLobbyCode].gameConfig.mapItems.push(building);
      io.to(currentLobbyCode).emit("sync_config", lobbies[currentLobbyCode].gameConfig);
    });

    socket.on("clear_map", () => {
      if (!currentLobbyCode || !lobbies[currentLobbyCode]) return;
      if (socket.id === lobbies[currentLobbyCode].hostId) {
        lobbies[currentLobbyCode].gameConfig.mapItems = [];
        lobbies[currentLobbyCode].isMissionActive = false; // Reset mission status
        io.to(currentLobbyCode).emit("sync_config", lobbies[currentLobbyCode].gameConfig);
      }
    });

    socket.on("start_mission", () => {
      if (!currentLobbyCode || !lobbies[currentLobbyCode]) return;
      if (socket.id === lobbies[currentLobbyCode].hostId) {
        const lobby = lobbies[currentLobbyCode];
        lobby.isMissionActive = true;
        
        // If map is empty, give it some basic "un-spawned" items (random wasteland stuff)
        if (lobby.gameConfig.mapItems.length === 0) {
          console.log(`Generating random sector for ${currentLobbyCode}`);
          for (let i = 0; i < 15; i++) {
            lobby.gameConfig.mapItems.push({
              id: `gen_${Date.now()}_${i}`,
              x: Math.random() * 700 + 50,
              y: Math.random() * 500 + 50,
              w: 40 + Math.random() * 60,
              h: 40 + Math.random() * 60,
              type: Math.random() > 0.7 ? "CRATE" : "WALL",
              radius: 0
            });
          }
          io.to(currentLobbyCode).emit("sync_config", lobby.gameConfig);
        }

        // Reset player mission stats on server
        Object.keys(lobby.players).forEach(pid => {
          lobby.players[pid].hp = 100;
          lobby.players[pid].x = 400;
          lobby.players[pid].y = 300;
        });

        io.to(currentLobbyCode).emit("mission_started");
      }
    });

    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.id}`);
      
      if (currentLobbyCode && lobbies[currentLobbyCode]) {
        delete lobbies[currentLobbyCode].players[socket.id];
        
        if (socket.id === lobbies[currentLobbyCode].hostId) {
          const remainingPlayers = Object.keys(lobbies[currentLobbyCode].players);
          lobbies[currentLobbyCode].hostId = remainingPlayers[0] || null;
          
          if (lobbies[currentLobbyCode].hostId) {
            io.to(lobbies[currentLobbyCode].hostId).emit("host_status", { isHost: true });
          } else {
            // Delete empty lobby
            delete lobbies[currentLobbyCode];
          }
        }

        if (lobbies[currentLobbyCode]) {
          io.to(currentLobbyCode).emit("other_players", lobbies[currentLobbyCode].players);
          io.to(currentLobbyCode).emit("player_disconnected", socket.id);
        }
        
        // Broadcast updated lobby list globally on disconnect
        broadcastLobbies();
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
