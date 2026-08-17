(() => {
  'use strict';

  const MAX_SEED = 2147483647;

  const ui = {
    sizeInput: document.getElementById('sizeInput'),
    seedInput: document.getElementById('seedInput'),
    newGameBtn: document.getElementById('newGameBtn'),
    copyUrlBtn: document.getElementById('copyUrlBtn'),
    remainingMines: document.getElementById('remainingMines'),
    timerText: document.getElementById('timerText'),
    message: document.getElementById('message'),
    board: document.getElementById('board')
  };

  const game = {
    width: 5,
    height: 5,
    mineCount: 10,
    seed: '',
    cells: [],
    status: 'ready',
    openedCount: 0,
    startTime: 0,
    elapsedSeconds: 0,
    timerId: null,
    hoverSet: new Set(),
    failedCell: null
  };

  function randomSeed() {
    return String(Math.floor(Math.random() * (MAX_SEED + 1)));
  }

  function sanitizeNumericSeed(seedText) {
    const digits = String(seedText || '').replace(/\D/g, '');
    if (!digits) return '';
    const noLeadingZero = digits.replace(/^0+(?=\d)/, '');
    const n = Number(noLeadingZero);
    if (!Number.isFinite(n)) return String(MAX_SEED);
    const clamped = Math.max(0, Math.min(MAX_SEED, Math.floor(n)));
    return String(clamped);
  }

  function hash32(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function createRng(seedText) {
    let state = hash32(seedText) || 0x9e3779b9;
    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return ((state >>> 0) / 4294967296);
    };
  }

  function randomMineCount(side, seedText, salt) {
    const minMines = 6;
    const maxMines = Math.max(minMines, side * side - 2);
    const rng = createRng(`${seedText}#mine#${salt}`);
    return minMines + Math.floor(rng() * (maxMines - minMines + 1));
  }

  function inBounds(x, y, width, height) {
    return x >= 0 && y >= 0 && x < width && y < height;
  }

  function neighborsOf(x, y, width, height) {
    const out = [];
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (inBounds(nx, ny, width, height)) out.push([nx, ny]);
      }
    }
    return out;
  }

  function cellKey(x, y) {
    return `${x},${y}`;
  }

  function createEmptyBoard(width, height) {
    const cells = [];
    for (let y = 0; y < height; y += 1) {
      const row = [];
      for (let x = 0; x < width; x += 1) {
        row.push({
          x,
          y,
          isMine: false,
          opened: false,
          flagged: false,
          number: 0,
          hasClue: true
        });
      }
      cells.push(row);
    }
    return cells;
  }

  function computeNumbers(cells, width, height) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (cells[y][x].isMine) {
          cells[y][x].number = -1;
          continue;
        }
        const n = neighborsOf(x, y, width, height).reduce((acc, [nx, ny]) => {
          return acc + (cells[ny][nx].isMine ? 1 : 0);
        }, 0);
        cells[y][x].number = n;
      }
    }
  }

  function placeMines(cells, width, height, mineCount, safeZone, rng) {
    const candidates = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!safeZone.has(cellKey(x, y))) candidates.push([x, y]);
      }
    }
    if (mineCount > candidates.length) return false;

    for (let i = candidates.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    for (let i = 0; i < mineCount; i += 1) {
      const [x, y] = candidates[i];
      cells[y][x].isMine = true;
    }
    return true;
  }

  function cloneMineLayout(cells, width, height) {
    const out = createEmptyBoard(width, height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        out[y][x].isMine = cells[y][x].isMine;
        out[y][x].number = cells[y][x].number;
        out[y][x].hasClue = cells[y][x].hasClue;
      }
    }
    return out;
  }

  function floodOpen(sim, mineLayout, sx, sy, width, height) {
    const queue = [[sx, sy]];
    while (queue.length > 0) {
      const [x, y] = queue.shift();
      if (sim.opened[y][x] || sim.flagged[y][x]) continue;
      if (mineLayout[y][x].isMine) return false;
      sim.opened[y][x] = true;
      if (mineLayout[y][x].number !== 0) continue;
      for (const [nx, ny] of neighborsOf(x, y, width, height)) {
        if (!sim.opened[ny][nx] && !sim.flagged[ny][nx]) {
          queue.push([nx, ny]);
        }
      }
    }
    return true;
  }

  function isSolved(sim, width, height, mineCount) {
    let opened = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (sim.opened[y][x]) opened += 1;
      }
    }
    return opened === (width * height - mineCount);
  }

  function gatherFrontier(sim, width, height) {
    const set = new Set();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!sim.opened[y][x]) continue;
        for (const [nx, ny] of neighborsOf(x, y, width, height)) {
          if (!sim.opened[ny][nx] && !sim.flagged[ny][nx]) {
            set.add(cellKey(nx, ny));
          }
        }
      }
    }
    return Array.from(set).map((k) => k.split(',').map(Number));
  }

  function buildConstraints(sim, mineLayout, width, height, assumptionMap) {
    const varSet = new Set();
    const equations = [];

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!sim.opened[y][x]) continue;
        if (!mineLayout[y][x].hasClue) continue;
        const num = mineLayout[y][x].number;
        if (num < 0) continue;

        let flaggedCount = 0;
        let assumedMineCount = 0;
        const unknownVars = [];

        for (const [nx, ny] of neighborsOf(x, y, width, height)) {
          if (sim.flagged[ny][nx]) {
            flaggedCount += 1;
            continue;
          }
          if (sim.opened[ny][nx]) continue;

          const k = cellKey(nx, ny);
          if (assumptionMap.has(k)) {
            if (assumptionMap.get(k) === 1) assumedMineCount += 1;
          } else {
            unknownVars.push(k);
            varSet.add(k);
          }
        }

        const target = num - flaggedCount - assumedMineCount;
        if (target < 0) return null;
        if (target > unknownVars.length) return null;

        if (unknownVars.length === 0) {
          if (target !== 0) return null;
        } else {
          equations.push({ vars: unknownVars, target });
        }
      }
    }

    const allUnknown = [];
    let flaggedTotal = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (sim.flagged[y][x]) flaggedTotal += 1;
        if (!sim.opened[y][x] && !sim.flagged[y][x]) {
          const k = cellKey(x, y);
          if (!assumptionMap.has(k)) allUnknown.push(k);
        }
      }
    }

    let assumedMines = 0;
    for (const v of assumptionMap.values()) {
      assumedMines += v;
    }
    const remainingMines = mineCountGlobal - flaggedTotal - assumedMines;
    if (remainingMines < 0) return null;

    const vars = Array.from(varSet);
    const outsideCount = allUnknown.filter((k) => !varSet.has(k)).length;

    return { equations, vars, remainingMines, outsideCount };
  }

  let mineCountGlobal = 10;

  function satCheck(sim, mineLayout, width, height, assumptionMap) {
    const built = buildConstraints(sim, mineLayout, width, height, assumptionMap);
    if (!built) return false;

    const { equations, vars, remainingMines, outsideCount } = built;
    if (vars.length > 22) return true;

    const eqOfVar = new Map();
    for (let i = 0; i < equations.length; i += 1) {
      for (const v of equations[i].vars) {
        if (!eqOfVar.has(v)) eqOfVar.set(v, []);
        eqOfVar.get(v).push(i);
      }
    }

    const assigned = new Map();
    const eqAssignedSum = equations.map(() => 0);
    const eqUnassigned = equations.map((e) => e.vars.length);

    let minesInVars = 0;

    function boundsFail() {
      for (let i = 0; i < equations.length; i += 1) {
        const sum = eqAssignedSum[i];
        const rem = eqUnassigned[i];
        const target = equations[i].target;
        if (sum > target) return true;
        if (sum + rem < target) return true;
      }
      if (minesInVars > remainingMines) return true;
      const maxMinesPossible = minesInVars + (vars.length - assigned.size);
      if (maxMinesPossible + outsideCount < remainingMines) return true;
      return false;
    }

    function pickVar() {
      let best = null;
      let bestScore = -1;
      for (const v of vars) {
        if (assigned.has(v)) continue;
        const score = (eqOfVar.get(v) || []).length;
        if (score > bestScore) {
          bestScore = score;
          best = v;
        }
      }
      return best;
    }

    function applyVar(v, val) {
      assigned.set(v, val);
      if (val === 1) minesInVars += 1;
      const idxs = eqOfVar.get(v) || [];
      for (const ei of idxs) {
        eqUnassigned[ei] -= 1;
        if (val === 1) eqAssignedSum[ei] += 1;
      }
    }

    function revertVar(v, val) {
      assigned.delete(v);
      if (val === 1) minesInVars -= 1;
      const idxs = eqOfVar.get(v) || [];
      for (const ei of idxs) {
        eqUnassigned[ei] += 1;
        if (val === 1) eqAssignedSum[ei] -= 1;
      }
    }

    function allEqExact() {
      for (let i = 0; i < equations.length; i += 1) {
        if (eqAssignedSum[i] !== equations[i].target) return false;
      }
      return true;
    }

    function dfs() {
      if (boundsFail()) return false;
      if (assigned.size === vars.length) {
        if (!allEqExact()) return false;
        const minesLeftOutside = remainingMines - minesInVars;
        if (minesLeftOutside < 0 || minesLeftOutside > outsideCount) return false;
        return true;
      }

      const v = pickVar();
      applyVar(v, 0);
      if (dfs()) return true;
      revertVar(v, 0);

      applyVar(v, 1);
      if (dfs()) return true;
      revertVar(v, 1);

      return false;
    }

    return dfs();
  }

  function logicalSolvable(mineLayout, width, height, mineCount, initialOpens) {
    return logicalSolveStats(mineLayout, width, height, mineCount, initialOpens).solved;
  }

  function simOpenOne(sim, mineLayout, x, y) {
    if (sim.opened[y][x] || sim.flagged[y][x]) return true;
    if (mineLayout[y][x].isMine) return false;
    sim.opened[y][x] = true;
    return true;
  }

  function logicalSolveStats(mineLayout, width, height, mineCount, initialOpens) {
    mineCountGlobal = mineCount;
    const sim = {
      opened: Array.from({ length: height }, () => Array(width).fill(false)),
      flagged: Array.from({ length: height }, () => Array(width).fill(false))
    };

    let moveCount = 0;

    if (!initialOpens || initialOpens.length === 0) return { solved: false, moveCount: 0 };
    for (const [sx, sy] of initialOpens) {
      if (!simOpenOne(sim, mineLayout, sx, sy)) return { solved: false, moveCount: 0 };
    }

    let guard = 0;
    while (guard < 500) {
      guard += 1;

      if (isSolved(sim, width, height, mineCount)) return { solved: true, moveCount };

      let progress = false;
      actionLoop:
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (!sim.opened[y][x]) continue;
          if (!mineLayout[y][x].hasClue) continue;
          const num = mineLayout[y][x].number;
          if (num < 0) continue;

          let flagged = 0;
          const unknown = [];
          for (const [nx, ny] of neighborsOf(x, y, width, height)) {
            if (sim.flagged[ny][nx]) flagged += 1;
            else if (!sim.opened[ny][nx]) unknown.push([nx, ny]);
          }

          const need = num - flagged;
          if (need < 0) return { solved: false, moveCount };
          if (unknown.length === 0) continue;

          if (need === 0) {
            for (const [ux, uy] of unknown) {
              if (!simOpenOne(sim, mineLayout, ux, uy)) return { solved: false, moveCount };
            }
            moveCount += 1;
            progress = true;
            break actionLoop;
          }

          if (num > 0 && need === unknown.length) {
            for (const [fx, fy] of unknown) {
              sim.flagged[fy][fx] = true;
            }
            moveCount += 1;
            progress = true;
            break actionLoop;
          }
        }
      }

      if (!progress) {
        const frontier = gatherFrontier(sim, width, height);
        let satProgress = false;

        for (const [cx, cy] of frontier) {
          if (sim.opened[cy][cx] || sim.flagged[cy][cx]) continue;

          const k = cellKey(cx, cy);
          const couldBeMine = satCheck(sim, mineLayout, width, height, new Map([[k, 1]]));
          const couldBeSafe = satCheck(sim, mineLayout, width, height, new Map([[k, 0]]));

          if (!couldBeMine && !couldBeSafe) {
            return { solved: false, moveCount };
          }
          if (!couldBeMine && couldBeSafe) {
            if (!simOpenOne(sim, mineLayout, cx, cy)) return { solved: false, moveCount };
            moveCount += 1;
            satProgress = true;
            break;
          } else if (couldBeMine && !couldBeSafe) {
            if (!sim.flagged[cy][cx]) {
              sim.flagged[cy][cx] = true;
              moveCount += 1;
            }
            satProgress = true;
            break;
          }
        }

        if (!satProgress) {
          return { solved: false, moveCount };
        }
      }
    }

    return { solved: false, moveCount };
  }

  function nCkLimited(n, k, limit) {
    if (k < 0 || k > n) return 0;
    const kk = Math.min(k, n - k);
    let num = 1;
    for (let i = 1; i <= kk; i += 1) {
      num = (num * (n - kk + i)) / i;
      if (num > limit) return limit + 1;
    }
    return Math.floor(num);
  }

  function shuffleInPlace(arr, rng) {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function tryHintPool(mineLayout, width, height, mineCount, pool, hintCount, rng) {
    if (pool.length < hintCount) return null;

    const maxExactComb = 400;
    const combCount = nCkLimited(pool.length, hintCount, maxExactComb);

    if (combCount <= maxExactComb) {
      const pick = [];
      function dfs(start) {
        if (pick.length === hintCount) {
          if (logicalSolvable(mineLayout, width, height, mineCount, pick)) {
            return pick.map(([x, y]) => [x, y]);
          }
          return null;
        }
        for (let i = start; i < pool.length; i += 1) {
          pick.push(pool[i]);
          const ok = dfs(i + 1);
          pick.pop();
          if (ok) return ok;
        }
        return null;
      }
      return dfs(0);
    }

    const maxSamples = 450;
    const seen = new Set();
    const idx = Array.from({ length: pool.length }, (_, i) => i);
    for (let s = 0; s < maxSamples; s += 1) {
      shuffleInPlace(idx, rng);
      const chosen = idx.slice(0, hintCount).sort((a, b) => a - b);
      const key = chosen.join(',');
      if (seen.has(key)) continue;
      seen.add(key);

      const hints = chosen.map((i) => pool[i]);
      if (logicalSolvable(mineLayout, width, height, mineCount, hints)) {
        return hints.map(([x, y]) => [x, y]);
      }
    }

    return null;
  }

  function findMinimalInitialHints(mineLayout, width, height, mineCount, rng) {
    const safe = [];
    const nonZeroSafe = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (mineLayout[y][x].isMine) continue;
        const pos = [x, y];
        safe.push(pos);
        if (mineLayout[y][x].number > 0) nonZeroSafe.push(pos);
      }
    }

    if (safe.length === 0) return null;

    const primaryPool = nonZeroSafe.length > 0 ? nonZeroSafe.slice() : safe.slice();
    const secondaryPool = safe.slice();
    shuffleInPlace(primaryPool, rng);
    shuffleInPlace(secondaryPool, rng);

    const maxHints = Math.min(width * height <= 64 ? 6 : 4, safe.length);
    for (let hintCount = 1; hintCount <= maxHints; hintCount += 1) {
      const hitPrimary = tryHintPool(mineLayout, width, height, mineCount, primaryPool, hintCount, rng);
      if (hitPrimary) return hitPrimary;

      if (primaryPool.length !== secondaryPool.length) {
        const hitSecondary = tryHintPool(mineLayout, width, height, mineCount, secondaryPool, hintCount, rng);
        if (hitSecondary) return hitSecondary;
      }
    }

    return null;
  }

  function hasPositiveInitialHint(mineLayout, hints) {
    for (const [x, y] of hints) {
      const c = mineLayout[y][x];
      if (!c.isMine && c.hasClue && c.number > 0) return true;
    }
    return false;
  }

  function buildSolvableBoard(width, height, mineCount, seed, minRequiredMoves = 0) {
    const safeZone = new Set();

    const maxAttempts = 1500;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const candidate = createEmptyBoard(width, height);
      const rng = createRng(`${seed}#${attempt}`);

      if (!placeMines(candidate, width, height, mineCount, safeZone, rng)) {
        break;
      }
      computeNumbers(candidate, width, height);

      const hintRng = createRng(`${seed}#${attempt}#hints`);
      const hints = findMinimalInitialHints(candidate, width, height, mineCount, hintRng);
      if (hints) {
        if (!hasPositiveInitialHint(candidate, hints)) {
          continue;
        }

        const masked = applyMaskableQuestionClues(candidate, width, height, mineCount, hints, minRequiredMoves, createRng(`${seed}#${attempt}#mask`));
        if (!masked.stats.solved || masked.stats.moveCount < minRequiredMoves) {
          continue;
        }
        return {
          cells: cloneMineLayout(candidate, width, height),
          hints,
          solveMoves: masked.stats.moveCount
        };
      }
    }

    throw new Error('この設定では推測不要盤面を見つけられませんでした。サイズか地雷数を調整してください。');
  }

  function openInitialHints(cells, width, height, hints) {
    for (const [sx, sy] of hints) {
      if (!inBounds(sx, sy, width, height)) continue;
      const c = cells[sy][sx];
      if (c.opened || c.flagged || c.isMine) continue;
      c.opened = true;
    }
  }

  function applyMaskableQuestionClues(mineLayout, width, height, mineCount, hints, minRequiredMoves, rng) {
    let currentStats = logicalSolveStats(mineLayout, width, height, mineCount, hints);
    if (!currentStats.solved || currentStats.moveCount < minRequiredMoves) {
      return { stats: currentStats, hiddenCount: 0 };
    }

    const safeCells = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const c = mineLayout[y][x];
        if (!c.isMine) safeCells.push([x, y]);
      }
    }

    shuffleInPlace(safeCells, rng);
    const hintSet = new Set(hints.map(([x, y]) => cellKey(x, y)));
    let hiddenCount = 0;
    const maxTrials = Math.min(safeCells.length, 80);

    for (let i = 0; i < maxTrials; i += 1) {
      const [x, y] = safeCells[i];
      const c = mineLayout[y][x];
      if (hintSet.has(cellKey(x, y))) continue;
      if (!c.hasClue) continue;

      c.hasClue = false;
      const nextStats = logicalSolveStats(mineLayout, width, height, mineCount, hints);
      if (nextStats.solved && nextStats.moveCount >= minRequiredMoves) {
        hiddenCount += 1;
        currentStats = nextStats;
      } else {
        c.hasClue = true;
      }
    }

    return { stats: currentStats, hiddenCount };
  }

  function setMessage(text, cls = '') {
    ui.message.textContent = text;
    ui.message.className = `message ${cls}`.trim();
  }

  function startTimer() {
    stopTimer();
    game.startTime = Date.now();
    game.elapsedSeconds = 0;
    updateTimer();
    game.timerId = setInterval(updateTimer, 1000);
  }

  function stopTimer() {
    if (game.startTime > 0) {
      game.elapsedSeconds = Math.floor((Date.now() - game.startTime) / 1000);
    }
    if (game.timerId) {
      clearInterval(game.timerId);
      game.timerId = null;
    }
    updateTimer();
  }

  function formatTime(totalSeconds) {
    const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const ss = String(totalSeconds % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function updateTimer() {
    if (game.status === 'playing') {
      game.elapsedSeconds = Math.floor((Date.now() - game.startTime) / 1000);
    }
    ui.timerText.textContent = formatTime(game.elapsedSeconds);
  }

  function remainingMinesCount() {
    let flags = 0;
    for (let y = 0; y < game.height; y += 1) {
      for (let x = 0; x < game.width; x += 1) {
        if (game.cells[y][x].flagged) flags += 1;
      }
    }
    return game.mineCount - flags;
  }

  function buildSimFromCurrentGame() {
    return {
      opened: game.cells.map((row) => row.map((c) => c.opened)),
      flagged: game.cells.map((row) => row.map((c) => c.flagged))
    };
  }

  function getCellLogicalCertainty(x, y) {
    const c = game.cells[y][x];
    if (c.opened) return 'opened';
    if (c.flagged) return 'flagged';

    mineCountGlobal = game.mineCount;
    const sim = buildSimFromCurrentGame();
    const k = cellKey(x, y);

    const couldBeMine = satCheck(sim, game.cells, game.width, game.height, new Map([[k, 1]]));
    const couldBeSafe = satCheck(sim, game.cells, game.width, game.height, new Map([[k, 0]]));

    if (!couldBeMine && !couldBeSafe) return 'contradiction';
    if (couldBeMine && couldBeSafe) return 'unknown';
    return couldBeMine ? 'mine' : 'safe';
  }

  function recountOpened() {
    let opened = 0;
    for (let y = 0; y < game.height; y += 1) {
      for (let x = 0; x < game.width; x += 1) {
        if (game.cells[y][x].opened) opened += 1;
      }
    }
    game.openedCount = opened;
  }

  function openCell(x, y) {
    const c = game.cells[y][x];
    if (c.opened || c.flagged) return;

    c.opened = true;
    game.openedCount += 1;
    if (c.isMine) {
      lose('地雷を開いたためゲームオーバーです。', { x, y });
      return;
    }

    checkWin();
  }

  function chordOpen(x, y) {
    const c = game.cells[y][x];
    if (!c.opened) return;
    if (!c.hasClue) return;

    if (c.number === 0) {
      for (const [nx, ny] of neighborsOf(x, y, game.width, game.height)) {
        if (game.status !== 'playing') return;
        openCell(nx, ny);
      }
      return;
    }

    if (c.number < 0) return;

    const around = neighborsOf(x, y, game.width, game.height);
    let flags = 0;
    const unknown = [];
    for (const [nx, ny] of around) {
      const n = game.cells[ny][nx];
      if (n.flagged) flags += 1;
      else if (!n.opened) unknown.push([nx, ny]);
    }

    if (flags === c.number) {
      for (const [nx, ny] of unknown) {
        if (game.status !== 'playing') return;
        openCell(nx, ny);
      }
      return;
    }

    if (flags + unknown.length === c.number) {
      for (const [nx, ny] of unknown) {
        if (game.status !== 'playing') return;
        const target = game.cells[ny][nx];
        if (!target.opened && !target.flagged) target.flagged = true;
      }
      checkWin();
    }
  }

  function lose(message, failedCell = null) {
    game.status = 'lost';
    game.failedCell = failedCell;
    stopTimer();
    setMessage(message, 'lose');
    render();
  }

  function checkWin() {
    if (game.status !== 'playing') return;
    const safeCells = game.width * game.height - game.mineCount;
    if (game.openedCount >= safeCells) {
      game.status = 'won';
      stopTimer();
      setMessage('');
      render();
    }
  }

  function clearHover() {
    game.hoverSet.clear();
  }

  function setHover(x, y, active) {
    if (!active) {
      clearHover();
      render();
      return;
    }

    const hs = new Set();
    hs.add(cellKey(x, y));
    for (const [nx, ny] of neighborsOf(x, y, game.width, game.height)) {
      hs.add(cellKey(nx, ny));
    }
    game.hoverSet = hs;
    render();
  }

  function render() {
    ui.board.style.gridTemplateColumns = `repeat(${game.width}, 34px)`;

    if (ui.board.childElementCount !== game.width * game.height) {
      ui.board.innerHTML = '';
      for (let y = 0; y < game.height; y += 1) {
        for (let x = 0; x < game.width; x += 1) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'cell';
          b.dataset.x = String(x);
          b.dataset.y = String(y);

          b.addEventListener('click', () => {
            if (game.status !== 'playing') return;
            const c = game.cells[y][x];
            if (c.flagged) return;
            if (c.opened) {
              chordOpen(x, y);
            } else {
              const certainty = getCellLogicalCertainty(x, y);
              if (certainty === 'mine') {
                lose('旗を立てるべきマスを開こうとしたためゲームオーバーです。', { x, y });
                return;
              }
              if (certainty !== 'safe') {
                lose('確定していないマスを開こうとしたためゲームオーバーです。', { x, y });
                return;
              }
              openCell(x, y);
            }
            render();
          });

          b.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
            if (game.status !== 'playing') return;

            const c = game.cells[y][x];
            if (c.opened) return;

            if (!c.flagged) {
              const certainty = getCellLogicalCertainty(x, y);
              if (certainty === 'safe') {
                lose('開けるべきマスに旗を立てようとしたためゲームオーバーです。', { x, y });
                return;
              }
              if (certainty !== 'mine') {
                lose('確定していないマスに旗を立てようとしたためゲームオーバーです。', { x, y });
                return;
              }
              c.flagged = true;
            } else {
              c.flagged = false;
            }

            checkWin();
            render();
          });

          b.addEventListener('mouseenter', () => setHover(x, y, true));
          b.addEventListener('mouseleave', () => setHover(x, y, false));

          ui.board.appendChild(b);
        }
      }
    }

    const buttons = ui.board.children;
    let i = 0;
    for (let y = 0; y < game.height; y += 1) {
      for (let x = 0; x < game.width; x += 1) {
        const c = game.cells[y][x];
        const b = buttons[i];
        i += 1;

        b.className = 'cell';
        b.textContent = '';

        const hovered = game.hoverSet.has(cellKey(x, y));
        if (hovered) b.classList.add('hover-neighbor');

        if (c.opened) {
          b.classList.add('open');
          if (c.isMine) {
            b.classList.add('mine');
            b.textContent = '💣';
          } else if (!c.hasClue) {
            b.textContent = '?';
            b.classList.add('question-clue');
          } else if (c.number > 0) {
            b.textContent = String(c.number);
            b.classList.add(`n${c.number}`);
          } else {
            b.textContent = '0';
          }

          if (!c.isMine && c.hasClue) {
            let allDetermined = true;
            for (const [nx, ny] of neighborsOf(x, y, game.width, game.height)) {
              const around = game.cells[ny][nx];
              if (!around.opened && !around.flagged) {
                allDetermined = false;
                break;
              }
            }
            if (allDetermined) {
              b.classList.add('resolved-number');
            }
          }
        } else if (c.flagged) {
          b.classList.add('flagged');
          b.textContent = '🚩';
        }

        if (game.failedCell && game.failedCell.x === x && game.failedCell.y === y) {
          b.classList.add('failed-cell');
          b.textContent = '!';
        }
      }
    }

    const remaining = remainingMinesCount();
    ui.remainingMines.textContent = `${remaining}/${game.mineCount}`;
    ui.remainingMines.classList.toggle('all-found', remaining === 0);
    ui.timerText.classList.toggle('all-found', game.status === 'won');
    updateTimer();
  }

  function parseConfigFromUrl() {
    const p = new URLSearchParams(location.search);
    const side = Number(p.get('s')) || 5;
    const minesParam = p.get('m');
    const mines = minesParam === null ? null : Number(minesParam);
    const seed = sanitizeNumericSeed(p.get('seed') || '');
    return { width: side, height: side, mines, seed };
  }

  function writeUrl() {
    const p = new URLSearchParams();
    p.set('seed', game.seed);
    p.set('s', String(game.width));
    p.set('m', String(game.mineCount));
    history.replaceState({}, '', `?${p.toString()}`);
  }

  function clampConfig(width, height, mines) {
    const sideSource = Number.isFinite(width) ? width : height;
    const side = Math.max(5, Math.min(20, Math.floor(sideSource || 5)));
    const maxMines = side * side - 1;
    const fallbackMines = Math.max(6, Math.floor(side * side * 0.28));
    const sourceMines = Number.isFinite(mines) ? mines : fallbackMines;
    const m = Math.max(6, Math.min(maxMines, Math.floor(sourceMines)));
    return { width: side, height: side, mines: m };
  }

  function startNewGame(options = {}) {
    const rawSide = options.size ?? options.width ?? options.height ?? Number(ui.sizeInput.value);
    const inputSeed = sanitizeNumericSeed(options.seed ?? ui.seedInput.value.trim());
    const seed = inputSeed || randomSeed();
    try {

      const sideCfg = clampConfig(rawSide, rawSide, null);
      let cfg = null;
      let generated = null;

      if (Number.isFinite(options.mines)) {
        cfg = clampConfig(sideCfg.width, sideCfg.height, Number(options.mines));
        generated = buildSolvableBoard(cfg.width, cfg.height, cfg.mines, seed, 4);
      } else {
        const triedMineCounts = new Set();
        const maxMineTrials = 40;
        for (let mt = 0; mt < maxMineTrials; mt += 1) {
          const randomMines = randomMineCount(sideCfg.width, seed, mt);
          if (triedMineCounts.has(randomMines)) continue;
          triedMineCounts.add(randomMines);

          const candidateCfg = clampConfig(sideCfg.width, sideCfg.height, randomMines);
          try {
            const candidateBoard = buildSolvableBoard(candidateCfg.width, candidateCfg.height, candidateCfg.mines, seed, 4);
            cfg = candidateCfg;
            generated = candidateBoard;
            break;
          } catch {
            // try next mine count
          }
        }

        if (!generated || !cfg) {
          throw new Error('4手以上必要な盤面を見つけられませんでした。再生成してください。');
        }
      }

      ui.sizeInput.value = String(cfg.width);
      ui.seedInput.value = seed;

      game.width = cfg.width;
      game.height = cfg.height;
      game.mineCount = cfg.mines;
      game.seed = seed;
      game.failedCell = null;

      openInitialHints(generated.cells, cfg.width, cfg.height, generated.hints);
      game.cells = generated.cells;
      recountOpened();
      game.status = 'playing';
      clearHover();
      setMessage('');
      ui.timerText.textContent = '00:00';
      startTimer();
      writeUrl();
      render();
    } catch (err) {
      game.status = 'ready';
      stopTimer();
      setMessage(String(err.message || err), 'lose');
      ui.board.innerHTML = '';
      ui.remainingMines.textContent = '-/-';
      ui.remainingMines.classList.remove('all-found');
      ui.timerText.classList.remove('all-found');
    }
  }

  ui.newGameBtn.addEventListener('click', () => startNewGame());

  ui.sizeInput.addEventListener('input', () => {
    const side = Math.max(5, Math.min(20, Number(ui.sizeInput.value) || 5));
    ui.sizeInput.value = String(side);
  });

  ui.seedInput.addEventListener('input', () => {
    ui.seedInput.value = sanitizeNumericSeed(ui.seedInput.value);
  });

  ui.copyUrlBtn.addEventListener('click', async () => {
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      setMessage('共有URLをコピーしました。');
    } catch {
      setMessage('URLコピーに失敗しました。手動でコピーしてください。', 'lose');
    }
  });

  const initial = parseConfigFromUrl();
  startNewGame(initial);
})();
