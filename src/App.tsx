/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Skull, 
  Shield, 
  Zap, 
  Home, 
  Map as MapIcon, 
  Crosshair, 
  RotateCcw, 
  Play, 
  Target, 
  Radio, 
  Activity,
  ChevronRight,
  Info,
  Warehouse,
  TowerControl,
  AlertTriangle,
  AlertCircle,
  MapPin,
  FastForward,
  Navigation,
  Wrench,
  Settings,
  Hammer,
  Database,
  Coins,
  Cpu,
  Factory,
  HardDrive,
  Terminal as TerminalIcon,
  Users,
  Network,
  LogIn,
  LogOut,
  Trash2,
  MousePointer2
} from "lucide-react";
import { io, Socket } from "socket.io-client";
import { auth, loginWithGoogle, logout } from "./lib/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { loadDefenses, saveDefenses, clearAllDefenses } from "./lib/supabase";

type GameState = "LOGIN" | "INTRO" | "MENU" | "MAP" | "PLAYING" | "GAMEOVER" | "STORY" | "UPGRADES" | "DEFENSE" | "MANAGE" | "LOBBY" | "MULTIPLAYER_WARNING" | "LOBBY_SELECT";

interface Upgrade {
  id: string;
  name: string;
  level: number;
  maxLevel: number;
  cost: number;
  description: string;
}

interface Entity {
  id: number | string;
  x: number;
  y: number;
  radius: number;
}

interface Obstacle extends Entity {
  w: number;
  h: number;
  type: "WALL" | "CRATE" | "TOWER_PILLAR" | "RUINED_REBAR" | "FLAG" | "SPAWNER";
  spawnerRate?: number; // Zombies per second (0.1 to 3)
  spawnerType?: Enemy["type"];
  lastSpawnTime?: number;
}

interface Enemy extends Entity {
  type: "ZOMBIE" | "RUNNER" | "BRUTE" | "SPITTER";
  hp: number;
  speed: number;
  color: string;
  lastShot?: number;
}

interface EnemyBullet extends Entity {
  vx: number;
  vy: number;
}

interface Bullet extends Entity {
  vx: number;
  vy: number;
  color?: string;
}

interface Particle extends Entity {
  vx: number;
  vy: number;
  life: number;
  color: string;
}

interface PlayerState {
  id?: string;
  name?: string;
  photoURL?: string;
  x: number;
  y: number;
  hp: number;
  armor: number;
}

interface BaseNode {
  id: number;
  name: string;
  x: number;
  y: number;
  captured: boolean;
  difficulty: number;
  type?: "VAULT" | "OUTPOST" | "TOWER" | "RUINS";
  health: number;
  machines: number[]; // Array of indices (0-8 for 3x3 grid)
}

interface Weapon {
  id: string;
  name: string;
  description: string;
  cost: number;
  damageMult: number;
  fireRateMult: number;
  projectiles: number;
  spread: number;
  color: string;
  projectileSize: number;
  speedMult: number;
  barrelLength: number;
  barrelWidth: number;
}

const WEAPONS: Record<string, Weapon> = {
  RAILGUN: {
    id: "RAILGUN",
    name: "Prototype Railgun",
    description: "Standard kinetic accelerator. High precision, reliable impact.",
    cost: 0,
    damageMult: 1,
    fireRateMult: 1,
    projectiles: 1,
    spread: 0,
    color: "#fff",
    projectileSize: 3,
    speedMult: 1,
    barrelLength: 20,
    barrelWidth: 4
  },
  PLASMA_SHOTGUN: {
    id: "PLASMA_SHOTGUN",
    name: "Plasma Scatter-gun",
    description: "Fires multiple short-range plasma bolts. Devastating up close.",
    cost: 500,
    damageMult: 0.8,
    fireRateMult: 0.7,
    projectiles: 6,
    spread: 0.4,
    color: "#1aff1a",
    projectileSize: 4,
    speedMult: 0.8,
    barrelLength: 15,
    barrelWidth: 10
  },
  LASER_RIFLE: {
    id: "LASER_RIFLE",
    name: "AEC Laser Rifle",
    description: "Continuous fire energy platform. High cyclic rate, moderate heat.",
    cost: 1200,
    damageMult: 0.4,
    fireRateMult: 3.5,
    projectiles: 1,
    spread: 0.05,
    color: "#ff1a1a",
    projectileSize: 2,
    speedMult: 1.5,
    barrelLength: 25,
    barrelWidth: 3
  },
  TESLA_CANNON: {
    id: "TESLA_CANNON",
    name: "Tesla Arc Cannon",
    description: "Heavy mass-driver firing electrified slugs. Massive damage.",
    cost: 2500,
    damageMult: 3.5,
    fireRateMult: 0.4,
    projectiles: 1,
    spread: 0,
    color: "#1a1aff",
    projectileSize: 8,
    speedMult: 0.6,
    barrelLength: 30,
    barrelWidth: 12
  }
};

const PLAYER_SPEED = 4;
const PLAYER_SIZE = 24;
const BULLET_SPEED = 10;
const ENEMY_SPAWN_RATE = 0.015;

interface WeakSpot {
  id: number;
  relX: number;
  relY: number;
  radius: number;
  active: boolean;
}

interface Boss extends Entity {
  hp: number;
  maxHp: number;
  weakSpots: WeakSpot[];
}

interface GameStateMetadata {
  survivalTime: number; // in seconds
  boss: Boss | null;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [gameState, setGameState] = useState<GameState>("LOGIN");
  const [score, setScore] = useState(0);
  const [availableLobbies, setAvailableLobbies] = useState<any[]>([]);

  const handleCreateLobby = () => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    setLobbyCode(code);
    setIsMultiplayer(true);
    socketRef.current?.emit("join_lobby", { lobbyCode: code, userData: user });
    setGameState("LOBBY");
  };

  const handleJoinLobby = (codeOverride?: string) => {
    const code = (codeOverride || inputLobbyCode).toUpperCase();
    if (!code) return;
    setLobbyCode(code);
    setIsMultiplayer(true);
    socketRef.current?.emit("join_lobby", { lobbyCode: code, userData: user });
    setGameState("LOBBY");
  };

  const handleQuickJoin = () => {
    setIsMultiplayer(true);
    socketRef.current?.emit("join_lobby", { lobbyCode: "PUBLIC_SECTOR", userData: user });
    setGameState("LOBBY");
  };

  useEffect(() => {
    if (gameState === "LOBBY_SELECT") {
      socketRef.current?.emit("request_lobbies");
      const interval = setInterval(() => {
        socketRef.current?.emit("request_lobbies");
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [gameState]);

  const [scrapEarnedInMission, setScrapEarnedInMission] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [captureProgress, setCaptureProgress] = useState(0);
  const [captureZone, setCaptureZone] = useState<{ x: number, y: number, radius: number } | null>(null);
  const [isContested, setIsContested] = useState(false);
  const captureZoneRef = useRef<{ x: number, y: number, radius: number } | null>(null);
  const [scrap, setScrap] = useState(0);
  const [wave, setWave] = useState(1);
  const [currentLocationId, setCurrentLocationId] = useState(1);
  const [capturedSinceDefense, setCapturedSinceDefense] = useState(0);
  const [siegeActive, setSiegeActive] = useState(false);
  const [isTraveling, setIsTraveling] = useState(false);
  const [survivalTime, setSurvivalTime] = useState(0);
  const [boss, setBoss] = useState<Boss | null>(null);
  const [isMultiplayer, setIsMultiplayer] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [lobbyCode, setLobbyCode] = useState("");
  const [inputLobbyCode, setInputLobbyCode] = useState("");
  const [multiConfig, setMultiConfig] = useState({
    weaponId: "RAILGUN",
    mapItems: [] as Obstacle[]
  });
  const [otherPlayers, setOtherPlayers] = useState<Record<string, PlayerState>>({});
  const [builderType, setBuilderType] = useState<"WALL" | "FLAG" | "SPAWNER">("WALL");
  const [spawnerRate, setSpawnerRate] = useState(1);
  const [spawnerType, setSpawnerType] = useState<Enemy["type"]>("ZOMBIE");
  const [builderWidth, setBuilderWidth] = useState(40);
  const [builderHeight, setBuilderHeight] = useState(40);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<Socket | null>(null);

  // Audio for Siege / Combat starts
  const combatAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) setGameState("LOGIN");
      else if (gameState === "LOGIN") setGameState("INTRO");
    });
    return () => unsub();
  }, [gameState]);

  useEffect(() => {
    // Only play if it's a defense mission (Vault 99 attack or Counter-attack)
    const isVaultDefense = gameState === "DEFENSE";
    
    if (isVaultDefense) {
      if (!combatAudioRef.current) {
        combatAudioRef.current = new Audio("https://www.image2url.com/r2/default/audio/1776694595775-437d5b03-100f-4eb3-8df1-3ec430a37091.wav");
        combatAudioRef.current.volume = 0.4;
        combatAudioRef.current.loop = true;
      }
      combatAudioRef.current.play().catch(e => console.log("Audio play failed:", e));
    } else {
      if (combatAudioRef.current) {
        combatAudioRef.current.pause();
        combatAudioRef.current.currentTime = 0;
      }
    }

    return () => {
      if (combatAudioRef.current) {
        combatAudioRef.current.pause();
      }
    };
  }, [gameState]);

  useEffect(() => {
    // Multiplayer Foundation
    socketRef.current = io();
    
    socketRef.current.on("connect_error", (err) => {
      console.warn("Retrying tactical network connection:", err.message);
    });
    socketRef.current.on("other_players", (players) => {
      setOtherPlayers(players);
    });

    socketRef.current.on("host_status", ({ isHost }) => {
      setIsHost(isHost);
    });

    socketRef.current.on("sync_config", (config) => {
      setMultiConfig(config);
      // Force weapon if in multiplayer
      setCurrentWeaponId(config.weaponId);
    });

    socketRef.current.on("lobby_list", (list) => {
      setAvailableLobbies(list);
    });

    socketRef.current.on("mission_started", () => {
      // RESET LOCAL PLAYER STATE TO PREVENT RECONNECT DEATH
      playerHPRef.current = 100 * upgrades.health;
      setPlayerHP(playerHPRef.current);
      playerArmorRef.current = 50 * upgrades.armor;
      setPlayerArmor(playerArmorRef.current);
      
      startCustomMultiplayerMission();
    });

    socketRef.current.on("player_disconnected", (id) => {
      setOtherPlayers(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  const [managedBase, setManagedBase] = useState<BaseNode | null>(null);
  
  // Upgrades state
  const [upgrades, setUpgrades] = useState<Record<string, number>>({
    damage: 1,
    fireRate: 1,
    speed: 1,
    health: 1,
    baseDefense: 1,
    armor: 0,
  });

  const [ownedWeapons, setOwnedWeapons] = useState<string[]>(["RAILGUN"]);
  const [currentWeaponId, setCurrentWeaponId] = useState<string>("RAILGUN");
  const currentWeapon = WEAPONS[currentWeaponId];

  const UPGRADE_COSTS = {
    damage: (lvl: number) => 50 * lvl,
    fireRate: (lvl: number) => 75 * lvl,
    speed: (lvl: number) => 40 * lvl,
    health: (lvl: number) => 60 * lvl,
    baseDefense: (lvl: number) => 100 * lvl,
    armor: (lvl: number) => 150 * (lvl + 1),
  };
  
  // Weapon state
  const [aimAngle, setAimAngle] = useState(0);

  // Base persistence
  const [bases, setBases] = useState<BaseNode[]>([
    { id: 1, name: "Vault 99", x: 10, y: 10, captured: true, difficulty: 0, type: "VAULT", health: 100, machines: [] },
    { id: 2, name: "Sunset Outpost", x: 25, y: 15, captured: false, difficulty: 1, type: "OUTPOST", health: 100, machines: [] },
    { id: 3, name: "Wasteland Tower", x: 45, y: 10, captured: false, difficulty: 2, type: "TOWER", health: 100, machines: [] },
    { id: 4, name: "Silo Delta", x: 65, y: 15, captured: false, difficulty: 3, type: "OUTPOST", health: 100, machines: [] },
    { id: 5, name: "Ruins of Zion", x: 85, y: 10, captured: false, difficulty: 4, type: "RUINS", health: 100, machines: [] },
    { id: 6, name: "Nuka Station", x: 15, y: 35, captured: false, difficulty: 2, type: "OUTPOST", health: 100, machines: [] },
    { id: 7, name: "Dust Reservoir", x: 35, y: 40, captured: false, difficulty: 3, type: "TOWER", health: 100, machines: [] },
    { id: 8, name: "Bunker 13", x: 55, y: 35, captured: false, difficulty: 2, type: "VAULT", health: 100, machines: [] },
    { id: 9, name: "Ghost Town", x: 75, y: 45, captured: false, difficulty: 5, type: "RUINS", health: 100, machines: [] },
    { id: 10, name: "Iron Peak", x: 90, y: 30, captured: false, difficulty: 4, type: "TOWER", health: 100, machines: [] },
    { id: 11, name: "Oasis Alpha", x: 10, y: 65, captured: false, difficulty: 1, type: "OUTPOST", health: 100, machines: [] },
    { id: 12, name: "Scrap Heap", x: 30, y: 60, captured: false, difficulty: 3, type: "RUINS", health: 100, machines: [] },
    { id: 13, name: "Comm Tower 7", x: 50, y: 70, captured: false, difficulty: 2, type: "TOWER", health: 100, machines: [] },
    { id: 14, name: "Sands Fort", x: 70, y: 65, captured: false, difficulty: 4, type: "OUTPOST", health: 100, machines: [] },
    { id: 15, name: "Dead End Vault", x: 90, y: 75, captured: false, difficulty: 6, type: "VAULT", health: 100, machines: [] },
    { id: 16, name: "Copper Mine", x: 20, y: 85, captured: false, difficulty: 3, type: "RUINS", health: 100, machines: [] },
    { id: 17, name: "Radar Array", x: 40, y: 90, captured: false, difficulty: 5, type: "TOWER", health: 100, machines: [] },
    { id: 18, name: "Water Well", x: 60, y: 85, captured: false, difficulty: 1, type: "OUTPOST", health: 100, machines: [] },
    { id: 19, name: "Old Highway 6", x: 80, y: 95, captured: false, difficulty: 2, type: "RUINS", health: 100, machines: [] },
    { id: 20, name: "The Citadel", x: 15, y: 55, captured: false, difficulty: 7, type: "TOWER", health: 100, machines: [] },
    { id: 21, name: "Hidden Depot", x: 75, y: 25, captured: false, difficulty: 4, type: "OUTPOST", health: 100, machines: [] },
    { id: 22, name: "Radiation Pit", x: 40, y: 55, captured: false, difficulty: 5, type: "RUINS", health: 100, machines: [] },
    { id: 23, name: "Watchtower B", x: 60, y: 5, captured: false, difficulty: 3, type: "TOWER", health: 100, machines: [] },
    { id: 24, name: "Junkyard X", x: 5, y: 25, captured: false, difficulty: 2, type: "RUINS", health: 100, machines: [] },
    { id: 25, name: "Vault 111", x: 95, y: 50, captured: false, difficulty: 8, type: "VAULT", health: 100, machines: [] },
    { id: 26, name: "Gas Stop", x: 5, y: 80, captured: false, difficulty: 1, type: "OUTPOST", health: 100, machines: [] },
    { id: 27, name: "Mountain Peak", x: 85, y: 85, captured: false, difficulty: 6, type: "TOWER", health: 100, machines: [] },
    { id: 28, name: "Concrete Factory", x: 55, y: 55, captured: false, difficulty: 4, type: "OUTPOST", health: 100, machines: [] },
    { id: 29, name: "Desert Rose", x: 25, y: 45, captured: false, difficulty: 3, type: "RUINS", health: 100, machines: [] },
    { id: 30, name: "End of Line", x: 95, y: 95, captured: false, difficulty: 10, type: "TOWER", health: 100, machines: [] },
  ]);
  const [activeBase, setActiveBase] = useState<BaseNode | null>(null);

  // Persistence
  useEffect(() => {
    const saved = localStorage.getItem("wasteland_survivor_save");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.highScore !== undefined) setHighScore(data.highScore);
        if (data.scrap !== undefined) setScrap(data.scrap);
        if (data.currentLocationId !== undefined) setCurrentLocationId(data.currentLocationId);
        if (data.upgrades !== undefined) setUpgrades(data.upgrades);
        if (data.ownedWeapons !== undefined) setOwnedWeapons(data.ownedWeapons);
        if (data.currentWeaponId !== undefined) setCurrentWeaponId(data.currentWeaponId);
        if (data.bases !== undefined) setBases(data.bases);
      } catch (e) {
        console.error("Failed to load save", e);
      }
    }
  }, []);

  useEffect(() => {
    const saveData = {
      highScore,
      scrap,
      currentLocationId,
      upgrades,
      ownedWeapons,
      currentWeaponId,
      bases
    };
    localStorage.setItem("wasteland_survivor_save", JSON.stringify(saveData));
  }, [highScore, scrap, currentLocationId, upgrades, ownedWeapons, currentWeaponId, bases]);

  // Passive Income Logic
  useEffect(() => {
    const timer = setInterval(() => {
      const capturedBases = bases.filter(b => b.captured);
      let income = 0;
      capturedBases.forEach(b => {
        // Machines generate scrap based on count
        income += (b.machines?.length || 0) * 5;
      });
      if (income > 0) {
        setScrap(prev => prev + income);
      }
    }, 10000); // Every 10 seconds
    return () => clearInterval(timer);
  }, [bases]);

  // State for rendering
  const [playerPos, setPlayerPos] = useState({ x: 0, y: 0 });
  const [playerHP, setPlayerHP] = useState(100);
  const [playerArmor, setPlayerArmor] = useState(0);
  const [vaultHP, setVaultHP] = useState(1000);
  const [bullets, setBullets] = useState<Bullet[]>([]);
  const [enemyBullets, setEnemyBullets] = useState<EnemyBullet[]>([]);
  const [enemies, setEnemies] = useState<Enemy[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);

  // Internal game state with refs for performance
  const playerRef = useRef({ x: 0, y: 0 });
  const playerHPRef = useRef(100);
  const playerArmorRef = useRef(0);
  const vaultHPRef = useRef(1000);
  const bulletsRef = useRef<Bullet[]>([]);
  const enemyBulletsRef = useRef<EnemyBullet[]>([]);
  const enemiesRef = useRef<Enemy[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const obstaclesRef = useRef<Obstacle[]>([]);
  const keysRef = useRef<Record<string, boolean>>({});
  const mouseRef = useRef({ x: 0, y: 0, down: false });
  const containerRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number>(null);
  const idCounterRef = useRef(0);
  const captureProgressRef = useRef(0);
  const enemiesDefeatedRef = useRef(0);
  const killsRequiredRef = useRef(20);
  const bossHPRef = useRef(0);
  const survivalTimeRef = useRef(0);
  const lastTimeRef = useRef(0);

  const lastFireTimeRef = useRef(0);

  const startInfiltration = (base: BaseNode) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    setActiveBase(base);
    setCurrentLocationId(base.id);
    enemiesDefeatedRef.current = 0;
    killsRequiredRef.current = 15 + (base.difficulty * 10);
    captureProgressRef.current = 0;
    setCaptureProgress(0);

    const vw = rect.width;
    const vh = rect.height;
    
    // Infiltration Spawn: Center of the vertical corridor for Vaults, bottom for others
    const spawnX = vw / 2;
    const spawnY = base.type === "VAULT" ? vh / 2 : vh - 100;
    
    playerRef.current = { x: spawnX, y: spawnY };
    setPlayerPos({ ...playerRef.current });
    playerHPRef.current = 100 * upgrades.health;
    setPlayerHP(playerHPRef.current);
    playerArmorRef.current = 50 * upgrades.armor;
    setPlayerArmor(playerArmorRef.current);
    vaultHPRef.current = 1000 * upgrades.baseDefense;
    setVaultHP(vaultHPRef.current);
    
    bulletsRef.current = [];
    enemyBulletsRef.current = [];
    enemiesRef.current = [];
    particlesRef.current = [];
    obstaclesRef.current = [];
    captureProgressRef.current = 0;
    
    // Generate Obstacles based on base type
    const newObstacles: Obstacle[] = [];

    if (base.type === "VAULT") {
        // Bunker Layout (Corridors)
        const wallThick = 50;
        const midX = vw / 2;
        const midY = vh / 2;
        const corridorWidth = 180;
        const blockW = vw/2 - corridorWidth/2 - wallThick;
        const blockH = vh/2 - corridorWidth/2 - wallThick;

        // External Walls with Corridor Gaps
        newObstacles.push({ id: -1, x: 0, y: 0, w: midX - corridorWidth/2, h: wallThick, radius: 0, type: "WALL" });
        newObstacles.push({ id: -11, x: midX + corridorWidth/2, y: 0, w: vw - (midX + corridorWidth/2), h: wallThick, radius: 0, type: "WALL" });
        
        newObstacles.push({ id: -2, x: 0, y: vh - wallThick, w: midX - corridorWidth/2, h: wallThick, radius: 0, type: "WALL" });
        newObstacles.push({ id: -21, x: midX + corridorWidth/2, y: vh - wallThick, w: vw - (midX + corridorWidth/2), h: wallThick, radius: 0, type: "WALL" });
        
        newObstacles.push({ id: -3, x: 0, y: 0, w: wallThick, h: midY - corridorWidth/2, radius: 0, type: "WALL" });
        newObstacles.push({ id: -31, x: 0, y: midY + corridorWidth/2, w: wallThick, h: vh - (midY + corridorWidth/2), radius: 0, type: "WALL" });
        
        newObstacles.push({ id: -4, x: vw - wallThick, y: 0, w: wallThick, h: midY - corridorWidth/2, radius: 0, type: "WALL" });
        newObstacles.push({ id: -41, x: vw - wallThick, y: midY + corridorWidth/2, w: wallThick, h: vh - (midY + corridorWidth/2), radius: 0, type: "WALL" });

        // Corner rooms - shifted slightly to ensure corridor is wide enough
        newObstacles.push({ id: -5, x: wallThick, y: wallThick, w: blockW, h: blockH, radius: 0, type: "WALL" });
        newObstacles.push({ id: -6, x: midX + corridorWidth/2, y: wallThick, w: blockW, h: blockH, radius: 0, type: "WALL" });
        newObstacles.push({ id: -7, x: wallThick, y: midY + corridorWidth/2, w: blockW, h: blockH, radius: 0, type: "WALL" });
        newObstacles.push({ id: -8, x: midX + corridorWidth/2, y: midY + corridorWidth/2, w: blockW, h: blockH, radius: 0, type: "WALL" });

        // Removed the pillars that were right in the vertical corridor (id -9, -10)
        // to prevent player from spawning inside them.
    } else {
        // Wasteland/Outpost Layout (Open with crates)
        for (let i = 0; i < 8; i++) {
            let cx, cy;
            // Ensure crates don't spawn on top of the player's new spawn point
            do {
                cx = Math.random() * (vw - 200) + 100;
                cy = Math.random() * (vh - 200) + 100;
            } while (
                Math.abs(cx - spawnX) < 100 && 
                Math.abs(cy - spawnY) < 100
            );

            newObstacles.push({ 
                id: -10 - i, 
                x: cx, 
                y: cy, 
                w: 60, 
                h: 60, 
                radius: 0,
                type: "CRATE"
            });
        }
        
        if (base.type === "TOWER") {
            newObstacles.push({ id: -50, x: vw/2 - 50, y: vh/2 - 50, w: 100, h: 100, radius: 0, type: "WALL" });
        }
    }

    obstaclesRef.current = newObstacles;
    setObstacles(newObstacles);

    // Final safety nudge: if spawning inside an obstacle, move player up
    let attempts = 0;
    while (attempts < 10) {
      const px = playerRef.current.x;
      const py = playerRef.current.y;
      const size = PLAYER_SIZE / 2;
      const overlap = newObstacles.find(obs => 
        px + size > obs.x && px - size < obs.x + obs.w &&
        py + size > obs.y && py - size < obs.y + obs.h
      );
      if (overlap) {
        playerRef.current.y -= 20;
        attempts++;
      } else {
        break;
      }
    }
    setPlayerPos({ ...playerRef.current });

    setBullets([]);
    setEnemyBullets([]);
    setEnemies([]);
    setParticles([]);
    setCaptureProgress(0);
    setScrapEarnedInMission(0);
    
    // Set up Capture Zone
    const zone = {
      x: vw / 2,
      y: vh / 2,
      radius: 120
    };
    setCaptureZone(zone);
    captureZoneRef.current = zone;
    setIsContested(false);

    // Initial Defenders
    const defenderCount = 5 + base.difficulty * 2;
    for (let i = 0; i < defenderCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 150 + Math.random() * 100;
        enemiesRef.current.push({
            id: idCounterRef.current++,
            x: zone.x + Math.cos(angle) * dist,
            y: zone.y + Math.sin(angle) * dist,
            radius: 12,
            hp: 1 + Math.floor(base.difficulty/2),
            speed: 1.0,
            color: "#1aff1a",
            type: "ZOMBIE"
        });
    }

    // Capture Zone Fortifications (4 blocks around the circle)
    const fortSize = 40;
    const fortOffset = zone.radius + 20;
    newObstacles.push({ id: -201, x: zone.x - fortOffset - fortSize/2, y: zone.y - fortSize/2, w: fortSize, h: fortSize, radius: 0, type: "WALL" });
    newObstacles.push({ id: -202, x: zone.x + fortOffset - fortSize/2, y: zone.y - fortSize/2, w: fortSize, h: fortSize, radius: 0, type: "WALL" });
    newObstacles.push({ id: -203, x: zone.x - fortSize/2, y: zone.y - fortOffset - fortSize/2, w: fortSize, h: fortSize, radius: 0, type: "WALL" });
    newObstacles.push({ id: -204, x: zone.x - fortSize/2, y: zone.y + fortOffset - fortSize/2, w: fortSize, h: fortSize, radius: 0, type: "WALL" });
    setObstacles([...newObstacles]);

    setScore(0);
    setGameState("PLAYING");
  };

  const startDefense = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const vault = bases.find(b => b.id === 1);
    if (!vault) return;
    setActiveBase(vault);
    setCurrentLocationId(1);
    enemiesDefeatedRef.current = 0;
    killsRequiredRef.current = 40 + (wave * 15);
    setCaptureProgress(0);
    setScrapEarnedInMission(0);

    const vw = rect.width;
    const vh = rect.height;

    if (vault.id === 1) {
      survivalTimeRef.current = 360; // 6:00
      setSurvivalTime(360);
      lastTimeRef.current = Date.now();

      const newBoss: Boss = {
        id: 9999,
        x: vw / 2,
        y: 150,
        radius: 80,
        hp: 10000 * wave,
        maxHp: 10000 * wave,
        weakSpots: [
          { id: 1, relX: -50, relY: -20, radius: 25, active: true },
          { id: 2, relX: 0, relY: 40, radius: 25, active: true },
          { id: 3, relX: 50, relY: -20, radius: 25, active: true },
        ]
      };
      setBoss(newBoss);
      bossHPRef.current = newBoss.hp;
    } else {
      setBoss(null);
      bossHPRef.current = 0;
      survivalTimeRef.current = 0;
      setSurvivalTime(0);
    }

    // Player stands on the wall at the bottom
    const wallY = vh - 120;
    playerRef.current = { x: vw / 2, y: wallY + 30 };
    setPlayerPos({ ...playerRef.current });
    playerHPRef.current = 100 * upgrades.health;
    setPlayerHP(playerHPRef.current);
    playerArmorRef.current = 50 * upgrades.armor;
    setPlayerArmor(playerArmorRef.current);
    
    // Vault HP is now Wall HP, scaled by baseDefense upgrade
    vaultHPRef.current = 1000 * upgrades.baseDefense;
    setVaultHP(vaultHPRef.current);
    
    bulletsRef.current = [];
    enemyBulletsRef.current = [];
    enemiesRef.current = [];
    particlesRef.current = [];
    
    // Wall Defense Layout: One big wall at the bottom
    const wallThick = 60;
    const newObstacles: Obstacle[] = [];
    
    // The Defensive Wall
    newObstacles.push({ 
      id: -100, 
      x: 0, 
      y: wallY, 
      w: vw, 
      h: wallThick, 
      radius: 0, 
      type: "WALL" 
    });

    // Side walls to keep the vibe
    newObstacles.push({ id: -101, x: 0, y: 0, w: 20, h: vh, radius: 0, type: "WALL" });
    newObstacles.push({ id: -102, x: vw - 20, y: 0, w: 20, h: vh, radius: 0, type: "WALL" });

    obstaclesRef.current = newObstacles;
    setObstacles(newObstacles);

    setBullets([]);
    setEnemyBullets([]);
    setEnemies([]);
    setParticles([]);
    setCaptureProgress(0);
    setScore(0);
    setGameState("DEFENSE");
  };

  const fastTravel = (base: BaseNode) => {
    if (isTraveling || currentLocationId === base.id) return;
    setIsTraveling(true);
    setTimeout(() => {
      setCurrentLocationId(base.id);
      setIsTraveling(false);
      // In a real app we might scroll here, but auto-scroll relies on layout
    }, 1000);
  };

  const buyUpgrade = (key: string) => {
    const currentLvl = upgrades[key];
    const cost = UPGRADE_COSTS[key as keyof typeof UPGRADE_COSTS](currentLvl);
    if (scrap >= cost) {
      setScrap(prev => prev - cost);
      setUpgrades(prev => ({ ...prev, [key]: currentLvl + 1 }));
    }
  };

  const buyWeapon = (weaponId: string) => {
    const weapon = WEAPONS[weaponId];
    if (scrap >= weapon.cost && !ownedWeapons.includes(weaponId)) {
      setScrap(s => s - weapon.cost);
      setOwnedWeapons(prev => [...prev, weaponId]);
      setCurrentWeaponId(weaponId);
    }
  };

  const selectWeapon = (weaponId: string) => {
    if (ownedWeapons.includes(weaponId)) {
      setCurrentWeaponId(weaponId);
    }
  };

  const placeMachine = (gridIndex: number) => {
    if (!managedBase) return;
    const cost = 1000;
    if (scrap >= cost && !managedBase.machines.includes(gridIndex)) {
      setScrap(s => s - cost);
      const updatedMachines = [...managedBase.machines, gridIndex];
      setBases(prev => prev.map(b => 
        b.id === managedBase.id 
        ? { ...b, machines: updatedMachines } 
        : b
      ));
      setManagedBase(prev => prev ? ({ ...prev, machines: updatedMachines }) : null);
    }
  };

  const repairBase = () => {
    if (!managedBase) return;
    const repairAmount = 100 - managedBase.health;
    const cost = Math.floor(repairAmount * 10);
    if (scrap >= cost && repairAmount > 0) {
      setScrap(s => s - cost);
      setBases(prev => prev.map(b => b.id === managedBase.id ? { ...b, health: 100 } : b));
      setManagedBase(prev => prev ? ({ ...prev, health: 100 }) : null);
    }
  };

  const handleGameOver = (win: boolean = false) => {
    if (win && activeBase) {
      const isInfiltration = (gameState === "PLAYING");
      const isCounterAttack = (gameState === "DEFENSE" && activeBase.id !== 1);
      
      if (isInfiltration || isCounterAttack) {
        // Award mission completion rewards
        setBases(prev => prev.map(b => b.id === activeBase.id ? { ...b, captured: true } : b));
        
        // Base reward: difficulty * 200 + 200
        const missionReward = (activeBase.difficulty + 1) * 200;
        setScrap(s => s + missionReward);
        setScrapEarnedInMission(s => s + missionReward);
        
        // If it was a counter-attack, give a bonus for the extra effort
        if (isCounterAttack) {
          const siegeBonus = 500;
          setScrap(s => s + siegeBonus); 
          setScrapEarnedInMission(s => s + siegeBonus);
        }
        
        setCapturedSinceDefense(prev => {
          const next = prev + 1;
          if (next >= 10 && Math.random() < 0.15) {
            setSiegeActive(true);
          }
          return next;
        });
      }
    }

    if (win && gameState === "DEFENSE") {
      // Standard Siege Defense reward (Base 1) or Counter-attack survival reward
      const defenseReward = wave * 300;
      setScrap(s => s + defenseReward);
      
      if (activeBase?.id === 1) {
        setWave(w => w + 1);
        setCapturedSinceDefense(0);
        setSiegeActive(false);
      }
    }
    if (!win && activeBase) {
      // Reduce base health on defeat
      setBases(prev => prev.map(b => b.id === activeBase.id ? { ...b, health: Math.max(0, b.health - 25) } : b));
    }

    if (isMultiplayer && !win) {
       // Multiplayer special death: don't end game, just show options
       setPlayerHP(0);
       setGameState("GAMEOVER");
    } else {
       setGameState("GAMEOVER");
       setHighScore((prev) => Math.max(prev, score));
    }

    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    
    // Cleanup entities
    enemiesRef.current = [];
    bulletsRef.current = [];
    enemyBulletsRef.current = [];
    particlesRef.current = [];
  };

  const spawnBullet = (targetX: number, targetY: number) => {
    if (gameState !== "PLAYING" && gameState !== "DEFENSE") return;
    
    const count = currentWeapon.projectiles;
    const spread = currentWeapon.spread;
    const baseAngle = Math.atan2(targetY - playerRef.current.y, targetX - playerRef.current.x);

    for (let i = 0; i < count; i++) {
        const angle = baseAngle + (Math.random() - 0.5) * spread;
        const speed = BULLET_SPEED * currentWeapon.speedMult;
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed;

        bulletsRef.current.push({
          id: idCounterRef.current++,
          x: playerRef.current.x,
          y: playerRef.current.y,
          vx,
          vy,
          radius: currentWeapon.projectileSize,
          color: currentWeapon.color
        });
    }
  };

  const spawnEnemyBullet = (ex: number, ey: number, tx: number, ty: number) => {
    const dx = tx - ex;
    const dy = ty - ey;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const vx = (dx / dist) * 5;
    const vy = (dy / dist) * 5;

    enemyBulletsRef.current.push({
      id: idCounterRef.current++,
      x: ex,
      y: ey,
      vx,
      vy,
      radius: 8
    });
  };

  const spawnExplosion = (x: number, y: number, color: string, count = 6) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 2;
      particlesRef.current.push({
        id: idCounterRef.current++,
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 1 + Math.random() * 2,
        life: 1,
        color
      });
    }
  };

  const update = useCallback((time: number) => {
    if (gameState !== "PLAYING" && gameState !== "DEFENSE") return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    // 1. Move Player
    const speed = PLAYER_SPEED * (0.8 + upgrades.speed * 0.2);
    const oldX = playerRef.current.x;
    const oldY = playerRef.current.y;

    if (keysRef.current["KeyW"] || keysRef.current["ArrowUp"]) playerRef.current.y -= speed;
    if (keysRef.current["KeyS"] || keysRef.current["ArrowDown"]) playerRef.current.y += speed;
    if (keysRef.current["KeyA"] || keysRef.current["ArrowLeft"]) playerRef.current.x -= speed;
    if (keysRef.current["KeyD"] || keysRef.current["ArrowRight"]) playerRef.current.x += speed;

    // Obstacle Collision for Player
    obstaclesRef.current.forEach(obs => {
      if (gameState === "DEFENSE" && obs.id === -100) return;
      
      const px = playerRef.current.x;
      const py = playerRef.current.y;
      const size = PLAYER_SIZE / 2;
      
      if (px + size > obs.x && px - size < obs.x + obs.w &&
          py + size > obs.y && py - size < obs.y + obs.h) {
        // Simple collision recoil
        playerRef.current.x = oldX;
        playerRef.current.y = oldY;
      }
    });

    // Boundaries
    if (gameState === "DEFENSE") {
        playerRef.current.y = Math.max(rect.height - 110, Math.min(rect.height - 60, playerRef.current.y));
    }
    playerRef.current.x = Math.max(PLAYER_SIZE, Math.min(rect.width - PLAYER_SIZE, playerRef.current.x));
    playerRef.current.y = Math.max(PLAYER_SIZE, Math.min(rect.height - PLAYER_SIZE, playerRef.current.y));
    setPlayerPos({ ...playerRef.current });

    // Aim Angle
    const angle = Math.atan2(mouseRef.current.y - playerRef.current.y, mouseRef.current.x - playerRef.current.x);
    setAimAngle(angle * (180 / Math.PI));

    // 2. Weapon Logic (Rapid Fire)
    if (mouseRef.current.down) {
      const baseFireCooldown = 220 - (upgrades.fireRate * 20);
      const fireCooldown = baseFireCooldown / currentWeapon.fireRateMult;
      if (time - lastFireTimeRef.current > Math.max(50, fireCooldown)) {
        spawnBullet(mouseRef.current.x, mouseRef.current.y);
        lastFireTimeRef.current = time;
      }
    }

    // Capture Logic (Timed Zone Control)
    if (gameState === "PLAYING") {
        const zone = captureZoneRef.current;
        if (zone) {
            const dx = playerRef.current.x - zone.x;
            const dy = playerRef.current.y - zone.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const inZone = dist < zone.radius;

            const enemyInZone = enemiesRef.current.some(e => {
                const edx = e.x - zone.x;
                const edy = e.y - zone.y;
                return Math.sqrt(edx * edx + edy * edy) < zone.radius + e.radius;
            });

            setIsContested(enemyInZone);

            if (inZone && !enemyInZone) {
                // Capture Progress: 100 / (Time in seconds * 60 fps)
                const captureTimeSeconds = 15 + (activeBase?.difficulty || 0) * 5;
                const tick = 100 / (captureTimeSeconds * 60);
                captureProgressRef.current = Math.min(100, captureProgressRef.current + tick);
                setCaptureProgress(Math.floor(captureProgressRef.current));
            } else if (!inZone && captureProgressRef.current > 0) {
                // Slow decay if player leaves
                captureProgressRef.current = Math.max(0, captureProgressRef.current - 0.05);
                setCaptureProgress(Math.floor(captureProgressRef.current));
            }

            if (captureProgressRef.current >= 100) {
                // Chance for immediate defense sequence (Counter-attack)
                if (Math.random() < 0.4 && activeBase?.id !== 1) {
                    // Trigger Counter-attack
                    setGameState("DEFENSE");
                    // Reset progress for defense wave
                    enemiesDefeatedRef.current = 0;
                    killsRequiredRef.current = 20 + (activeBase?.difficulty || 0) * 10;
                    captureProgressRef.current = 0;
                    setCaptureProgress(0);
                    // Defensive wall for the counter-attack
                    const vw = rect.width;
                    const vh = rect.height;
                    const wallY = vh - 120;
                    obstaclesRef.current.push({ id: -100, x: 0, y: wallY, w: vw, h: 20, radius: 0, type: "WALL" });
                    setObstacles([...obstaclesRef.current]);
                    // Pulse alert
                    spawnExplosion(vw/2, vh/2, "#f11", 20);
                } else {
                    handleGameOver(true);
                }
                return;
            }
        }
    }

    // 3. Capture Progress or Wave Defense
    if (gameState === "DEFENSE") {
        const progress = (enemiesDefeatedRef.current / killsRequiredRef.current) * 100;
        setCaptureProgress(Math.min(100, Math.floor(progress)));
        captureProgressRef.current = progress;

        if (progress >= 100) {
          handleGameOver(true);
          return;
        }

        if (gameState === "DEFENSE") {
          // Wall HP takes damage from enemies that reach it
          // This is handled in the enemy movement loop
          if (vaultHPRef.current <= 0) {
              handleGameOver(false);
              return;
          }
        }
    }

    // 4. Move & Clean Bullets
      bulletsRef.current = bulletsRef.current
      .map(b => ({ ...b, x: b.x + b.vx, y: b.y + b.vy }))
      .filter(b => {
        const hitWall = obstaclesRef.current.some(obs => {
          // Player bullets pass through the defensive wall (id: -100)
          if (gameState === "DEFENSE" && obs.id === -100) return false;
          return b.x > (obs.x - 2) && b.x < (obs.x + obs.w + 2) && b.y > (obs.y - 2) && b.y < (obs.y + obs.h + 2);
        });
        return !hitWall && b.x > 0 && b.x < rect.width && b.y > 0 && b.y < rect.height;
      });
    
    enemyBulletsRef.current = enemyBulletsRef.current
      .map(b => ({ ...b, x: b.x + b.vx, y: b.y + b.vy }))
      .filter(b => {
        const hitWall = obstaclesRef.current.some(obs => 
          b.x > obs.x && b.x < obs.x + obs.w && b.y > obs.y && b.y < obs.y + obs.h
        );
        return !hitWall && b.x > 0 && b.x < rect.width && b.y > 0 && b.y < rect.height;
      });

    // 5. Move & Spawn Enemies (Zombies)
    const baseDifficulty = gameState === "DEFENSE" ? 2 + wave : (activeBase?.difficulty || 0);
    // Hordes go from easy to difficult based on mission progress (0% to 100%)
    const progressMultiplier = 0.8 + (captureProgressRef.current / 100); 
    const spawnChance = ENEMY_SPAWN_RATE * (0.3 + baseDifficulty * 0.4) * (gameState === "DEFENSE" ? 2.5 : 1) * progressMultiplier;
    
    if (Math.random() < spawnChance) {
      let ex = 0, ey = 0;
      if (gameState === "DEFENSE") {
        // Only spawn from the top in wall defense
        ex = Math.random() * (rect.width - 100) + 50;
        ey = -50;
      } else {
        const side = Math.floor(Math.random() * 4);
        if (side === 0) { ex = Math.random() * rect.width; ey = -50; }
        else if (side === 1) { ex = rect.width + 50; ey = Math.random() * rect.height; }
        else if (side === 2) { ex = Math.random() * rect.width; ey = rect.height + 50; }
        else { ex = -50; ey = Math.random() * rect.height; }
      }

      const rand = Math.random();
      let type: Enemy["type"] = "ZOMBIE";
      let hp = 1, speed_val = 1.0, rad = 12, col = "#1aff1a";

      // Runners are disabled in Base 99 (id: 1)
      if (rand < 0.15 && baseDifficulty > 1 && activeBase?.id !== 1) {
        type = "RUNNER"; speed_val = 3.5; hp = 1; rad = 10; col = "#ffff1a";
      } else if (rand < 0.25 && baseDifficulty > 2) {
        type = "BRUTE"; speed_val = 0.8; hp = 5; rad = 22; col = "#ff1a1a";
      } else if (rand < 0.35 && baseDifficulty > 1) {
        type = "SPITTER"; speed_val = 1.2; hp = 2; rad = 14; col = "#ff1aff";
      }

      enemiesRef.current.push({
        id: idCounterRef.current++,
        x: ex,
        y: ey,
        radius: rad,
        hp: Math.max(1, hp), // HP scaling already included in type
        speed: speed_val * (0.8 + baseDifficulty * 0.1) * (1.0 + captureProgressRef.current / 400), // Speed scales with difficulty and progress
        color: col,
        type
      });
    }

    // 5.1. Spawner Logic
    const now = Date.now();
    obstaclesRef.current.forEach(obs => {
      if (obs.type === "SPAWNER" && obs.spawnerRate && obs.spawnerType) {
        const interval = 1000 / obs.spawnerRate;
        if (!obs.lastSpawnTime || now - obs.lastSpawnTime > interval) {
          const sRad = 12; // Base radius
          let sHp = 1, sSpeed = 1.0, sCol = "#1aff1a";
          
          if (obs.spawnerType === "RUNNER") { sSpeed = 3.5; sHp = 1; sCol = "#ffff1a"; }
          else if (obs.spawnerType === "BRUTE") { sSpeed = 0.8; sHp = 5; sCol = "#ff1a1a"; }
          else if (obs.spawnerType === "SPITTER") { sSpeed = 1.2; sHp = 2; sCol = "#ff1aff"; }

          enemiesRef.current.push({
            id: idCounterRef.current++,
            x: obs.x + obs.w / 2,
            y: obs.y + obs.h / 2,
            radius: sRad,
            hp: sHp,
            speed: sSpeed * (0.8 + baseDifficulty * 0.1),
            color: sCol,
            type: obs.spawnerType
          });
          obs.lastSpawnTime = now;
        }
      }
    });

    const activeEnemies: Enemy[] = [];
    enemiesRef.current.forEach(e => {
      // In Wall Defense, target the wall at the bottom
      const tx = (gameState === "DEFENSE") ? e.x : playerRef.current.x; // Stay in their lane
      const ty = (gameState === "DEFENSE") ? rect.height - 120 : playerRef.current.y;
      
      const dx = tx - e.x;
      const dy = ty - e.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      
      let moveX = (dx / dist) * e.speed;
      let moveY = (dy / dist) * e.speed;

      // Obstacle collision for enemies (mostly for normal mode)
      const nextX = e.x + moveX;
      const nextY = e.y + moveY;
      let blockedX = false;
      let blockedY = false;

      obstaclesRef.current.forEach(obs => {
        // Skip wall collision for enemies in defense mode (they reach it and attack)
        if (gameState === "DEFENSE" && obs.id === -100) return;

        if (nextX + e.radius > obs.x && nextX - e.radius < obs.x + obs.w &&
            e.y + e.radius > obs.y && e.y - e.radius < obs.y + obs.h) {
          blockedX = true;
        }
        if (e.x + e.radius > obs.x && e.x - e.radius < obs.x + obs.w &&
            nextY + e.radius > obs.y && nextY - e.radius < obs.y + obs.h) {
          blockedY = true;
        }
      });

      if (blockedX) moveX = 0;
      if (blockedY) moveY = 0;

      if (e.type === "SPITTER") {
        const fireDist = gameState === "DEFENSE" ? 400 : 250;
        if (dist < fireDist) {
          moveX = gameState === "DEFENSE" ? 0 : -moveX * 0.5;
          moveY = gameState === "DEFENSE" ? 0 : -moveY * 0.5;
        }
        if (!e.lastShot || time - e.lastShot > 2000) {
          spawnEnemyBullet(e.x, e.y, playerRef.current.x, playerRef.current.y);
          e.lastShot = time;
        }
      }

      // Check for wall impact in Defense mode
      if (gameState === "DEFENSE" && e.y + e.radius >= rect.height - 120) {
        vaultHPRef.current -= (e.type === "BRUTE" ? 15 : 5);
        setVaultHP(Math.max(0, Math.floor(vaultHPRef.current)));
        spawnExplosion(e.x, e.y, "#f55", 3);
        // Enemy is destroyed upon hitting the wall
        return; 
      }

      if (dist < e.radius + PLAYER_SIZE / 2 && gameState !== "DEFENSE") {
        const damage = e.type === "BRUTE" ? 3 : 1;
        if (playerArmorRef.current > 0) {
            playerArmorRef.current -= damage;
            setPlayerArmor(Math.max(0, Math.floor(playerArmorRef.current)));
        } else {
            playerHPRef.current -= damage;
            setPlayerHP(Math.max(0, Math.floor(playerHPRef.current)));
        }
        
        if (playerHPRef.current <= 0) {
            handleGameOver(false);
        }
      }

      activeEnemies.push({
        ...e,
        x: e.x + moveX,
        y: e.y + moveY,
      });
    });
    enemiesRef.current = activeEnemies;

    // 6. Bullet Collision & Boss Logic
    if (boss && activeBase?.id === 1) {
       // Boss movement
       const bossMoveX = Math.sin(time / 2000) * 2;
       setBoss(prev => prev ? ({ ...prev, x: prev.x + bossMoveX }) : null);

       // Boss Attacks
       if (Math.random() < 0.02) {
         spawnEnemyBullet(boss.x, boss.y, playerRef.current.x, playerRef.current.y);
       }
    }

    bulletsRef.current = bulletsRef.current.filter(b => {
      let hit = false;
      
      // Boss collision
      if (boss && activeBase?.id === 1) {
          let bossHit = false;
          // Check weak spots first (high priority)
          boss.weakSpots.forEach(ws => {
             if (ws.active) {
                const wx = boss.x + ws.relX;
                const wy = boss.y + ws.relY;
                const wdx = b.x - wx;
                const wdy = b.y - wy;
                const wdist = Math.sqrt(wdx * wdx + wdy * wdy);
                
                // Generous collision for weak spots
                if (wdist < b.radius + ws.radius + 4) {
                   hit = true;
                   bossHit = true;
                   const dmg = upgrades.damage * currentWeapon.damageMult * 8;
                   bossHPRef.current -= dmg;
                   spawnExplosion(b.x, b.y, "#fff", 8);
                   
                   // Chance to деактивировать (destroy) weak spot? 
                   // The user didn't ask for destruction, just hit detection fix
                }
             }
          });

          // Check main body only if weak spots weren't hit to avoid double damage (or maybe they both take damage?)
          if (!bossHit) {
            const bdx = b.x - boss.x;
            const bdy = b.y - boss.y;
            const bdist = Math.sqrt(bdx * bdx + bdy * bdy);
            if (bdist < b.radius + boss.radius) {
               hit = true;
               bossHPRef.current -= (upgrades.damage * currentWeapon.damageMult);
               spawnExplosion(b.x, b.y, "#f55", 3);
            }
          }

          if (bossHPRef.current <= 0) {
             setBoss(null);
             handleGameOver(true);
             return false;
          }
      }

      enemiesRef.current = enemiesRef.current.filter(e => {
        const dx = b.x - e.x;
        const dy = b.y - e.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < b.radius + e.radius) {
          hit = true;
          e.hp -= (upgrades.damage * currentWeapon.damageMult);
          if (e.hp <= 0) {
            enemiesDefeatedRef.current += 1;
            spawnExplosion(e.x, e.y, e.color, e.type === "BRUTE" ? 12 : 6);
            setScore(s => s + (e.type === "BRUTE" ? 50 : 10));
            
            const scrapGained = (e.type === "BRUTE" ? 20 : 5);
            setScrap(s => s + scrapGained);
            setScrapEarnedInMission(s => s + scrapGained);
            return false;
          }
          return true;
        }
        return true;
      });
      return !hit;
    });

      enemyBulletsRef.current = enemyBulletsRef.current.filter(b => {
        const dx = b.x - playerRef.current.x;
        const dy = b.y - playerRef.current.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < b.radius + PLAYER_SIZE / 2) {
          const bDamage = 10;
          if (playerArmorRef.current > 0) {
              playerArmorRef.current -= bDamage;
              setPlayerArmor(Math.max(0, Math.floor(playerArmorRef.current)));
          } else {
              playerHPRef.current -= bDamage;
              setPlayerHP(Math.max(0, Math.floor(playerHPRef.current)));
          }
          
          if (playerHPRef.current <= 0) {
            handleGameOver(false);
          }
          return false;
        }
        return true;
      });

    // 7. Particles
    particlesRef.current = particlesRef.current
      .map(p => ({ ...p, x: p.x + p.vx, y: p.y + p.vy, life: p.life - 0.03 }))
      .filter(p => p.life > 0);

    // Sync batches - NOW USING CANVAS DRAWING (Minimal state sync for UI elements only)
    setPlayerPos({ ...playerRef.current });
    setPlayerHP(Math.max(0, Math.floor(playerHPRef.current)));
    setPlayerArmor(Math.max(0, Math.floor(playerArmorRef.current)));
    setVaultHP(Math.max(0, Math.floor(vaultHPRef.current)));

    // Timer Update
    if (activeBase?.id === 1 && gameState === "DEFENSE") {
      const now = Date.now();
      if (now - lastTimeRef.current >= 1000) {
        survivalTimeRef.current = Math.max(0, survivalTimeRef.current - 1);
        setSurvivalTime(survivalTimeRef.current);
        lastTimeRef.current = now;
      }
      if (survivalTimeRef.current <= 0) {
        handleGameOver(true);
        return;
      }
    }

    // Canvas Drawing logic
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && rect) {
      ctx.clearRect(0, 0, rect.width, rect.height);
      
      // Draw Obstacles (Base + Shared)
      const allObstacles = [...obstaclesRef.current];
      if (isMultiplayer) {
         multiConfig.mapItems.forEach(item => allObstacles.push(item));
      }

      allObstacles.forEach(obs => {
        if (obs.type === "FLAG") {
          ctx.fillStyle = "rgba(255, 0, 0, 0.3)";
          ctx.strokeStyle = "#ff0000";
          ctx.lineWidth = 3;
          ctx.strokeRect(obs.x, obs.y, obs.w, obs.h);
          ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
          // Draw a small pole/flag icon
          ctx.fillStyle = "#fff";
          ctx.fillRect(obs.x + obs.w/2 - 2, obs.y + 5, 4, obs.h - 10);
          ctx.fillStyle = "#ff0000";
          ctx.beginPath();
          ctx.moveTo(obs.x + obs.w/2, obs.y + 5);
          ctx.lineTo(obs.x + obs.w/2 + 15, obs.y + 12);
          ctx.lineTo(obs.x + obs.w/2, obs.y + 20);
          ctx.fill();
        } else if (obs.type === "SPAWNER") {
          // Draw Spawner (Bio-hazard Look)
          ctx.fillStyle = "#1a0a0a";
          ctx.strokeStyle = "#ff3333";
          ctx.lineWidth = 2;
          ctx.strokeRect(obs.x, obs.y, obs.w, obs.h);
          ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
          
          // Outer circle
          ctx.strokeStyle = "#ff3333";
          ctx.beginPath();
          ctx.arc(obs.x + obs.w/2, obs.y + obs.h/2, 12, 0, Math.PI * 2);
          ctx.stroke();
          
          // Biohazard-ish core
          ctx.fillStyle = (Date.now() % 1000 < 500) ? "#ff0000" : "#660000";
          ctx.beginPath();
          ctx.arc(obs.x + obs.w/2, obs.y + obs.h/2, 6, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.fillStyle = "#ff3333";
          ctx.font = "bold 8px monospace";
          ctx.textAlign = "center";
          ctx.fillText("SPAWNER", obs.x + obs.w/2, obs.y + obs.h - 5);
        } else {
          ctx.fillStyle = activeBase?.type === "VAULT" ? "#1a2a1a" : "#2e2b23";
          ctx.strokeStyle = activeBase?.type === "VAULT" ? "#1aff1a" : "#c2b280";
          ctx.lineWidth = 2;
          ctx.strokeRect(obs.x, obs.y, obs.w, obs.h);
          ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
        }
      });

      // Draw Enemies
      enemiesRef.current.forEach(e => {
        // Shadow
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.beginPath();
        ctx.ellipse(e.x, e.y + e.radius * 0.8, e.radius, e.radius * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();

        // Body
        const gradient = ctx.createRadialGradient(e.x - e.radius * 0.2, e.y - e.radius * 0.2, 0, e.x, e.y, e.radius);
        gradient.addColorStop(0, "#333");
        gradient.addColorStop(1, "#000");
        ctx.fillStyle = gradient;
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Menacing Details
        // Glowing Eyes
        const eyeColor = e.type === "RUNNER" ? "#ffff00" : (e.type === "BRUTE" ? "#ff0000" : e.color);
        ctx.shadowBlur = 5;
        ctx.shadowColor = eyeColor;
        ctx.fillStyle = eyeColor;
        
        const eyeSize = e.radius * 0.15;
        const eyeOffset = e.radius * 0.35;
        ctx.beginPath();
        ctx.arc(e.x - eyeOffset, e.y - eyeOffset, eyeSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(e.x + eyeOffset, e.y - eyeOffset, eyeSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // "Ripped" features or decay
        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        ctx.beginPath();
        ctx.moveTo(e.x - e.radius * 0.5, e.y);
        ctx.lineTo(e.x + e.radius * 0.5, e.y);
        ctx.stroke();

        // Mouth / Jaws
        ctx.strokeStyle = "#500";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(e.x - e.radius * 0.4, e.y + e.radius * 0.2);
        ctx.quadraticCurveTo(e.x, e.y + e.radius * 0.6, e.x + e.radius * 0.4, e.y + e.radius * 0.2);
        ctx.stroke();
        
        // Brute extra detail
        if (e.type === "BRUTE") {
          ctx.strokeStyle = "#ff0000";
          ctx.beginPath();
          ctx.moveTo(e.x - e.radius * 0.7, e.y - e.radius * 0.7);
          ctx.lineTo(e.x - e.radius * 0.9, e.y - e.radius * 0.9);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(e.x + e.radius * 0.7, e.y - e.radius * 0.7);
          ctx.lineTo(e.x + e.radius * 0.9, e.y - e.radius * 0.9);
          ctx.stroke();
        }

        // Animated aura for runners
        if (e.type === "RUNNER") {
          ctx.strokeStyle = "rgba(255, 255, 0, 0.2)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.radius + Math.sin(Date.now() / 100) * 3, 0, Math.PI * 2);
          ctx.stroke();
        }
      });

      // Draw Boss
      if (boss && activeBase?.id === 1) {
        // Draw main body
        ctx.fillStyle = "#222";
        ctx.strokeStyle = "#ff1a1a";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(boss.x, boss.y, boss.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Draw Weak Spots
        boss.weakSpots.forEach(ws => {
          if (ws.active) {
            const wx = boss.x + ws.relX;
            const wy = boss.y + ws.relY;
            
            // Outer glow pulse
            const pulse = (Math.sin(Date.now() / 200) + 1) / 2;
            ctx.fillStyle = `rgba(255, 255, 255, ${0.1 + pulse * 0.2})`;
            ctx.beginPath();
            ctx.arc(wx, wy, ws.radius * (1.2 + pulse * 0.3), 0, Math.PI * 2);
            ctx.fill();

            // Core
            ctx.fillStyle = (Date.now() % 400 < 200) ? "#fff" : "#ff3333";
            ctx.beginPath();
            ctx.arc(wx, wy, ws.radius, 0, Math.PI * 2);
            ctx.fill();
            
            // Reticle / Warning
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(wx - ws.radius - 5, wy); ctx.lineTo(wx + ws.radius + 5, wy);
            ctx.moveTo(wx, wy - ws.radius - 5); ctx.lineTo(wx, wy + ws.radius + 5);
            ctx.stroke();

            ctx.fillStyle = "#ff0000";
            ctx.font = "bold 9px monospace";
            ctx.textAlign = "center";
            ctx.fillText("WEAK POINT", wx, wy - ws.radius - 12);
          }
        });
      }

      // Draw Bullets
      bulletsRef.current.forEach(b => {
        ctx.fillStyle = b.color || "#fff";
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fill();
      });

      // Draw Enemy Bullets
      enemyBulletsRef.current.forEach(b => {
        ctx.fillStyle = "#ffb84d";
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fill();
      });

      // Draw Particles
      particlesRef.current.forEach(p => {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
      });
    }

    // 10. Draw Other Players (Multiplayer Expansion Prep)
    if (isMultiplayer) {
      Object.entries(otherPlayers).forEach(([id, p]: [string, PlayerState]) => {
        if (id === socketRef.current?.id) return;
        ctx.fillStyle = "#60a5fa"; // Blue for allies
        ctx.beginPath();
        ctx.arc(p.x, p.y, PLAYER_SIZE / 2, 0, Math.PI * 2);
        ctx.fill();
        
        // HP bar for ally
        ctx.fillStyle = "#333";
        ctx.fillRect(p.x - 10, p.y - 15, 20, 2);
        ctx.fillStyle = "#1aff1a";
        ctx.fillRect(p.x - 10, p.y - 15, 20 * (p.hp / 100), 2);
      });
    }

    // 11. Multiplayer State Sync (Throttled)
    if (isMultiplayer && (time % 100 < 16)) {
       socketRef.current?.emit("player_state", {
         x: playerRef.current.x,
         y: playerRef.current.y,
         hp: playerHPRef.current,
         armor: playerArmorRef.current
       });
    }

    requestRef.current = requestAnimationFrame(update);
  }, [gameState, activeBase, boss, otherPlayers]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => keysRef.current[e.code] = true;
    const handleKeyUp = (e: KeyboardEvent) => keysRef.current[e.code] = false;
    const handleMouseMove = (e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        mouseRef.current.x = e.clientX - rect.left;
        mouseRef.current.y = e.clientY - rect.top;
      }
    };
    const handleMouseDown = () => mouseRef.current.down = true;
    const handleMouseUp = () => mouseRef.current.down = false;

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);
    
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleLobbyMapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isHost || !socketRef.current) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const xRatio = 800 / rect.width;
    const yRatio = 600 / rect.height;
    
    const clickX = (e.clientX - rect.left) * xRatio;
    const clickY = (e.clientY - rect.top) * yRatio;
    
    // If placing a flag, remove existing flags first (only one capture point)
    let currentItems = [...multiConfig.mapItems];
    if (builderType === "FLAG") {
       currentItems = currentItems.filter(i => i.type !== "FLAG");
    }

    const newBuilding: Obstacle = {
      id: Date.now() + Math.random(),
      x: clickX - builderWidth / 2,
      y: clickY - builderHeight / 2,
      w: builderType === "FLAG" ? 40 : builderWidth,
      h: builderType === "FLAG" ? 40 : builderHeight,
      type: builderType,
      radius: 0,
      spawnerRate: builderType === "SPAWNER" ? spawnerRate : undefined,
      spawnerType: builderType === "SPAWNER" ? spawnerType : undefined,
      lastSpawnTime: Date.now()
    };
    
    socketRef.current.emit("place_building", newBuilding);
    
    // Persist to Supabase
    saveDefenses([...currentItems, newBuilding], currentLocationId);
  };

  const startCustomMultiplayerMission = () => {
    // Both host and clients call this when mission starts
    const vault = bases.find(b => b.id === 1);
    if (!vault) return;
    
    // Setup capture zone based on flag position if it exists
    const flag = multiConfig.mapItems.find(i => i.type === "FLAG");
    if (flag) {
       const zone = {
          x: flag.x + flag.w / 2,
          y: flag.y + flag.h / 2,
          radius: 120
       };
       setCaptureZone(zone);
       captureZoneRef.current = zone;
    } else {
       // Fallback to center
       const zone = { x: 400, y: 300, radius: 120 };
       setCaptureZone(zone);
       captureZoneRef.current = zone;
    }

    setActiveBase(vault);
    setCurrentLocationId(1); // Custom maps scoped to V99 for now
    
    // Clear old state before starting fresh mission
    enemiesRef.current = [];
    bulletsRef.current = [];
    enemyBulletsRef.current = [];
    particlesRef.current = [];
    
    // Prepare map
    obstaclesRef.current = [...multiConfig.mapItems];
    setObstacles([...multiConfig.mapItems]);
    
    // Spawn enemies around players
    const spawnCount = 15;
    for (let i = 0; i < spawnCount; i++) {
       enemiesRef.current.push({
          id: idCounterRef.current++,
          x: Math.random() * 800,
          y: Math.random() * 600,
          radius: 12,
          hp: 2,
          speed: 1.2,
          color: "#1aff1a",
          type: "ZOMBIE"
       });
    }

    setGameState("PLAYING");
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(update);
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, [update]);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Handled by window listeners for hold-to-shoot
  };

  return (
    <div 
      id="game-container"
      ref={containerRef}
      className="relative crt-effect terminal-flicker flex h-screen w-full flex-col items-center justify-center bg-bg-atomic select-none touch-none overflow-hidden cursor-crosshair font-sans"
    >
      <div className="scanline" />
      <div className="absolute inset-0 bg-[#000d00] opacity-30 pointer-events-none" />

          {/* INTRO STATE (Cinematic Boot) */}
        <AnimatePresence mode="wait">
        {gameState === "LOGIN" && (
           <motion.div 
             initial={{ opacity: 0 }}
             animate={{ opacity: 1 }}
             exit={{ opacity: 0 }}
             className="absolute inset-0 z-[200] flex flex-col items-center justify-center bg-[#000500]"
           >
              <div className="scanline" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,#1aff1a11_0%,transparent_70%)]" />
              
              <div className="max-w-md w-full atomic-panel border-pip-green/40 p-12 space-y-10 bg-black/60 backdrop-blur-md relative overflow-hidden">
                <div className="flex flex-col items-center space-y-4">
                  <div className="p-4 rounded-full border-2 border-pip-green/50 bg-pip-green/10 animate-pulse">
                    <Skull className="h-12 w-12 text-pip-green" />
                  </div>
                  <h1 className="text-4xl font-mono text-pip-green tracking-tighter uppercase terminal-flicker">
                    Atomic Bases
                  </h1>
                  <p className="text-[10px] text-pip-green/60 uppercase tracking-[0.3em] font-bold">
                    Tactical Network Access
                  </p>
                </div>

                <div className="space-y-4">
                   <button 
                    onClick={async () => {
                       try {
                          await loginWithGoogle();
                       } catch (e) {
                          console.error(e);
                       }
                    }}
                    className="w-full flex items-center justify-center space-x-3 atomic-btn py-4 hover:bg-pip-green/20"
                   >
                     <LogIn className="h-5 w-5" />
                     <span>Authorize Neural Link</span>
                   </button>
                   <p className="text-[8px] text-center text-pip-green/30 uppercase leading-relaxed">
                     By connecting your terminal, you agree to FTJM Enterprise protocols and tactical data collection mandates.
                   </p>
                </div>

                <div className="pt-6 border-t border-pip-green/10 flex justify-center">
                  <span className="text-[8px] font-mono text-pip-green/20 uppercase tracking-[0.5em]">Rob-Co Terminal Interface v4.2</span>
                </div>
              </div>
           </motion.div>
        )}

        {gameState === "INTRO" && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-[#010801] font-mono p-10 overflow-hidden"
            >
              <div className="absolute top-10 left-10 text-[10px] space-y-1 opacity-40">
                <p>FTJM-BIOS v2.44</p>
                <p>CPU: ATOMIC-CORE i99</p>
                <p>MEMORY TEST: 65536KB OK</p>
              </div>

              <div className="max-w-xl w-full flex flex-col items-start space-y-4">
                <div className="flex flex-col space-y-2 mb-10 w-full">
                  {[
                    "INITIALIZING NEURAL LINK...",
                    "ESTABLISHING SECURE CONNECTION...",
                    "UPLOADING TACTICAL DATA...",
                    "FTJM ENTERPRISE PROTOCOL LOADED."
                  ].map((text, i) => (
                    <motion.p
                      key={i}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.4 }}
                      className="text-xs text-pip-green/70 flex items-center"
                    >
                      <TerminalIcon className="h-3 w-3 mr-2" />
                      {text}
                    </motion.p>
                  ))}
                </div>

                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ 
                    scale: [0.8, 1.05, 1],
                    opacity: [0, 1, 1]
                  }}
                  transition={{ duration: 1, delay: 2 }}
                  onAnimationComplete={() => {
                    setTimeout(() => setGameState("MENU"), 1500);
                  }}
                  className="w-full flex flex-col items-center space-y-8"
                >
                  <div className="relative group">
                    <motion.div 
                       className="absolute -inset-4 bg-pip-green/20 rounded-full blur-2xl group-hover:bg-pip-green/40 transition-all"
                       animate={{ scale: [1, 1.2, 1] }}
                       transition={{ repeat: Infinity, duration: 4 }}
                    />
                    <div className="w-40 h-40 border-2 border-pip-green rounded-full flex items-center justify-center relative bg-black shadow-[0_0_30px_rgba(26,255,26,0.3)]">
                      <motion.div 
                         className="absolute inset-2 flex items-center justify-center border border-pip-green/20 rounded-full"
                         animate={{ rotate: 360 }}
                         transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                      >
                         <div className="w-full h-px bg-pip-green/40" />
                         <div className="w-px h-full bg-pip-green/40 absolute" />
                      </motion.div>
                      <Cpu className="h-16 w-16 text-pip-green animate-pulse" />
                    </div>
                  </div>

                  <div className="text-center space-y-2">
                    <h2 className="text-4xl font-mono text-pip-green tracking-[0.8em] font-black uppercase terminal-flicker">
                      FTJM
                    </h2>
                    <p className="text-xs tracking-[0.3em] text-pip-green/60 uppercase">
                      Enterprise Solutions
                    </p>
                  </div>
                </motion.div>
              </div>

              <div className="absolute bottom-10 right-10 flex items-center space-x-2 text-[10px] text-pip-green/30">
                <HardDrive className="h-3 w-3" />
                <span>SECURE-BOOT: ENABLED</span>
              </div>
            </motion.div>
          )}

        {/* LOBBY_SELECT STATE (NEW AUTH SCREEN) */}
        {gameState === "LOBBY_SELECT" && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[110] bg-[#000500] flex items-center justify-center p-6 font-mono"
          >
            <div className="max-w-2xl w-full atomic-panel border-blue-500/60 p-10 space-y-8 bg-black/80 shadow-[0_0_50px_rgba(30,58,138,0.3)]">
              <div className="flex flex-col items-center space-y-3">
                <div className="p-4 rounded-full bg-blue-500/10 border border-blue-500/40 animate-pulse">
                  <Network className="h-10 w-10 text-blue-400" />
                </div>
                <h2 className="text-3xl text-blue-400 tracking-[0.2em] font-black uppercase italic">Neural Link C2</h2>
                <p className="text-[10px] text-blue-400/40 uppercase tracking-[0.5em]">Command & Control Network Hub</p>
                <div className="w-full h-px bg-blue-500/20" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <span className="text-[10px] text-blue-400/50 uppercase tracking-widest block font-bold">Standard Operations</span>
                    <button 
                      onClick={handleQuickJoin}
                      className="w-full h-24 atomic-btn border-pip-green text-pip-green group overflow-hidden relative shadow-[0_0_20px_rgba(26,255,26,0.2)]"
                    >
                      <div className="absolute inset-0 bg-pip-green/10 -translate-x-full group-hover:translate-x-0 transition-transform duration-500" />
                      <div className="relative flex flex-col items-center">
                        <Play className="h-6 w-6 mb-1" />
                        <span className="font-black tracking-[0.2em] italic uppercase">Join Public Sector</span>
                      </div>
                    </button>
                  </div>

                  <div className="space-y-4 pt-4 border-t border-blue-500/10">
                    <span className="text-[10px] text-blue-400/50 uppercase tracking-widest block font-bold">Private Channel Auth</span>
                    <div className="flex space-x-2">
                      <input 
                        type="text" 
                        placeholder="CLUSTER_ID"
                        value={inputLobbyCode}
                        onChange={(e) => setInputLobbyCode(e.target.value.toUpperCase())}
                        className="flex-1 bg-blue-500/5 border border-blue-500/30 text-blue-400 text-sm p-3 outline-none focus:border-blue-400 transition-all text-center tracking-[0.3em]"
                      />
                      <button 
                        onClick={() => handleJoinLobby()}
                        disabled={!inputLobbyCode}
                        className="atomic-btn border-blue-500 text-blue-400 px-6 disabled:opacity-30"
                      >
                        LINK
                      </button>
                    </div>
                  </div>

                  <button 
                    onClick={handleCreateLobby}
                    className="w-full atomic-btn border-blue-500 h-16 text-blue-400 group overflow-hidden relative"
                  >
                    <div className="absolute inset-0 bg-blue-500/10 -translate-x-full group-hover:translate-x-0 transition-transform duration-500" />
                    <span className="relative font-black tracking-[0.2em] italic">INITIALIZE NEW CLUSTER</span>
                  </button>
                </div>

                <div className="space-y-4 flex flex-col">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-blue-400/50 uppercase tracking-widest font-bold">Active Signal Detected</span>
                    <div className="flex items-center space-x-1">
                      <div className="h-1.5 w-1.5 rounded-full bg-pip-green animate-pulse" />
                      <span className="text-[8px] text-pip-green font-bold">{availableLobbies.length} NODES</span>
                    </div>
                  </div>

                  <div className="flex-1 bg-blue-500/5 border border-blue-500/20 overflow-y-auto max-h-[300px] p-2 space-y-2 scrollbar-thin scrollbar-thumb-blue-500/20">
                    {availableLobbies.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center p-8 opacity-30">
                        <Radio className="h-8 w-8 mb-2 animate-pulse" />
                        <span className="text-[8px] uppercase text-center">Scanning automated frequencies...</span>
                      </div>
                    ) : (
                      availableLobbies.map((lob) => (
                        <div 
                          key={lob.code}
                          className="p-3 bg-blue-500/10 border border-blue-500/30 flex items-center justify-between hover:bg-blue-500/20 transition-all"
                        >
                          <div className="flex flex-col">
                            <span className="text-xs font-black text-white tracking-widest">{lob.code}</span>
                            <div className="flex items-center space-x-2 text-[8px] text-blue-400/60 font-bold">
                              <span>{lob.playerCount} OPS LINKED</span>
                              <span>//</span>
                              <span className={lob.isMissionActive ? "text-red-500" : "text-pip-green"}>
                                {lob.isMissionActive ? "DEPLOYED" : "STAGING"}
                              </span>
                            </div>
                          </div>
                          <button 
                            onClick={() => handleJoinLobby(lob.code)}
                            className="bg-blue-500/20 hover:bg-blue-400 hover:text-black border border-blue-400/40 text-blue-400 px-3 py-1 text-[8px] font-black uppercase transition-all"
                          >
                            Sync Link
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-blue-500/10 flex flex-col items-center space-y-2">
                <span className="text-[8px] text-blue-500/30 uppercase tracking-[0.2em]">FTJM SECURE TRANSPORT LAYER 4.0</span>
                <button 
                  onClick={() => setGameState("MENU")}
                  className="text-[8px] text-red-500/40 hover:text-red-500 transition-colors uppercase font-bold"
                >
                  Terminate Link // Return to Home
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* LOBBY STATE */}
        {gameState === "LOBBY" && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#000500] p-10 font-mono"
          >
             <div className="scanline" />
             <div className="w-full max-w-2xl atomic-panel border-blue-500/40 p-8 space-y-6 bg-black/80 relative">
                <div className="flex items-center justify-between border-b border-blue-500/20 pb-4">
                   <div className="flex items-center space-x-3">
                      <Network className="h-8 w-8 text-blue-400 relative z-10" />
                      <div className="flex flex-col">
                         <h2 className="text-3xl text-blue-400 uppercase tracking-[0.2em] font-black italic">NetLink C2 Node</h2>
                         <div className="flex items-center space-x-2 text-[8px] text-blue-400/40">
                             <Database className="h-2 w-2" />
                             <span>CLUSTER_ID: <span className="text-blue-400 font-bold">{lobbyCode}</span> // ENCRYPTED_STREAM_ACTIVE</span>
                         </div>
                      </div>
                   </div>
                   <div className="flex flex-col items-end">
                      <div className="text-[10px] text-blue-400/60 uppercase font-bold tracking-tighter">Tactical Comms v1.2</div>
                      {((user?.email === "kaasbroodjeskanaal@gmail.com" || user?.email === "markohoksen@gmail.com")) && (
                        <button 
                           onClick={() => socketRef.current?.emit("clear_map")}
                           className="mt-2 flex items-center space-x-1 px-2 py-1 bg-red-950 border border-red-500/30 text-red-500 text-[8px] hover:bg-red-500 hover:text-white transition-all uppercase font-black cursor-pointer"
                         >
                           <Trash2 className="h-2 w-2" />
                           <span>Terminate Cluster</span>
                        </button>
                      )}
                   </div>
                </div>

                <div className="space-y-4 min-h-[150px] overflow-y-auto pr-4">
                   <p className="text-[10px] text-blue-400/60 uppercase tracking-widest border-l-2 border-blue-400/30 pl-3">Remote Operations Detected:</p>
                   {Object.keys(otherPlayers).filter(id => id !== socketRef.current?.id).length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-24 border border-dashed border-blue-500/10 space-y-3">
                         <div className="h-6 w-6 border-2 border-blue-500/20 border-t-blue-400 rounded-full animate-spin" />
                         <span className="text-[10px] text-blue-500/30 italic uppercase">Searching for encrypted signals...</span>
                      </div>
                   ) : (
                      <div className="grid grid-cols-1 gap-2">
                         {Object.entries(otherPlayers).filter(([id]) => id !== socketRef.current?.id).map(([id, p]: [string, any]) => (
                            <motion.div 
                              initial={{ x: -10, opacity: 0 }}
                              animate={{ x: 0, opacity: 1 }}
                              key={id} 
                              className="flex items-center justify-between p-3 bg-blue-500/5 border border-blue-500/20 hover:bg-blue-500/10 transition-colors"
                            >
                               <div className="flex items-center space-x-3">
                                  {p.photoURL ? (
                                      <img src={p.photoURL} referrerPolicy="no-referrer" className="h-6 w-6 rounded-full border border-blue-500/40" alt="Ally" />
                                   ) : (
                                      <Users className="h-4 w-4 text-blue-400" />
                                   )}
                                  <div className="flex flex-col">
                                     <span className="text-[10px] font-bold text-white uppercase tracking-wider">{p.name || `Operator_${id.slice(0, 6)}`}</span>
                                     <span className="text-[8px] text-blue-400/50">{p.ready ? "READY_TO_DEPLOY" : "PREPARING_ARSENAL"}</span>
                                  </div>
                               </div>
                               <div className="flex items-center space-x-2">
                                  <div className={`h-1.5 w-1.5 rounded-full ${p.ready ? 'bg-pip-green' : 'bg-pip-amber'} animate-pulse`} />
                                  <span className={`text-[8px] font-bold uppercase ${p.ready ? 'text-pip-green' : 'text-pip-amber'}`}>{p.ready ? "READY" : "WAIT"}</span>
                                </div>
                            </motion.div>
                         ))}
                      </div>
                   )}
                </div>

                {/* HOST CONTRELS */}
                {isMultiplayer && isHost && (
                   <div className="bg-blue-500/10 border border-blue-500/30 p-4 space-y-4">
                      <div className="flex items-center space-x-2 text-blue-400">
                         <Shield className="h-4 w-4" />
                         <span className="text-xs font-bold uppercase">Host Tactical Controls</span>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-6">
                         <div className="space-y-4">
                            <div className="space-y-1">
                               <span className="text-[9px] text-blue-400/50 uppercase">Forced Arsenal</span>
                               <select 
                                  value={multiConfig.weaponId}
                                  onChange={(e) => socketRef.current?.emit("update_config", { weaponId: e.target.value })}
                                  className="w-full bg-black border border-blue-500/30 text-blue-400 text-[10px] p-2 outline-none"
                               >
                                  {Object.keys(WEAPONS).map(id => (
                                     <option key={id} value={id}>{WEAPONS[id].name}</option>
                                  ))}
                               </select>
                            </div>

                            <div className="pt-4 border-t border-blue-500/10 space-y-4">
                               <span className="text-[9px] text-blue-400/50 uppercase">Builder Tools</span>
                               <div className="flex space-x-2">
                                  <button 
                                     onClick={() => setBuilderType("WALL")}
                                     className={`flex-1 py-1.5 text-[10px] border transition-all ${builderType === "WALL" ? "border-blue-400 bg-blue-400/20 text-white shadow-[0_0_10px_rgba(96,165,250,0.3)]" : "border-blue-500/30 text-blue-400/50 hover:text-blue-400"}`}
                                  >
                                     WALL
                                  </button>
                                  <button 
                                     onClick={() => setBuilderType("FLAG")}
                                     className={`flex-1 py-1.5 text-[10px] border transition-all ${builderType === "FLAG" ? "border-red-400 bg-red-400/20 text-white shadow-[0_0_10px_rgba(248,113,113,0.3)]" : "border-blue-500/30 text-blue-400/50 hover:text-red-400"}`}
                                  >
                                     FLAG
                                  </button>
                                  <button 
                                     onClick={() => setBuilderType("SPAWNER")}
                                     className={`flex-1 py-1.5 text-[10px] border transition-all ${builderType === "SPAWNER" ? "border-yellow-400 bg-yellow-400/20 text-white shadow-[0_0_10px_rgba(234,179,8,0.3)]" : "border-blue-500/30 text-blue-400/50 hover:text-yellow-400"}`}
                                  >
                                     SPAWNER
                                  </button>
                               </div>

                               {builderType === "SPAWNER" && (
                                  <div className="space-y-3 bg-yellow-400/5 p-3 border border-yellow-400/20">
                                     <div className="space-y-1">
                                        <div className="flex justify-between">
                                           <span className="text-[7px] text-yellow-500/60 uppercase">Spawn Rate</span>
                                           <span className="text-[7px] text-yellow-400 font-mono">{spawnerRate.toFixed(1)} Z/SEC</span>
                                        </div>
                                        <input 
                                           type="range" min="0.1" max="3" step="0.1"
                                           value={spawnerRate}
                                           onChange={(e) => setSpawnerRate(parseFloat(e.target.value))}
                                           className="w-full h-1 bg-yellow-900 rounded-lg appearance-none cursor-pointer accent-yellow-400"
                                        />
                                     </div>
                                     <div className="space-y-1">
                                        <span className="text-[7px] text-yellow-500/60 uppercase">Unit Spec</span>
                                        <select 
                                           value={spawnerType}
                                           onChange={(e) => setSpawnerType(e.target.value as any)}
                                           className="w-full bg-black border border-yellow-500/30 text-yellow-400 text-[10px] p-1.5 outline-none"
                                        >
                                           <option value="ZOMBIE">ZOMBIE (STANDARD)</option>
                                           <option value="RUNNER">RUNNER (AGILE)</option>
                                           <option value="BRUTE">BRUTE (TANK)</option>
                                           <option value="SPITTER">SPITTER (RANGED)</option>
                                        </select>
                                     </div>
                                  </div>
                               )}
                               
                               {builderType === "WALL" && (
                                  <div className="grid grid-cols-2 gap-3">
                                     <div className="space-y-1">
                                        <div className="flex justify-between">
                                           <span className="text-[7px] text-blue-400/30 uppercase">Width</span>
                                           <span className="text-[7px] text-blue-400 font-mono">{builderWidth}px</span>
                                        </div>
                                        <input 
                                           type="range" min="20" max="200" step="10"
                                           value={builderWidth}
                                           onChange={(e) => setBuilderWidth(parseInt(e.target.value))}
                                           className="w-full h-1 bg-blue-900 rounded-lg appearance-none cursor-pointer accent-blue-400"
                                        />
                                     </div>
                                     <div className="space-y-1">
                                        <div className="flex justify-between">
                                           <span className="text-[7px] text-blue-400/30 uppercase">Height</span>
                                           <span className="text-[7px] text-blue-400 font-mono">{builderHeight}px</span>
                                        </div>
                                        <input 
                                           type="range" min="20" max="200" step="10"
                                           value={builderHeight}
                                           onChange={(e) => setBuilderHeight(parseInt(e.target.value))}
                                           className="w-full h-1 bg-blue-900 rounded-lg appearance-none cursor-pointer accent-blue-400"
                                        />
                                     </div>
                                  </div>
                               )}
                            </div>

                            <div className="pt-4 border-t border-blue-500/10">
                               <div className="flex items-center justify-between mb-2">
                                  <span className="text-[9px] text-blue-400/50 uppercase">System Stats</span>
                                  <button 
                                     onClick={() => {
                                        socketRef.current?.emit("clear_map");
                                        clearAllDefenses(currentLocationId);
                                     }}
                                     className="flex items-center space-x-1 text-[8px] text-red-500/50 hover:text-red-500 uppercase font-bold"
                                  >
                                     <Trash2 className="h-2 w-2" />
                                     <span>Purge Map Data</span>
                                  </button>
                               </div>
                               <div className="text-[8px] text-blue-400/30 space-y-1">
                                  <p>TOTAL_OBSTACLES: {multiConfig.mapItems.length}</p>
                                  <p>PERSISTENCE: SUPABASE_ENABLED</p>
                               </div>
                            </div>
                         </div>

                         <div className="space-y-2">
                            <span className="text-[9px] text-blue-400/50 uppercase flex items-center">
                               <MousePointer2 className="h-3 w-3 mr-1" />
                               Map Construction Grid
                            </span>
                            <div 
                               onClick={handleLobbyMapClick}
                               className="aspect-video w-full bg-black border border-blue-500/30 relative overflow-hidden cursor-crosshair group"
                            >
                               {/* Grid lines */}
                               <div className="absolute inset-0 grid grid-cols-8 grid-rows-6 opacity-10 pointer-events-none">
                                  {[...Array(48)].map((_, i) => <div key={i} className="border-[0.5px] border-blue-400" />)}
                               </div>
                               
                               {/* Placed Items */}
                               {multiConfig.mapItems.map((item) => (
                                  <div 
                                     key={item.id}
                                     className={`absolute border ${item.type === "FLAG" ? "bg-red-500/40 border-red-400 flex items-center justify-center" : "bg-blue-500/40 border-blue-400"}`}
                                     style={{
                                        left: `${(item.x / 800) * 100}%`,
                                        top: `${(item.y / 600) * 100}%`,
                                        width: `${(item.w / 800) * 100}%`,
                                        height: `${(item.h / 600) * 100}%`,
                                     }}
                                  >
                                    {item.type === "FLAG" && <Shield className="h-4 w-4 text-white animate-pulse" />}
                                  </div>
                               ))}
                               
                               <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                  <span className="text-[8px] text-blue-400/50 uppercase font-bold tracking-widest bg-black/80 px-2 py-1">Click to Place {builderType}</span>
                               </div>
                            </div>
                         </div>
                      </div>
                   </div>
                )}

                <div className="flex flex-col space-y-3 pt-6 border-t border-blue-500/20">
                   <button 
                      onClick={() => socketRef.current?.emit("toggle_ready")}
                      className={`atomic-btn py-3 text-[10px] font-bold tracking-[0.2em] transition-all ${otherPlayers[socketRef.current?.id || ""]?.ready ? 'bg-pip-green text-black border-pip-green shadow-[0_0_15px_#1aff1a]' : 'border-blue-500 text-blue-400'}`}
                   >
                      {otherPlayers[socketRef.current?.id || ""]?.ready ? "STATUS: READY FOR DEPLOYMENT" : "SIGNAL: PREPARE FOR DEPLOYMENT"}
                   </button>

                   <button 
                      onClick={() => socketRef.current?.emit("start_mission")}
                      disabled={!isHost}
                      className={`atomic-btn py-4 text-sm font-bold tracking-[0.2em] relative overflow-hidden group ${isHost ? 'border-blue-500 text-blue-400' : 'border-gray-800 text-gray-800 cursor-not-allowed'}`}
                   >
                      <div className="absolute inset-0 bg-blue-500/10 -translate-x-full group-hover:translate-x-0 transition-transform duration-500" />
                      <span className="relative">
                        {isHost 
                          ? `AUTHORIZE DEPLOYMENT (${Object.values(otherPlayers).filter((p: any) => p.ready).length}/${Object.keys(otherPlayers).length} READY)`
                          : 'AWAITING HOST COMMAND'}
                      </span>
                   </button>
                   <button 
                      onClick={() => {
                         setIsMultiplayer(false);
                         setGameState("MENU");
                      }}
                      className="text-red-500/40 hover:text-red-500 text-[10px] uppercase tracking-[0.3em] font-bold text-center transition-colors py-2"
                   >
                      Terminate Link // Return to Home
                   </button>
                </div>
             </div>
             
             <div className="absolute bottom-10 left-10 text-[8px] text-blue-500/20 max-w-xs space-y-1">
                <p>&gt; FTJM COMMUNICATION PROTOCOL ENABLED</p>
                <p>&gt; ENCRYPTION: AES-256-ATOMIC</p>
                <p>&gt; WARNING: CO-OP ENGAGEMENT MAY INCREASE THREAT LEVELS</p>
             </div>
          </motion.div>
        )}

        {/* MENU STATE */}
        {gameState === "MENU" && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-bg-atomic space-y-12"
          >
            <div className="flex flex-col items-center space-y-4">
              {user && (
                <div className="flex items-center space-x-3 mb-4 bg-pip-green/5 border border-pip-green/20 px-4 py-2 rounded">
                  <div className="h-8 w-8 rounded-full border border-pip-green/40 overflow-hidden">
                    <img src={user.photoURL || "/placeholder.png"} referrerPolicy="no-referrer" alt="User" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-pip-green font-bold uppercase tracking-wider">{user.displayName || "Unknown Operator"}</span>
                    <button 
                      onClick={() => logout()} 
                      className="text-[8px] text-red-500/60 hover:text-red-500 uppercase font-bold text-left flex items-center"
                    >
                      <LogOut className="h-2 w-2 mr-1" />
                      Terminate Session
                    </button>
                  </div>
                </div>
              )}
              <div className="flex items-center space-x-6">
                <Radio className="h-16 w-16 text-pip-green animate-pulse" />
                <h1 className="text-8xl font-mono text-pip-green tracking-tighter uppercase terminal-flicker">
                  Atomic<br />Bases
                </h1>
              </div>
              <div className="w-full h-1 bg-pip-green opacity-30 shadow-[0_0_10px_#1aff1a]" />
            </div>

            <div className="flex flex-col space-y-6 w-full max-w-sm">
              <button 
                onClick={() => setGameState("MAP")}
                className="atomic-btn flex items-center justify-between"
              >
                <span>Initialize Map</span>
                <ChevronRight className="h-5 w-5" />
              </button>
              <button 
                onClick={() => setGameState("UPGRADES")}
                className="atomic-btn flex items-center justify-between"
              >
                <span>Base Upgrades</span>
                <Zap className="h-5 w-5" />
              </button>
              <button 
                onClick={() => {
                  setGameState("MULTIPLAYER_WARNING");
                }}
                className="atomic-btn flex items-center justify-between border-blue-500/50 text-blue-400 group"
              >
                <div className="flex items-center">
                  <Network className="h-4 w-4 mr-3 group-hover:animate-pulse" />
                  <span>Establish Network Link</span>
                </div>
                <div className="text-[8px] bg-blue-500/20 px-2 py-0.5 rounded border border-blue-500/30">ONLINE</div>
              </button>
              <button className="atomic-btn opacity-50 cursor-not-allowed">
                <span>System Config</span>
              </button>
            </div>

            <div className="absolute bottom-8 font-mono text-[10px] text-pip-green/40 uppercase tracking-[0.4em]">
              Rob-Co Unified Terminal OS v4.2.1
            </div>
          </motion.div>
        )}

        {/* MAP STATE */}
        {gameState === "MAP" && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 bg-desert-dark flex flex-col p-12"
          >
            <div className="flex justify-between items-center mb-8 border-b-2 border-desert pb-6">
              <div className="flex items-center space-x-4">
                <MapIcon className="h-8 w-8 text-desert" />
                <h2 className="text-4xl font-mono uppercase tracking-widest text-desert terminal-flicker">Mojave Tactical Recon</h2>
              </div>
              
              {siegeActive && (
                <motion.div 
                  animate={{ opacity: [1, 0.5, 1] }} 
                  transition={{ repeat: Infinity, duration: 1 }}
                  className="bg-red-950 border-2 border-red-600 px-6 py-2 flex items-center space-x-3 shadow-[0_0_20px_rgba(255,0,0,0.5)]"
                >
                  <AlertTriangle className="h-6 w-6 text-red-500" />
                  <span className="text-red-500 font-mono font-bold animate-pulse">CRITICAL: VAULT 99 UNDER SIEGE</span>
                </motion.div>
              )}

              <div className="flex items-center space-x-4">
                <div className="atomic-panel border-desert px-6 py-2 flex items-center space-x-3">
                    <span className="font-mono text-desert text-sm uppercase">Scrap:</span>
                    <span className="text-xl font-bold text-pip-green">{scrap}</span>
                </div>
                <button onClick={() => setGameState("UPGRADES")} className="atomic-btn border-desert text-pip-amber hover:bg-pip-amber/10 py-2 px-6 text-sm">Shop</button>
                <button onClick={() => setGameState("MENU")} className="atomic-btn border-desert text-desert hover:bg-desert/20 py-2 px-6 text-sm">Return</button>
                <button 
                  onClick={() => setSiegeActive(true)} 
                  className="atomic-btn border-red-900 text-red-700 hover:bg-red-900/10 py-1 px-4 text-[10px] uppercase font-bold"
                >
                  Debug: Force Attack
                </button>
              </div>
            </div>

            <div className="relative flex-1 atomic-panel overflow-auto rounded-xl bg-[#2e2b23] border-desert shadow-[inset_0_0_100px_rgba(0,0,0,0.8)] scrollbar-thin scrollbar-thumb-desert/40">
              <div className="absolute min-w-[200vw] min-h-[200vh] top-0 left-0">
                {/* Terrain Layer */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-80">
                  <defs>
                    <pattern id="topo" width="300" height="300" patternUnits="userSpaceOnUse">
                      <path d="M0 75 Q 75 60 150 75 T 300 75 M0 150 Q 75 165 150 150 T 300 150 M0 225 Q 75 210 150 225 T 300 225" fill="none" stroke="#d4c59c" strokeWidth="1" opacity="0.4" />
                      <circle cx="150" cy="150" r="60" fill="none" stroke="#d4c59c" strokeWidth="1" opacity="0.3" />
                      <circle cx="150" cy="150" r="90" fill="none" stroke="#d4c59c" strokeWidth="1" opacity="0.2" />
                    </pattern>
                    <filter id="noise">
                      <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" stitchTiles="stitch" />
                    </filter>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#topo)" />
                  
                  {/* Mountainous Features */}
                  {[...Array(20)].map((_, i) => (
                    <path 
                      key={`mtn-${i}`}
                      d={`M ${Math.random() * 4000} ${Math.random() * 4000} l 150 -200 l 150 200 Z`}
                      fill="#1a1814"
                      stroke="#c2b280"
                      strokeWidth="2"
                      opacity="0.25"
                    />
                  ))}
                  
                  {/* Canyons/Faults */}
                  {[...Array(15)].map((_, i) => (
                    <path 
                      key={`canyon-${i}`}
                      d={`M ${Math.random() * 4000} ${Math.random() * 4000} q 300 100 600 0 t 600 0`}
                      fill="none"
                      stroke="#1a1814"
                      strokeWidth="15"
                      opacity="0.35"
                    />
                  ))}

                  {/* Craters */}
                  {[...Array(12)].map((_, i) => (
                    <circle 
                      key={`crater-${i}`}
                      cx={Math.random() * 4000}
                      cy={Math.random() * 4000}
                      r={Math.random() * 80 + 40}
                      fill="none"
                      stroke="#1a1814"
                      strokeWidth="3"
                      strokeDasharray="8,8"
                      opacity="0.5"
                    />
                  ))}
                  
                  {/* Dried Rivers */}
                  {[...Array(8)].map((_, i) => (
                    <path 
                      key={`river-${i}`}
                      d={`M ${Math.random() * 4000} 0 L ${Math.random() * 4000} 4000`}
                      fill="none"
                      stroke="#3d372e"
                      strokeWidth="50"
                      strokeLinecap="round"
                      opacity="0.3"
                      style={{ filter: 'blur(15px)' }}
                    />
                  ))}
                </svg>

                <div className="absolute inset-0 bg-black/10 pointer-events-none mix-blend-overlay" style={{ filter: 'url(#noise)' }} />

                {bases.map(base => (
                  <motion.div
                    key={base.id}
                    className="absolute"
                    style={{ left: `${base.x}%`, top: `${base.y}%` }}
                  >
                    <motion.button
                      whileHover={{ scale: 1.1, zIndex: 10 }}
                      disabled={(siegeActive && base.id !== 1) || isTraveling}
                      onClick={() => {
                        if (base.id === 1) {
                          if (siegeActive) {
                            startDefense();
                          } else if (base.id !== currentLocationId) {
                            fastTravel(base);
                          }
                        } else if (!base.captured) {
                          startInfiltration(base);
                        } else if (base.id !== currentLocationId) {
                          fastTravel(base);
                        }
                      }}
                      className={`relative p-3 rounded border-2 flex flex-col items-center space-y-1 transition-all ${
                        siegeActive && base.id !== 1 ? "opacity-20 cursor-not-allowed grayscale" : ""
                      } ${
                        base.captured 
                          ? (base.id === 1 ? "border-pip-green bg-pip-green/20 text-pip-green shadow-[0_0_25px_#1aff1a]" : "border-desert bg-desert/30 text-desert shadow-[0_0_15px_#c2b280]")
                          : "border-pip-amber bg-pip-amber/10 text-pip-amber shadow-[0_0_15px_#ffb84d]"
                      } ${currentLocationId === base.id ? "ring-4 ring-white ring-offset-4 ring-offset-black" : ""}`}
                    >
                      <div className="bg-black/50 p-2 rounded">
                        {base.id === 1 ? <Shield className="h-8 w-8 animate-pulse" /> : (
                            <>
                                {base.type === "VAULT" && <Shield className="h-6 w-6" />}
                                {base.type === "OUTPOST" && <Warehouse className="h-6 w-6" />}
                                {base.type === "TOWER" && <TowerControl className="h-6 w-6" />}
                                {base.type === "RUINS" && <Skull className="h-6 w-6" />}
                            </>
                        )}
                      </div>
                      
                      <span className="font-mono text-[10px] font-bold uppercase tracking-widest whitespace-nowrap bg-black/60 px-1">{base.name}</span>
                      
                      {base.captured && (
                        <div 
                          onClick={(e) => {
                            e.stopPropagation();
                            setManagedBase(base);
                            setGameState("MANAGE");
                          }}
                          className="mt-1 flex items-center space-x-1 text-[7px] bg-pip-green text-black px-2 py-0.5 uppercase font-bold hover:bg-white cursor-pointer"
                        >
                          <Settings className="h-3 w-3" />
                          <span>MANAGE</span>
                        </div>
                      )}

                      {base.captured && base.id !== 1 && base.id !== currentLocationId && (
                        <div className="flex items-center space-x-1 text-[8px] text-pip-green mt-1 bg-black/80 px-1">
                          <FastForward className="h-3 w-3" />
                          <span>FAST TRAVEL</span>
                        </div>
                      )}

                      {currentLocationId === base.id && (
                        <div className="absolute -top-8 animate-bounce">
                           <MapPin className="h-6 w-6 text-white fill-pip-green" />
                        </div>
                      )}

                      {!base.captured && <span className="text-[8px] bg-black/80 px-1">DANGER: LVL {base.difficulty}</span>}
                      {base.id === 1 && (
                        <span className={`text-[8px] uppercase ${siegeActive ? "text-red-500 animate-pulse font-bold" : "text-pip-green/60"}`}>
                          {siegeActive ? "!!! ATTACK IN PROGRESS !!!" : "SYSTEMS NOMINAL - SECURED"}
                        </span>
                      )}
                      {base.id === 1 && !siegeActive && (
                        <div className="text-[7px] text-pip-green/40 font-mono mt-1">
                          ENTRY SEALED UNTIL SECTOR THREAT DETECTED
                        </div>
                      )}
                    </motion.button>
                  </motion.div>
                ))}

                {/* Grid is enough for ambient detail */}
              </div>

              <AnimatePresence>
                {isTraveling && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-[100] bg-black flex flex-col items-center justify-center space-y-4"
                  >
                    <Navigation className="h-12 w-12 text-pip-green animate-spin" />
                    <span className="font-mono text-pip-green tracking-[0.5em] animate-pulse">RECALIBRATING SIGNAL...</span>
                    <div className="w-64 h-1 bg-pip-green/20 rounded-full overflow-hidden">
                       <motion.div 
                        initial={{ x: "-100%" }}
                        animate={{ x: "0%" }}
                        transition={{ duration: 1 }}
                        className="w-full h-full bg-pip-green"
                       />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {siegeActive && (
              <motion.div 
                initial={{ y: 50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="absolute bottom-16 left-1/2 -translate-x-1/2 z-50 bg-red-950 border-2 border-red-500 p-6 flex items-center space-x-6 shadow-[0_0_30px_rgba(185,28,28,0.5)]"
              >
                <AlertCircle className="h-10 w-10 text-red-500 animate-pulse" />
                <div className="flex flex-col">
                   <h4 className="text-red-500 font-bold uppercase tracking-[0.2em]">Siege Warning!</h4>
                   <p className="text-red-400 text-xs font-mono">Vault 99 is under attack. All satellite units grounded until area is secure.</p>
                </div>
                <button 
                  onClick={() => startDefense()}
                  className="bg-red-500 text-white font-bold px-6 py-2 uppercase hover:bg-red-600 transition-colors"
                >
                  Intercept Now
                </button>
              </motion.div>
            )}
          </motion.div>
        )}

        {/* UPGRADES STATE */}
        {gameState === "UPGRADES" && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-bg-atomic flex flex-col p-12 overflow-y-auto"
          >
            <div className="flex justify-between items-center mb-12 border-b-2 border-pip-green pb-6">
              <div className="flex items-center space-x-4">
                <Zap className="h-10 w-10 text-pip-green" />
                <h2 className="text-5xl font-mono uppercase tracking-widest text-pip-green terminal-flicker">Rob-Co Upgrade Bench</h2>
              </div>
              <div className="flex items-center space-x-8">
                 <div className="flex flex-col items-end">
                    <span className="text-[10px] text-pip-green/60 uppercase">Available Scrap</span>
                    <span className="text-4xl font-bold">{scrap}</span>
                 </div>
                 <button onClick={() => setGameState("MAP")} className="atomic-btn">Exit Bench</button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
              <div className="space-y-8">
                <h3 className="text-3xl font-mono text-pip-green/60 uppercase border-b border-pip-green/20 pb-2">Technical Upgrades</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                   {Object.entries(upgrades).map(([key, lvl]) => {
                      const level = lvl as number;
                      const cost = UPGRADE_COSTS[key as keyof typeof UPGRADE_COSTS](level);
                      const canAfford = scrap >= cost;
                      
                      return (
                        <div key={key} className="atomic-panel p-6 flex flex-col space-y-4 hover:bg-pip-green/5 transition-colors">
                            <div className="flex justify-between items-center">
                                <h3 className="text-xl font-bold uppercase text-pip-green">{key}</h3>
                                <span className="text-pip-green bg-pip-green/20 px-2 py-1 text-[10px]">MK {level}</span>
                            </div>
                            <p className="text-[10px] text-pip-green/70 font-mono">
                               {key === 'damage' && 'Increase kinetic impact of projectiles.'}
                               {key === 'fireRate' && 'Overclock the cyclic reloading mechanism.'}
                               {key === 'speed' && 'Calibrate leg servos for faster movement.'}
                               {key === 'health' && 'Reinforce vital organs with genetic enhancements.'}
                               {key === 'baseDefense' && 'Fortify Vault 99 outer shielding systems.'}
                               {key === 'armor' && 'Equip advanced power-armor plating for extra protection.'}
                            </p>
                            <div className="flex flex-col space-y-2 pt-2">
                                <div className="flex justify-between text-[8px] uppercase text-pip-green/40">
                                    <span>Upgrade Cost</span>
                                    <span>{cost} Scrap</span>
                                </div>
                                <button 
                                    onClick={() => buyUpgrade(key)}
                                    disabled={!canAfford}
                                    className={`w-full py-2 text-center border-2 uppercase text-xs font-bold tracking-widest transition-all ${
                                        canAfford 
                                        ? "border-pip-green bg-pip-green/10 text-pip-green hover:bg-pip-green/20 cursor-pointer" 
                                        : "border-gray-800 text-gray-800 cursor-not-allowed"
                                    }`}
                                >
                                    {canAfford ? 'Install Update' : 'Insufficient Resources'}
                                </button>
                            </div>
                        </div>
                      );
                   })}
                </div>
              </div>

              <div className="space-y-8">
                <h3 className="text-3xl font-mono text-pip-green/60 uppercase border-b border-pip-green/20 pb-2">Armory</h3>
                <div className="grid grid-cols-1 gap-6">
                   {Object.values(WEAPONS).map((w) => {
                      const isOwned = ownedWeapons.includes(w.id);
                      const isSelected = currentWeaponId === w.id;
                      const canAfford = scrap >= w.cost;
                      
                      return (
                        <div key={w.id} className={`atomic-panel p-6 flex flex-col space-y-4 transition-all ${isSelected ? 'border-pip-green ring-2 ring-pip-green ring-inset' : 'border-pip-green/20'}`}>
                            <div className="flex justify-between items-start">
                                <div>
                                    <h3 className="text-2xl font-bold uppercase text-pip-green">{w.name}</h3>
                                    <p className="text-xs text-pip-green/70 font-mono mt-1">{w.description}</p>
                                </div>
                                {isOwned ? (
                                    <span className="text-[10px] bg-pip-green text-black px-2 py-1 font-bold uppercase">Owned</span>
                                ) : (
                                    <span className="text-xl font-bold text-pip-amber">{w.cost} <span className="text-[10px] uppercase">Scrap</span></span>
                                )}
                            </div>

                            <div className="flex items-center space-x-6 py-2 border-y border-pip-green/10">
                                <div className="flex flex-col">
                                    <span className="text-[8px] text-pip-green/40 uppercase">Damage</span>
                                    <span className="text-pip-green font-mono">x{w.damageMult}</span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-[8px] text-pip-green/40 uppercase">Rate</span>
                                    <span className="text-pip-green font-mono">x{w.fireRateMult}</span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-[8px] text-pip-green/40 uppercase">Burst</span>
                                    <span className="text-pip-green font-mono">{w.projectiles}</span>
                                </div>
                            </div>

                            <button 
                                onClick={() => isOwned ? selectWeapon(w.id) : buyWeapon(w.id)}
                                disabled={!isOwned && !canAfford}
                                className={`w-full py-4 text-center border-2 uppercase font-bold tracking-[0.2em] transition-all ${
                                    isSelected 
                                    ? "bg-pip-green text-black border-pip-green cursor-default" 
                                    : isOwned
                                        ? "border-pip-green text-pip-green hover:bg-pip-green/10"
                                        : canAfford
                                            ? "border-pip-amber text-pip-amber hover:bg-pip-amber/10"
                                            : "border-gray-800 text-gray-800 cursor-not-allowed"
                                }`}
                            >
                                {isSelected ? 'Equipped' : isOwned ? 'Select Weapon' : canAfford ? 'Purchase Weapon' : 'Insufficient Resources'}
                            </button>
                        </div>
                      );
                   })}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* MANAGE BASE STATE */}
        {gameState === "MANAGE" && managedBase && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-bg-atomic flex flex-col p-8 overflow-y-auto"
          >
            <div className="flex justify-between items-center mb-8 border-b-2 border-pip-green pb-4">
              <div className="flex items-center space-x-4">
                <Settings className="h-8 w-8 text-pip-green" />
                <div>
                  <h2 className="text-3xl font-mono uppercase tracking-widest text-pip-green">{managedBase.name} - System Admin</h2>
                  <p className="text-[10px] text-pip-green font-mono uppercase opacity-60">Facility Maintenance & Resource Extraction</p>
                </div>
              </div>
              <div className="flex items-center space-x-6">
                 <div className="flex flex-col items-end">
                    <span className="text-[8px] text-pip-green/60 uppercase">Available Scrap</span>
                    <span className="text-2xl font-bold text-pip-green">{scrap}</span>
                 </div>
                 <button onClick={() => setGameState("MAP")} className="atomic-btn text-sm py-2 px-6">Exit Terminal</button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1">
               {/* Left Side: Base Status & Repairs */}
               <div className="space-y-6">
                  <div className="atomic-panel p-6 space-y-4">
                     <h3 className="text-lg font-bold uppercase text-pip-green border-b border-pip-green/20 pb-2 flex items-center">
                       <Shield className="h-4 w-4 mr-2" /> Structural Integrity
                     </h3>
                     <div className="flex flex-col space-y-2">
                        <div className="flex justify-between text-xs font-mono">
                           <span className="text-pip-green/60">Condition</span>
                           <span className={managedBase.health < 50 ? "text-red-500" : "text-pip-green"}>{managedBase.health}%</span>
                        </div>
                        <div className="w-full h-4 bg-black/40 border border-pip-green/30 relative">
                           <motion.div 
                             initial={{ width: 0 }}
                             animate={{ width: `${managedBase.health}%` }}
                             className={`h-full ${managedBase.health < 30 ? 'bg-red-600' : 'bg-pip-green'}`} 
                           />
                        </div>
                     </div>
                     {managedBase.health < 100 && (
                        <div className="flex flex-col space-y-2 mt-4">
                           <div className="flex justify-between text-[10px] uppercase font-mono">
                              <span className="text-pip-green/40">Repair Cost</span>
                              <span className="text-pip-amber">{Math.floor((100 - managedBase.health) * 10)} Scrap</span>
                           </div>
                           <button 
                             onClick={() => repairBase()}
                             disabled={scrap < Math.floor((100 - managedBase.health) * 10)}
                             className="atomic-btn text-xs py-2 w-full flex items-center justify-center space-x-2"
                           >
                             <Wrench className="h-4 w-4" />
                             <span>Authorize Full Repair</span>
                           </button>
                        </div>
                     )}
                  </div>

                  <div className="atomic-panel p-6 space-y-4">
                     <h3 className="text-lg font-bold uppercase text-pip-green border-b border-pip-green/20 pb-2 flex items-center">
                       <Database className="h-4 w-4 mr-2" /> Resource Yield
                     </h3>
                     <div className="grid grid-cols-2 gap-4">
                        <div className="bg-black/40 p-3 flex flex-col">
                           <span className="text-[8px] text-pip-green/40 uppercase">Extraction Units</span>
                           <span className="text-xl font-bold text-pip-green">{managedBase.machines.length} / 9</span>
                        </div>
                        <div className="bg-black/40 p-3 flex flex-col">
                           <span className="text-[8px] text-pip-green/40 uppercase">Passive Yield</span>
                           <span className="text-xl font-bold text-pip-amber">+{managedBase.machines.length * 5} <span className="text-[10px]">Scrap / Tick</span></span>
                        </div>
                     </div>
                     <p className="text-[10px] text-pip-green/60 font-mono italic">
                       * Yield proceeds are automatically credited to your terminal every 10 seconds.
                     </p>
                  </div>
               </div>

               {/* Right Side: Machine Placement Grid */}
               <div className="flex flex-col space-y-4">
                  <h3 className="text-xl font-bold uppercase text-pip-green flex items-center">
                    <Cpu className="h-5 w-5 mr-2" /> Custom Machine Assembly
                  </h3>
                  <div className="grid grid-cols-3 gap-4 aspect-square max-w-md bg-black/40 p-6 border-2 border-pip-green/10">
                     {[...Array(9)].map((_, idx) => {
                        const hasMachine = managedBase.machines.includes(idx);
                        return (
                          <motion.button
                            key={idx}
                            whileHover={!hasMachine && scrap >= 1000 ? { scale: 1.05 } : {}}
                            onClick={() => !hasMachine && placeMachine(idx)}
                            className={`relative flex items-center justify-center border-2 transition-all ${
                              hasMachine 
                              ? "border-pip-green bg-pip-green/20 text-pip-green" 
                              : (scrap >= 1000 ? "border-pip-green/30 hover:border-pip-green cursor-pointer" : "border-gray-800 cursor-not-allowed")
                            }`}
                          >
                             {hasMachine ? (
                               <div className="flex flex-col items-center">
                                  <Factory className="h-8 w-8 mb-1" />
                                  <span className="text-[8px] font-bold">MK-I</span>
                               </div>
                             ) : (
                               <div className="flex flex-col items-center opacity-20">
                                  <Hammer className="h-6 w-6 mb-1" />
                                  <span className="text-[8px] font-mono">1000 SCRAP</span>
                               </div>
                             )}
                             
                             {/* Subtle scanline on active machines */}
                             {hasMachine && (
                               <div className="absolute inset-0 overflow-hidden opacity-20">
                                  <div className="w-full h-1 bg-pip-green animate-[scan_2s_linear_infinite]" />
                               </div>
                             )}
                          </motion.button>
                        );
                     })}
                  </div>
                  <style>
                    {`
                      @keyframes scan {
                        0% { transform: translateY(-100%); }
                        100% { transform: translateY(400%); }
                      }
                    `}
                  </style>
                  <p className="text-[10px] text-pip-green/40 font-mono">
                    Select an empty bay to authorize construction of a high-yield scrap extractor.
                  </p>
               </div>
            </div>
          </motion.div>
        )}

        {/* MULTIPLAYER WARNING STATE */}
        {gameState === "MULTIPLAYER_WARNING" && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[100] bg-black bg-opacity-90 flex items-center justify-center p-6"
          >
            <div className="max-w-lg w-full atomic-panel border-red-500 p-8 space-y-6 bg-black">
              <div className="flex items-center space-x-3 text-red-500 border-b border-red-500/30 pb-4">
                <AlertCircle className="h-8 w-8 animate-pulse" />
                <h3 className="text-2xl font-mono uppercase tracking-tighter">Transmission Warning</h3>
              </div>
              
              <div className="space-y-4 font-mono text-xs leading-relaxed text-red-400/80">
                <p className="text-red-500 font-bold uppercase">Critical Security Alert:</p>
                <p>
                  You are attempting to establish an unencrypted network link to the Mojave Tactical Network. 
                </p>
                <ul className="list-disc pl-5 space-y-2">
                  <li>This feature is in <span className="text-red-500 underline font-bold">BETA</span> and may contain system-destabilizing bugs.</li>
                  <li>Multiplayer sessions are unmoderated and may contain <span className="text-red-500 underline font-bold">harmful or inappropriate content</span> generated by other survivors.</li>
                  <li>Your digital signature will be visible to others on the same frequency.</li>
                </ul>
                <p className="pt-2 italic">
                  By proceeding, you acknowledge the risks of the wasteland network.
                </p>
              </div>

              <div className="flex flex-col space-y-3 pt-4">
                <button 
                  onClick={() => {
                    setGameState("LOBBY_SELECT");
                  }}
                  className="atomic-btn border-red-500 text-red-500 hover:bg-red-500/10 py-3 font-bold"
                >
                  I ACCEPT THE RISKS // CONNECT
                </button>
                <button 
                  onClick={() => setGameState("MENU")}
                  className="atomic-btn border-gray-600 text-gray-500 hover:bg-gray-800/50 py-2 text-[10px]"
                >
                  ABORT LINK // RETURN TO SAFETY
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* STORY / CUTSCENE STATE */}
        {gameState === "STORY" && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[100] bg-black flex flex-col items-center justify-center p-12 overflow-hidden"
          >
             <motion.div 
              animate={{ backgroundColor: ["rgba(0,0,0,1)", "rgba(50,0,0,1)", "rgba(0,0,0,1)"] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
              className="absolute inset-0 opacity-20 pointer-events-none"
            />
            
            <div className="max-w-2xl w-full atomic-panel border-pip-amber p-12 space-y-8 relative">
              <div className="flex items-center space-x-4 border-b border-pip-amber pb-4 mb-8">
                <AlertTriangle className="h-10 w-10 text-pip-amber animate-bounce" />
                <h3 className="text-3xl font-mono text-pip-amber uppercase tracking-widest">Vault 99: Last Log</h3>
              </div>
              
              <div className="font-mono text-xl text-pip-amber/80 leading-relaxed space-y-6">
                <motion.p
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 }}
                >
                  &gt; RECOVERY START... DATA CORRUPTED.
                </motion.p>
                <motion.p
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 2.5 }}
                >
                  &gt; I was there. Vault 99 was the last sanctuary. Until the Alarms started...
                </motion.p>
                <motion.p
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 5.5 }}
                >
                  &gt; They came from the vents. Not the waste. Raiders? No... something mutated. Something fast.
                </motion.p>
                <motion.div
                   initial={{ opacity: 0 }}
                   animate={{ opacity: [0, 1, 0, 1] }}
                   transition={{ delay: 8, duration: 2 }}
                   className="bg-red-900/40 p-4 border border-red-500 text-red-500 text-sm italic"
                >
                    [ AUDIO RECORDING: ALARMS BLARING // SCREAMS // RADIATED WIND ]
                </motion.div>
                <motion.p
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 10.5 }}
                >
                  &gt; I took the Pip-boy and the prototype thermal railgun. If you're reading this... capture the surrounding bases. We need a new home.
                </motion.p>
              </div>

              <motion.button 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 14 }}
                onClick={() => setGameState("MAP")}
                className="atomic-btn border-pip-amber text-pip-amber w-full mt-12 py-4 hover:bg-pip-amber/10"
              >
                End Recording // Return to Map
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* PLAYING / DEFENSE STATE */}
        {(gameState === "PLAYING" || gameState === "DEFENSE") && (activeBase && (
          <div className="absolute inset-0">
             {/* ... background decoration ... */}
            {/* Background Decoration Based on Location Type */}
            <div className={`absolute inset-0 pointer-events-none overflow-hidden ${
              activeBase.type === "VAULT" ? "bg-slate-950" :
              activeBase.type === "OUTPOST" ? "bg-[#1a140a]" :
              activeBase.type === "TOWER" ? "bg-[#0a0a1a]" :
              "bg-[#1a0a0a]"
            }`}>
              {/* Grid Lines */}
              <div className="h-full w-full opacity-10" style={{ 
                backgroundImage: `linear-gradient(to right, ${activeBase.type === "VAULT" ? "#1aff1a" : "#c2b280"} 1px, transparent 1px), linear-gradient(to bottom, ${activeBase.type === "VAULT" ? "#1aff1a" : "#c2b280"} 1px, transparent 1px)`,
                backgroundSize: '100px 100px',
              }} />

              {/* Specific Decorations */}
              {activeBase.type === "VAULT" && (
                <>
                  <div className="absolute inset-0 bg-[#0a0c10]" />
                  <div className="absolute top-0 left-0 w-full h-full opacity-10" style={{ 
                    backgroundImage: 'radial-gradient(#1aff1a 1px, transparent 1px)',
                    backgroundSize: '40px 40px'
                  }} />
                  {activeBase.name.includes("99") && (
                    <div className="absolute top-10 left-10 border-l-4 border-pip-green/20 pl-4">
                      <h4 className="text-pip-green/40 font-mono text-xl uppercase">Vault-Tec Sector 99</h4>
                      <p className="text-[8px] text-pip-green/20 uppercase">Emergency Protocol Active</p>
                    </div>
                  )}
                  {activeBase.name.includes("Bunker") && (
                    <div className="absolute inset-0 border-[40px] border-slate-900 opacity-50" />
                  )}
                  {activeBase.name.includes("Dead End") && (
                    <div className="absolute inset-0 bg-red-950/5 animate-pulse" />
                  )}
                  <div className="absolute bottom-1/4 right-1/4 h-64 w-64 border-l-4 border-b-4 border-pip-green/10 rounded-bl-3xl" />
                </>
              )}

              {activeBase.type === "OUTPOST" && (
                <>
                  <div className="absolute inset-0 bg-[#1e1a12]" />
                  {activeBase.name.includes("Sunset") && (
                    <div className="absolute inset-0 bg-gradient-to-t from-orange-950/20 to-transparent" />
                  )}

                  {/* Universal Outpost Details: Watchtowers and Searchlights */}
                  <div className="absolute top-0 right-1/4 h-full w-20 bg-black/10 border-x border-desert/10 skew-x-12 pointer-events-none" />
                  <div className="absolute top-0 left-1/4 h-full w-20 bg-black/10 border-x border-desert/10 -skew-x-12 pointer-events-none" />
                  
                  {/* Rotating Searchlight */}
                  <motion.div 
                    animate={{ rotate: [20, 70, 20], opacity: [0.3, 0.5, 0.3] }}
                    transition={{ repeat: Infinity, duration: 5, ease: "easeInOut" }}
                    className="absolute top-0 left-0 w-[1200px] h-40 bg-gradient-to-r from-white/20 to-transparent origin-left blur-3xl pointer-events-none"
                  />

                  {/* Sandbag Wall Silhouettes */}
                  <div className="absolute bottom-1/4 left-20 flex space-x-1 opacity-20 pointer-events-none">
                    {[...Array(6)].map((_, i) => <div key={i} className="w-10 h-6 bg-desert border border-black/40" />)}
                  </div>

                  {activeBase.name.includes("Fort") || activeBase.name.includes("Station") ? (
                    <div className="absolute inset-0 border-dashed border-2 border-desert/10 m-20" />
                  ) : null}
                  <div className="absolute bottom-20 left-1/3 w-40 h-10 bg-desert/5 border border-desert/20 skew-x-12" />
                  {activeBase.name.includes("Well") && (
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 border-8 border-desert/20 rounded-full">
                       <div className="absolute inset-0 bg-blue-900/20 rounded-full blur-sm" />
                    </div>
                  )}
                  {activeBase.name.includes("Citadel") && (
                    <div className="absolute inset-0 border-[60px] border-slate-900/80">
                       <div className="absolute inset-0 border-4 border-pip-amber/5 m-4" />
                    </div>
                  )}
                  {activeBase.name.includes("Silo") && (
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full border-[20px] border-black shadow-[0_0_50px_rgba(0,0,0,1)]">
                       <div className="absolute inset-0 bg-slate-900 rounded-full" />
                    </div>
                  )}
                </>
              )}

              {activeBase.type === "TOWER" && (
                <>
                  <div className="absolute inset-0 bg-[#08080f]" />
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 border border-pip-amber/10 rounded-full animate-pulse" />
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] border border-pip-amber/5 rounded-full animate-pulse delay-700" />
                  {activeBase.name.includes("Radar") && (
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-1 bg-pip-amber/10 rotate-45" />
                  )}
                  {activeBase.name.includes("Dust") && (
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-pip-amber/5 to-transparent animate-pulse" />
                  )}
                  {activeBase.name.includes("Peak") && (
                    <div className="absolute inset-0 bg-gradient-to-b from-black/40 to-transparent" />
                  )}
                  <div className="absolute bottom-10 right-10 font-mono text-pip-amber/20 text-[10px] tracking-tighter uppercase whitespace-nowrap">Broadcast: {activeBase.name.split(' ').join('_')}</div>
                </>
              )}

              {activeBase.type === "RUINS" && (
                <>
                  <div className="absolute inset-0 bg-[#160d0d]" />
                  {activeBase.name.toLowerCase().includes("highway") && (
                    <div className="absolute top-1/2 left-0 w-full h-[320px] -translate-y-1/2 bg-[#1a1a1a] border-y border-white/5">
                      <div className="absolute top-1/2 left-0 w-full h-6 -translate-y-1/2 flex justify-around opacity-20">
                        {[...Array(12)].map((_, i) => (
                          <div key={i} className="w-16 h-full bg-yellow-600" />
                        ))}
                      </div>
                    </div>
                  )}
                  {activeBase.name.includes("Mine") && (
                    <div className="absolute inset-0 opacity-40" style={{ 
                      backgroundImage: 'repeating-linear-gradient(45deg, #000, #000 10px, #1a0d00 10px, #1a0d00 20px)' 
                    }} />
                  )}
                  {activeBase.name.includes("Pit") && (
                    <div className="absolute inset-0 shadow-[inset_0_0_200px_rgba(26,255,26,0.15)] bg-green-950/10" />
                  )}
                  {activeBase.name.includes("Oasis") && (
                    <div className="absolute inset-0 bg-green-900/10 shadow-[inset_0_0_150px_rgba(34,197,94,0.2)]">
                       <div className="absolute top-10 left-10 h-32 w-32 rounded-full bg-green-500/10 blur-2xl" />
                       <div className="absolute bottom-20 right-40 h-48 w-48 rounded-full bg-blue-500/5 blur-3xl" />
                    </div>
                  )}
                  {activeBase.name.includes("Zion") && (
                    <div className="absolute inset-0 flex items-center justify-center opacity-10">
                       <div className="w-1 h-full bg-pip-amber/10 -rotate-12" />
                       <div className="w-1 h-full bg-pip-amber/10 rotate-12" />
                    </div>
                  )}
                  {activeBase.name.includes("Scrap") && (
                    <div className="absolute inset-0 overflow-hidden opacity-30">
                       {[...Array(20)].map((_, i) => (
                         <div 
                           key={i} 
                           className="absolute border border-gray-700 bg-gray-900/50" 
                           style={{
                             left: `${Math.random() * 100}%`,
                             top: `${Math.random() * 100}%`,
                             width: `${20 + Math.random() * 60}px`,
                             height: `${10 + Math.random() * 40}px`,
                             transform: `rotate(${Math.random() * 360}deg)`
                           }}
                         />
                       ))}
                    </div>
                  )}
                  {activeBase.name.includes("Town") && (
                    <div className="absolute inset-0 flex items-center justify-center opacity-5" />
                  )}
                  <div className="absolute bottom-10 right-10 text-red-700/20 font-mono italic text-sm">{activeBase.name} - Scraped Territory</div>
                  <div className="absolute top-0 right-0 h-full w-1/3 bg-gradient-to-l from-red-950/20 to-transparent" />
                </>
              )}

            </div>

             {/* Clean Combat HUD - Minimal integrated Info */}
             <div className="absolute inset-x-8 top-8 flex justify-between items-start z-30 pointer-events-none">
               <div className="flex flex-col space-y-1">
                 <span className="font-mono text-[10px] text-pip-green/60 uppercase tracking-widest leading-none">{gameState === "DEFENSE" ? "Siege Target" : "Target Sector"}</span>
                 <span className="text-2xl font-bold uppercase text-pip-green leading-none">{activeBase.name}</span>
                 {gameState === "PLAYING" && (
                   <div className="flex items-center space-x-2 mt-2">
                     <div className="w-48 h-2 bg-black border border-pip-green/20 relative overflow-hidden">
                         <motion.div className={`h-full ${isContested ? 'bg-pip-amber' : 'bg-pip-green'}`} style={{ width: `${captureProgress}%` }} />
                         {isContested && (
                           <div className="absolute inset-0 flex items-center justify-center">
                             <span className="text-[8px] font-bold text-black uppercase animate-pulse">CONTESTED</span>
                           </div>
                         )}
                     </div>
                     <span className="text-[10px] font-mono text-pip-green/80 uppercase">Capture Progress</span>
                   </div>
                 )}
                 {gameState === "DEFENSE" && activeBase?.id === 1 && (
                    <div className="mt-4 bg-black/60 border border-pip-amber/40 p-3 font-mono flex flex-col items-center">
                        <span className="text-[10px] text-pip-amber/60">SURVIVAL TIME</span>
                        <span className="text-3xl font-bold text-pip-amber">
                            {Math.floor(survivalTime / 60)}:{String(survivalTime % 60).padStart(2, '0')}
                        </span>
                        {boss && (
                           <div className="w-full mt-2">
                             <div className="flex justify-between text-[8px] text-red-500 uppercase">
                               <span>Boss Integrity</span>
                               <span>{Math.ceil(bossHPRef.current)}</span>
                             </div>
                             <div className="w-full h-1 bg-red-950/40 mt-0.5">
                                <div className="h-full bg-red-600" style={{ width: `${(bossHPRef.current / boss.maxHp) * 100}%` }} />
                             </div>
                           </div>
                        )}
                    </div>
                 )}
               </div>

              <div className="flex flex-col items-end space-y-1">
                <span className="font-mono text-[10px] text-pip-green/60 uppercase tracking-widest leading-none">Status Profile</span>
                <span className="text-2xl font-bold font-mono text-pip-green leading-none">
                  {gameState === "PLAYING" ? (isContested ? "CONTESTED" : "SECURING") : "UNDER SIEGE"}
                </span>
                <div className="flex flex-col items-end mt-2">
                   <span className="text-[10px] font-mono text-pip-amber uppercase tracking-wider">Scrap Acquired: {scrap}</span>
                  {isMultiplayer && (
                    <div className="flex items-center space-x-2 mt-4 px-2 py-1 bg-blue-500/10 border border-blue-500/30 rounded-sm">
                       <Network className="h-3 w-3 text-blue-400 animate-pulse" />
                       <span className="text-[8px] text-blue-400 font-mono tracking-widest uppercase">Net Link Active</span>
                    </div>
                  )}
                   <span className="text-[8px] font-mono text-pip-amber/60 uppercase font-bold text-pip-amber animate-pulse">{gameState === "DEFENSE" ? "HOLD THE LINE" : "ESTABLISH SIGNAL"}</span>
                </div>
              </div>
            </div>

            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-md px-8 z-30 pointer-events-none">
              <div className="flex flex-col space-y-2">
                {gameState === "DEFENSE" && (
                  <div className="flex flex-col space-y-1">
                    <div className="flex justify-between text-[8px] uppercase text-pip-amber/80 font-mono">
                      <span>Wall Defense Integrity</span>
                      <span>{Math.max(0, vaultHP)} HP</span>
                    </div>
                    <div className="w-full h-1 bg-black/40 border border-pip-amber/30">
                      <div className="h-full bg-pip-amber shadow-[0_0_10px_#ffb84d]" style={{ width: `${(vaultHP / (1000 * upgrades.baseDefense)) * 100}%` }} />
                    </div>
                  </div>
                )}
                <div className="flex flex-col space-y-1">
                  {upgrades.armor > 0 && (
                    <div className="flex flex-col space-y-1 mb-1">
                      <div className="flex justify-between text-[8px] uppercase text-blue-400/80 font-mono">
                        <span>Armor Plating</span>
                        <span>{Math.max(0, playerArmor)} / {50 * upgrades.armor}</span>
                      </div>
                      <div className="w-full h-1 bg-black/40 border border-blue-400/30">
                        <motion.div 
                          className="h-full bg-blue-400 shadow-[0_0_10px_#60a5fa]" 
                          style={{ width: `${(playerArmor / (50 * upgrades.armor || 1)) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex justify-between text-[8px] uppercase text-pip-green/80 font-mono">
                    <span>Infiltrator Integrity</span>
                    <span>{Math.max(0, playerHP)} / {100 * upgrades.health}</span>
                  </div>
                  <div className="w-full h-1.5 bg-black/40 border border-pip-green/30">
                    <motion.div 
                      className="h-full bg-pip-green shadow-[0_0_10px_#1aff1a]" 
                      style={{ width: `${(playerHP / (100 * upgrades.health)) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* High Performance Game Canvas */}
            <canvas 
              ref={canvasRef} 
              width={window.innerWidth}
              height={window.innerHeight}
              className="absolute inset-0 z-10 pointer-events-none"
            />

            {/* UI Overlays */}
            <div className="absolute inset-0 pointer-events-none">
              {/* Capture Zone Visual (Keeping HTML for sharp icons) */}
              {gameState === "PLAYING" && captureZone && (
                <div 
                  className={`absolute border-2 rounded-full flex items-center justify-center transition-colors duration-500 ${isContested ? 'border-pip-amber/40 bg-pip-amber/5' : 'border-pip-green/20 bg-pip-green/5'}`}
                  style={{ 
                    left: captureZone.x - captureZone.radius, 
                    top: captureZone.y - captureZone.radius, 
                    width: captureZone.radius * 2, 
                    height: captureZone.radius * 2 
                  }}
                >
                  <div className="flex flex-col items-center">
                     <Target className={`h-8 w-8 mb-2 ${isContested ? 'text-pip-amber animate-pulse' : 'text-pip-green opacity-40'}`} />
                     <span className={`font-mono text-[10px] ${isContested ? 'text-pip-amber' : 'text-pip-green opacity-40'}`}>
                       {isContested ? "SIGNAL BLOCKED" : "LINKING..."}
                     </span>
                  </div>
                  {/* Capture Ring filling */}
                  <svg className="absolute inset-0 -rotate-90 w-full h-full">
                     <circle 
                       cx={captureZone.radius} 
                       cy={captureZone.radius} 
                       r={captureZone.radius - 2} 
                       fill="none" 
                       stroke={isContested ? "rgba(255, 184, 77, 0.4)" : "rgba(26, 255, 26, 0.4)"} 
                       strokeWidth="4" 
                       strokeDasharray={2 * Math.PI * (captureZone.radius - 2)}
                       strokeDashoffset={2 * Math.PI * (captureZone.radius - 2) * (1 - captureProgress / 100)}
                       className="transition-all"
                     />
                  </svg>
                </div>
              )}

              {/* Player & Gun */}
              <motion.div
                className="absolute flex items-center justify-center z-30"
                animate={{ x: playerPos.x - PLAYER_SIZE/2, y: playerPos.y - PLAYER_SIZE/2 }}
                transition={{ type: "tween", ease: "linear", duration: 0 }}
                style={{ width: PLAYER_SIZE, height: PLAYER_SIZE }}
              >
                {/* Floating Bars */}
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 flex flex-col space-y-0.5 w-10 pointer-events-none">
                   {playerArmor > 0 && (
                     <div className="h-1 bg-black/60 border border-blue-400/30 overflow-hidden rounded-full">
                        <div className="h-full bg-blue-400" style={{ width: `${(playerArmor / (50 * upgrades.armor || 1)) * 100}%` }} />
                     </div>
                   )}
                   <div className="h-1 bg-black/60 border border-pip-green/30 overflow-hidden rounded-full">
                      <div className="h-full bg-pip-green shadow-[0_0_5px_rgba(26,255,26,0.5)]" style={{ width: `${(playerHP / (100 * upgrades.health)) * 100}%` }} />
                   </div>
                </div>

                {/* Character Body */}
                <div className="w-full h-full bg-[#111] border-2 border-pip-green shadow-[0_0_15px_#1aff1a] rounded-sm flex items-center justify-center relative">
                   {/* Armor Visualization */}
                   {playerArmor > 0 && (
                     <div 
                       className="absolute -inset-1 border border-blue-400/50 rounded-sm animate-pulse" 
                       style={{ opacity: playerArmor / (50 * upgrades.armor || 1) }}
                     />
                   )}
                   <div className="w-1.5 h-1.5 bg-pip-green rounded-full" />
                   
                   {/* Weapon Barrel */}
                   <div 
                    className="absolute left-1/2 top-1/2 origin-left bg-pip-green"
                    style={{ 
                      height: currentWeapon.barrelWidth,
                      width: currentWeapon.barrelLength, 
                      transform: `translateY(-50%) rotate(${aimAngle}deg)`,
                      boxShadow: `0 0 10px ${currentWeapon.color}`,
                      backgroundColor: currentWeapon.color
                    }}
                   >
                     <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full" style={{ backgroundColor: `${currentWeapon.color}22` }} />
                   </div>
                </div>
              </motion.div>

              {/* Entitites (Bullets, Enemies, Obstacles, Particles) are now rendered via high-performance Canvas above */}

            </div>
          </div>
        ))}
        {gameState === "GAMEOVER" && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/95 space-y-12"
          >
            <div className="scanline" />
            <div className="flex flex-col items-center">
              <Skull className="h-20 w-20 text-red-500 mb-6 animate-pulse" />
              <h2 className="text-7xl font-mono text-red-600 tracking-tighter uppercase terminal-flicker">Signal Lost</h2>
              <div className="text-[10px] text-red-500/40 italic uppercase tracking-[0.5em] mt-2 font-black">Bio-Signature Flatline Detected</div>
            </div>
            
            <div className="w-full max-w-sm border-2 border-pip-green/20 p-8 space-y-8 bg-black/80 relative">
              <div className="flex flex-col space-y-4">
                 <div className="flex justify-between items-center text-[10px] text-pip-green/40 font-black uppercase">
                    <span>Tactical Recap</span>
                    <span>Verified Data</span>
                 </div>
                 <div className="space-y-2 font-mono">
                    <div className="flex justify-between border-b border-pip-green/10 pb-1">
                      <span className="text-pip-green/60">Mission Score</span>
                      <span className="text-white text-lg">{score}</span>
                    </div>
                    <div className="flex justify-between border-b border-pip-green/10 pb-1">
                      <span className="text-pip-green/60">Scrap Harvested</span>
                      <span className="text-pip-amber font-bold">+{scrapEarnedInMission}</span>
                    </div>
                    <div className="flex justify-between text-[10px] mt-4">
                      <span className="text-pip-green/30 italic uppercase">Neural Preservation:</span>
                      <span className="text-pip-green/30">ENABLED</span>
                    </div>
                 </div>
              </div>

              <div className="flex flex-col space-y-4">
                {isMultiplayer ? (
                  <>
                    <button 
                      onClick={() => {
                        playerHPRef.current = 100 * upgrades.health;
                        playerArmorRef.current = 50 * upgrades.armor;
                        setPlayerHP(playerHPRef.current);
                        setPlayerArmor(playerArmorRef.current);
                        setGameState("PLAYING");
                        // Clear entities to avoid insta-death
                        enemiesRef.current = [];
                        bulletsRef.current = [];
                        enemyBulletsRef.current = [];
                      }} 
                      className="atomic-btn bg-pip-green/10 border-pip-green group relative overflow-hidden"
                    >
                      <div className="absolute inset-0 bg-pip-green/5 group-hover:translate-x-full transition-transform duration-500" />
                      <div className="flex items-center justify-center space-x-3">
                        <RotateCcw className="h-5 w-5" />
                        <span>Re-Initialize Link</span>
                      </div>
                    </button>
                    <button 
                      onClick={() => setGameState("LOBBY")} 
                      className="atomic-btn border-blue-500/40 text-blue-400 bg-blue-500/5 hover:bg-blue-400 hover:text-white"
                    >
                      <LogOut className="h-4 w-4 mr-2" />
                      Return to C2 Node
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setGameState("MAP")} className="atomic-btn relative group overflow-hidden">
                       <span className="relative z-10">Initial Map Access</span>
                       <div className="absolute inset-0 bg-pip-green/20 -translate-x-full group-hover:translate-x-0 transition-transform" />
                    </button>
                    <button onClick={() => setGameState("MENU")} className="atomic-btn text-sm opacity-60 border-pip-green/20">Terminal Shutdown</button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute bottom-4 left-4 font-mono text-[8px] opacity-20 tracking-widest uppercase">
        Signal Strength: Good | Radiation: Minimal | Oxygen: 98%
      </div>
    </div>
  );
}

