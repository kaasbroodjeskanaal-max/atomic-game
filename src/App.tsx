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
  AlertTriangle
} from "lucide-react";

type GameState = "MENU" | "MAP" | "PLAYING" | "GAMEOVER" | "STORY";

interface Entity {
  id: number;
  x: number;
  y: number;
  radius: number;
}

interface Obstacle extends Entity {
  w: number;
  h: number;
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
}

interface Particle extends Entity {
  vx: number;
  vy: number;
  life: number;
  color: string;
}

interface BaseNode {
  id: number;
  name: string;
  x: number;
  y: number;
  captured: boolean;
  difficulty: number;
  type?: "VAULT" | "OUTPOST" | "TOWER" | "RUINS";
}

const PLAYER_SPEED = 4;
const PLAYER_SIZE = 24;
const BULLET_SPEED = 10;
const ENEMY_SPAWN_RATE = 0.025;

export default function App() {
  const [gameState, setGameState] = useState<GameState>("MENU");
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [captureProgress, setCaptureProgress] = useState(0);
  
  // Weapon state
  const [aimAngle, setAimAngle] = useState(0);

  // Base persistence
  const [bases, setBases] = useState<BaseNode[]>([
    { id: 1, name: "Vault 99", x: 15, y: 75, captured: true, difficulty: 0, type: "VAULT" },
    { id: 2, name: "Sunset Outpost", x: 40, y: 30, captured: false, difficulty: 1, type: "OUTPOST" },
    { id: 3, name: "Wasteland Tower", x: 75, y: 20, captured: false, difficulty: 2, type: "TOWER" },
    { id: 4, name: "Silo Delta", x: 80, y: 70, captured: false, difficulty: 3, type: "OUTPOST" },
    { id: 5, name: "Ruins of Zion", x: 25, y: 15, captured: false, difficulty: 4, type: "RUINS" },
    { id: 6, name: "Nuka Station", x: 55, y: 85, captured: false, difficulty: 2, type: "OUTPOST" },
    { id: 7, name: "Dust Reservoir", x: 60, y: 50, captured: false, difficulty: 3, type: "TOWER" },
  ]);
  const [activeBase, setActiveBase] = useState<BaseNode | null>(null);

  // State for rendering
  const [playerPos, setPlayerPos] = useState({ x: 0, y: 0 });
  const [bullets, setBullets] = useState<Bullet[]>([]);
  const [enemyBullets, setEnemyBullets] = useState<EnemyBullet[]>([]);
  const [enemies, setEnemies] = useState<Enemy[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);

  // Internal game state with refs for performance
  const playerRef = useRef({ x: 0, y: 0 });
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

  const lastFireTimeRef = useRef(0);

  const startInfiltration = (base: BaseNode) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    setActiveBase(base);
    playerRef.current = { x: rect.width / 2, y: rect.height / 2 };
    setPlayerPos({ ...playerRef.current });
    
    bulletsRef.current = [];
    enemyBulletsRef.current = [];
    enemiesRef.current = [];
    particlesRef.current = [];
    obstaclesRef.current = [];
    captureProgressRef.current = 0;
    
    // Generate Obstacles based on base type
    const newObstacles: Obstacle[] = [];
    if (base.type === "VAULT") {
      // Room-like structure
      newObstacles.push({ id: -1, x: rect.width * 0.2, y: rect.height * 0.2, w: 200, h: 20, radius: 0 });
      newObstacles.push({ id: -2, x: rect.width * 0.2, y: rect.height * 0.2, w: 20, h: 200, radius: 0 });
      newObstacles.push({ id: -3, x: rect.width * 0.8 - 200, y: rect.height * 0.8, w: 200, h: 20, radius: 0 });
      newObstacles.push({ id: -4, x: rect.width * 0.8, y: rect.height * 0.8 - 200, w: 20, h: 200, radius: 0 });
    } else if (base.type === "OUTPOST") {
      // Scatter boxes
      for (let i = 0; i < 5; i++) {
        newObstacles.push({ 
          id: -10 - i, 
          x: Math.random() * (rect.width - 200) + 100, 
          y: Math.random() * (rect.height - 200) + 100, 
          w: 60, 
          h: 60, 
          radius: 0 
        });
      }
    } else if (base.type === "TOWER") {
      // Central pillar
      newObstacles.push({ id: -20, x: rect.width / 2 - 50, y: rect.height / 2 - 50, w: 100, h: 100, radius: 0 });
    } else {
      // Destroyed walls
      newObstacles.push({ id: -30, x: 200, y: 300, w: 20, h: 150, radius: 0 });
      newObstacles.push({ id: -31, x: rect.width - 250, y: 400, w: 100, h: 20, radius: 0 });
    }

    // Ensure player doesn't start inside an obstacle
    newObstacles.forEach(obs => {
      if (playerRef.current.x > obs.x && playerRef.current.x < obs.x + obs.w &&
          playerRef.current.y > obs.y && playerRef.current.y < obs.y + obs.h) {
        playerRef.current.x = 50; 
        playerRef.current.y = 50;
      }
    });

    obstaclesRef.current = newObstacles;
    setObstacles(newObstacles);

    setBullets([]);
    setEnemyBullets([]);
    setEnemies([]);
    setParticles([]);
    setCaptureProgress(0);
    setScore(0);
    setGameState("PLAYING");
  };

  const handleGameOver = (win: boolean = false) => {
    if (win && activeBase) {
      setBases(prev => prev.map(b => b.id === activeBase.id ? { ...b, captured: true } : b));
    }
    setGameState("GAMEOVER");
    setHighScore((prev) => Math.max(prev, score));
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
  };

  const spawnBullet = (targetX: number, targetY: number) => {
    if (gameState !== "PLAYING") return;
    
    const dx = targetX - playerRef.current.x;
    const dy = targetY - playerRef.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    const vx = (dx / dist) * BULLET_SPEED;
    const vy = (dy / dist) * BULLET_SPEED;

    bulletsRef.current.push({
      id: idCounterRef.current++,
      x: playerRef.current.x,
      y: playerRef.current.y,
      vx,
      vy,
      radius: 2.5
    });
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
    if (gameState !== "PLAYING") return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    // 1. Move Player
    const speed = PLAYER_SPEED;
    const oldX = playerRef.current.x;
    const oldY = playerRef.current.y;

    if (keysRef.current["KeyW"] || keysRef.current["ArrowUp"]) playerRef.current.y -= speed;
    if (keysRef.current["KeyS"] || keysRef.current["ArrowDown"]) playerRef.current.y += speed;
    if (keysRef.current["KeyA"] || keysRef.current["ArrowLeft"]) playerRef.current.x -= speed;
    if (keysRef.current["KeyD"] || keysRef.current["ArrowRight"]) playerRef.current.x += speed;

    // Obstacle Collision for Player
    obstaclesRef.current.forEach(obs => {
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
    playerRef.current.x = Math.max(PLAYER_SIZE, Math.min(rect.width - PLAYER_SIZE, playerRef.current.x));
    playerRef.current.y = Math.max(PLAYER_SIZE, Math.min(rect.height - PLAYER_SIZE, playerRef.current.y));
    setPlayerPos({ ...playerRef.current });

    // Aim Angle
    const angle = Math.atan2(mouseRef.current.y - playerRef.current.y, mouseRef.current.x - playerRef.current.x);
    setAimAngle(angle * (180 / Math.PI));

    // 2. Weapon Logic (Rapid Fire)
    if (mouseRef.current.down) {
      if (time - lastFireTimeRef.current > 180) {
        spawnBullet(mouseRef.current.x, mouseRef.current.y);
        lastFireTimeRef.current = time;
      }
    }

    // 3. Capture Progress
    captureProgressRef.current += 0.05;
    setCaptureProgress(Math.min(100, Math.floor(captureProgressRef.current)));
    if (captureProgressRef.current >= 100) {
      handleGameOver(true);
      return;
    }

    // 4. Move & Clean Bullets
    bulletsRef.current = bulletsRef.current
      .map(b => ({ ...b, x: b.x + b.vx, y: b.y + b.vy }))
      .filter(b => {
        const hitWall = obstaclesRef.current.some(obs => 
          b.x > obs.x && b.x < obs.x + obs.w && b.y > obs.y && b.y < obs.y + obs.h
        );
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
    const baseDifficulty = activeBase?.difficulty || 0;
    // Lower difficulty adjustment: scale spawn rate more aggressively down for low difficulty
    const spawnChance = ENEMY_SPAWN_RATE * (0.3 + baseDifficulty * 0.4);
    
    if (Math.random() < spawnChance) {
      const side = Math.floor(Math.random() * 4);
      let ex = 0, ey = 0;
      if (side === 0) { ex = Math.random() * rect.width; ey = -50; }
      else if (side === 1) { ex = rect.width + 50; ey = Math.random() * rect.height; }
      else if (side === 2) { ex = Math.random() * rect.width; ey = rect.height + 50; }
      else { ex = -50; ey = Math.random() * rect.height; }

      const rand = Math.random();
      let type: Enemy["type"] = "ZOMBIE";
      let hp = 1, speed_val = 1.0, rad = 12, col = "#1aff1a";

      if (rand < 0.15 && baseDifficulty > 1) {
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
        speed: speed_val * (0.8 + baseDifficulty * 0.1), // Speed scales with difficulty
        color: col,
        type
      });
    }

    enemiesRef.current = enemiesRef.current.map(e => {
      const dx = playerRef.current.x - e.x;
      const dy = playerRef.current.y - e.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      let moveX = (dx / dist) * e.speed;
      let moveY = (dy / dist) * e.speed;

      // Obstacle collision for enemies
      const nextX = e.x + moveX;
      const nextY = e.y + moveY;
      let blockedX = false;
      let blockedY = false;

      obstaclesRef.current.forEach(obs => {
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
        if (dist < 250) {
          moveX = -moveX * 0.5;
          moveY = -moveY * 0.5;
        }
        if (!e.lastShot || time - e.lastShot > 2000) {
          spawnEnemyBullet(e.x, e.y, playerRef.current.x, playerRef.current.y);
          e.lastShot = time;
        }
      }

      if (dist < e.radius + PLAYER_SIZE / 2) {
        handleGameOver(false);
      }

      return {
        ...e,
        x: e.x + moveX,
        y: e.y + moveY,
      };
    });

    // 6. Bullet Collision
    bulletsRef.current = bulletsRef.current.filter(b => {
      let hit = false;
      enemiesRef.current = enemiesRef.current.filter(e => {
        const dx = b.x - e.x;
        const dy = b.y - e.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < b.radius + e.radius) {
          hit = true;
          e.hp -= 1;
          if (e.hp <= 0) {
            spawnExplosion(e.x, e.y, e.color, e.type === "BRUTE" ? 12 : 6);
            setScore(s => s + (e.type === "BRUTE" ? 50 : 10));
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
        handleGameOver(false);
        return false;
      }
      return true;
    });

    // 7. Particles
    particlesRef.current = particlesRef.current
      .map(p => ({ ...p, x: p.x + p.vx, y: p.y + p.vy, life: p.life - 0.03 }))
      .filter(p => p.life > 0);

    // Sync batches
    setBullets([...bulletsRef.current]);
    setEnemyBullets([...enemyBulletsRef.current]);
    setEnemies([...enemiesRef.current]);
    setParticles([...particlesRef.current]);
    setObstacles([...obstaclesRef.current]);

    requestRef.current = requestAnimationFrame(update);
  }, [gameState, activeBase, score]);

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

      {/* MENU STATE */}
      <AnimatePresence>
        {gameState === "MENU" && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-bg-atomic space-y-12"
          >
            <div className="flex flex-col items-center space-y-4">
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
              <button className="atomic-btn opacity-50 cursor-not-allowed">
                <span>Load Records</span>
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
              <button onClick={() => setGameState("MENU")} className="atomic-btn border-desert text-desert hover:bg-desert/20 py-2 px-6 text-sm">Return</button>
            </div>

            <div className="relative flex-1 atomic-panel overflow-hidden rounded-xl bg-desert-dark border-desert shadow-[inset_0_0_50px_rgba(61,51,33,1)]">
              <div 
                className="absolute inset-0 opacity-20" 
                style={{ 
                  backgroundImage: 'radial-gradient(circle, #c2b280 1px, transparent 1px)',
                  backgroundSize: '30px 30px' 
                }} 
              />
              
              {bases.map(base => (
                <motion.button
                  key={base.id}
                  whileHover={{ scale: 1.1, zIndex: 10 }}
                  onClick={() => {
                    if (base.id === 1) {
                      setGameState("STORY");
                    } else if (!base.captured) {
                      startInfiltration(base);
                    }
                  }}
                  className={`absolute p-3 rounded border-2 flex flex-col items-center space-y-1 transition-all ${
                    base.captured 
                      ? "border-desert bg-desert/30 text-desert shadow-[0_0_15px_#c2b280]" 
                      : "border-pip-amber bg-pip-amber/10 text-pip-amber shadow-[0_0_15px_#ffb84d]"
                  }`}
                  style={{ left: `${base.x}%`, top: `${base.y}%` }}
                >
                  <div className="bg-black/50 p-2 rounded">
                    {base.type === "VAULT" && <Shield className="h-6 w-6" />}
                    {base.type === "OUTPOST" && <Warehouse className="h-6 w-6" />}
                    {base.type === "TOWER" && <TowerControl className="h-6 w-6" />}
                    {base.type === "RUINS" && <Skull className="h-6 w-6" />}
                  </div>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-widest whitespace-nowrap bg-black/60 px-1">{base.name}</span>
                  {!base.captured && <span className="text-[8px] bg-black/80 px-1">DRANGER: LVL {base.difficulty}</span>}
                  {base.id === 1 && <span className="text-[8px] text-desert uppercase animate-pulse">Your Origin</span>}
                </motion.button>
              ))}
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

        {/* PLAYING STATE */}
        {gameState === "PLAYING" && (activeBase && (
          <div className="absolute inset-0">
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
                  <div className="absolute top-1/4 left-1/4 border border-pip-green/30 p-4 rounded w-48 h-32 flex flex-col justify-between">
                    <div className="h-1 w-full bg-pip-green/20" />
                    <span className="text-[8px] text-pip-green/40 uppercase font-mono tracking-widest">Cryo Storage Unit 04</span>
                  </div>
                  <div className="absolute bottom-1/4 right-1/4 h-64 w-64 border-l-4 border-b-4 border-pip-green/10 rounded-bl-3xl" />
                  <Activity className="absolute bottom-12 left-12 h-24 w-24 text-pip-green opacity-5" />
                </>
              )}

              {activeBase.type === "OUTPOST" && (
                <>
                  <div className="absolute top-10 right-10 flex flex-col items-center opacity-20 transform rotate-12">
                     <Warehouse className="h-32 w-32 text-desert" />
                     <span className="text-[10px] text-desert uppercase font-mono font-bold">Supply Depot Delta</span>
                  </div>
                  <div className="absolute bottom-20 left-1/3 w-40 h-10 bg-desert/5 border border-desert/20 skew-x-12" />
                  <Shield className="absolute top-1/2 left-20 h-16 w-16 text-desert opacity-5" />
                </>
              )}

              {activeBase.type === "TOWER" && (
                <>
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 border border-pip-amber/10 rounded-full animate-pulse" />
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] border border-pip-amber/5 rounded-full animate-pulse delay-500" />
                  <div className="absolute top-10 left-10 opacity-20">
                    <TowerControl className="h-24 w-24 text-pip-amber" />
                  </div>
                  <div className="absolute bottom-10 right-10 font-mono text-pip-amber/20 text-xs tracking-tighter">FREQ: 98.6 MHZ // BROADCAST SECURED</div>
                </>
              )}

              {activeBase.type === "RUINS" && (
                <>
                  <div className="absolute top-1/3 left-1/3 transform -rotate-45">
                     <Skull className="h-48 w-48 text-red-900 opacity-10" />
                  </div>
                  <div className="absolute bottom-10 right-10 text-red-700/20 font-mono italic text-sm">the silence of Zion...</div>
                  <div className="absolute top-0 right-0 h-full w-1/3 bg-gradient-to-l from-red-950/20 to-transparent" />
                </>
              )}

              {/* Universal Debris */}
              <div className="absolute top-1/4 left-1/4 border border-pip-green p-2 rounded transform rotate-12 h-20 w-32 flex items-center justify-center opacity-30">
                <span className="text-[10px] text-pip-green font-mono">CRATE #091</span>
              </div>
            </div>

            {/* Infiltration HUD */}
            <div className="absolute top-8 left-8 right-8 flex justify-between items-start z-30 pointer-events-none">
              <div className="flex flex-col space-y-4">
                <div className="atomic-panel p-4 flex flex-col">
                  <span className="font-mono text-[10px] text-pip-green uppercase tracking-widest mb-1">Target Sector</span>
                  <span className="text-xl font-bold uppercase">{activeBase.name}</span>
                </div>
                <div className="atomic-panel p-4 flex flex-col">
                  <span className="font-mono text-[10px] text-pip-green uppercase tracking-widest mb-1">Combat Data</span>
                  <span className="text-4xl font-bold font-mono">{score.toString().padStart(6, '0')}</span>
                </div>
              </div>

              <div className="flex flex-col items-end space-y-4">
                <div className="atomic-panel p-6 w-72 flex flex-col">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-mono text-[10px] text-pip-green uppercase tracking-widest">Infiltration</span>
                    <span className="font-mono text-xs">{captureProgress}%</span>
                  </div>
                  <div className="w-full h-4 bg-black border border-pip-green p-0.5">
                    <motion.div 
                      className="h-full bg-pip-green shadow-[0_0_10px_#1aff1a]" 
                      style={{ width: `${captureProgress}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Game Canvas Overlay */}
            <div className="absolute inset-0 pointer-events-none">
              {/* Player & Gun */}
              <motion.div
                className="absolute flex items-center justify-center z-30"
                animate={{ x: playerPos.x - PLAYER_SIZE/2, y: playerPos.y - PLAYER_SIZE/2 }}
                transition={{ type: "tween", ease: "linear", duration: 0 }}
                style={{ width: PLAYER_SIZE, height: PLAYER_SIZE }}
              >
                {/* Character Body */}
                <div className="w-full h-full bg-[#111] border-2 border-pip-green shadow-[0_0_15px_#1aff1a] rounded-sm flex items-center justify-center relative">
                   <div className="w-1.5 h-1.5 bg-pip-green rounded-full" />
                   
                   {/* Weapon Barrel */}
                   <div 
                    className="absolute left-1/2 top-1/2 h-2 origin-left bg-pip-green"
                    style={{ 
                      width: 20, 
                      transform: `translateY(-50%) rotate(${aimAngle}deg)`,
                      boxShadow: '0 0 10px #1aff1a'
                    }}
                   >
                     <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-pip-green/10" />
                   </div>
                </div>
              </motion.div>

              {/* Bullets */}
              {bullets.map(b => (
                <div key={b.id} className="absolute bg-white rounded-full shadow-[0_0_15px_#fff]" style={{ left: b.x - b.radius, top: b.y - b.radius, width: b.radius*2, height: b.radius*2, zIndex: 25 }} />
              ))}
              
              {enemyBullets.map(b => (
                <div key={b.id} className="absolute bg-pip-amber rounded-full shadow-[0_0_15px_#ffb84d]" style={{ left: b.x - b.radius, top: b.y - b.radius, width: b.radius*2, height: b.radius*2, zIndex: 22 }} />
              ))}

              {/* Zombies (Enemies) */}
              {enemies.map(e => (
                <div 
                  key={e.id}
                  className="absolute bg-black border-2 flex items-center justify-center overflow-hidden transition-transform"
                  style={{ 
                    left: e.x - e.radius, 
                    top: e.y - e.radius, 
                    width: e.radius*2, 
                    height: e.radius*2,
                    borderColor: e.color,
                    borderRadius: e.type === "BRUTE" ? "8px" : "50%",
                    zIndex: 20,
                    boxShadow: `0 0 12px ${e.color}`
                  }}
                >
                  <Skull className="h-4 w-4" style={{ color: e.color, opacity: 0.6 }} />
                  {e.hp > 1 && (
                    <div className="absolute top-0 left-0 h-1 bg-pip-green" style={{ width: `${(e.hp / 5) * 100}%` }} />
                  )}
                </div>
              ))}
              {/* Obstacles (Walls) */}
              {obstacles.map(obs => (
                <div 
                  key={obs.id} 
                  className={`absolute border-2 shadow-[0_0_10px_rgba(26,255,26,0.2)] bg-black/40 ${
                    activeBase.type === "VAULT" ? "border-pip-green/40" : 
                    activeBase.type === "OUTPOST" ? "border-desert/40" : 
                    activeBase.type === "TOWER" ? "border-pip-amber/40" : 
                    "border-red-900/40"
                  }`} 
                  style={{ left: obs.x, top: obs.y, width: obs.w, height: obs.h, zIndex: 18 }} 
                />
              ))}

              {/* Particles */}
              {particles.map(p => (
                <div key={p.id} className="absolute rounded-full" style={{ left: p.x - p.radius, top: p.y - p.radius, width: p.radius*2, height: p.radius*2, backgroundColor: p.color, opacity: p.life, zIndex: 15 }} />
              ))}
            </div>
          </div>
        ))}
        {gameState === "GAMEOVER" && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/90 space-y-12"
          >
            <div className="flex flex-col items-center">
              <Activity className="h-20 w-20 text-pip-green mb-6 animate-ping" />
              <h2 className="text-7xl font-mono text-pip-green terminal-flicker">Signal Lost</h2>
            </div>
            
            <div className="atomic-panel p-10 flex flex-col w-full max-w-sm">
              <div className="flex justify-between mb-4 font-mono text-xs border-b border-pip-green/30 pb-2">
                <span>RECORDS</span>
                <span>VALUE</span>
              </div>
              <div className="flex justify-between mb-2">
                <span>Score</span>
                <span className="text-white">{score}</span>
              </div>
              <div className="flex justify-between">
                <span>Sector Status</span>
                <span className={captureProgress >= 100 ? "text-pip-green uppercase" : "text-pip-amber uppercase"}>
                  {captureProgress >= 100 ? "Secured" : "Incomplete"}
                </span>
              </div>
            </div>

            <div className="flex flex-col space-y-4 w-full max-w-sm">
              <button onClick={() => setGameState("MAP")} className="atomic-btn">Initial Map Access</button>
              <button onClick={() => setGameState("MENU")} className="atomic-btn text-sm opacity-60">Terminal Shutdown</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Decorative HUD Elements */}
      <div className="absolute top-1/2 left-8 -translate-y-1/2 flex flex-col space-y-12 opacity-5 pointer-events-none">
        <Target className="h-16 w-16" />
        <Crosshair className="h-16 w-16" />
        <Info className="h-16 w-16" />
      </div>

      <div className="absolute bottom-4 left-4 font-mono text-[8px] opacity-20 tracking-widest uppercase">
        Signal Strength: Good | Radiation: Minimal | Oxygen: 98%
      </div>
    </div>
  );
}

