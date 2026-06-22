import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 4173);
const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PUBLIC_DIR = join(ROOT, "public");
const SQUADS_PATH = join(ROOT, "data", "squads-2026.json");
const RESULTS_PATH = join(ROOT, "data", "signal-room-results-2026.json");
const REZA_REPO_DIR = join(ROOT, "data", "worldcup-source");
const REZA_RAW_BASE = "https://raw.githubusercontent.com/rezarahiminia/worldcup2026/main";
const STATSBOMB_BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data";
const WORLDCUP26_BASE = "https://worldcup26.ir/get";
const OPENFOOTBALL_2026 = "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world";
const BALLDONTLIE_BASE = "https://api.balldontlie.io/fifa/worldcup/v1";
const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";
const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY || "";
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || "";

const cache = new Map();
const inFlight = new Map();
const CACHE_MS = 1000 * 60 * 10;
let lastRefreshToken = "";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8"
};

function jsonResponse(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(body));
}

function badRequest(res, message) {
  jsonResponse(res, 400, { error: message });
}

function ballDontLieHeaders() {
  return {
    Authorization: `Bearer ${BALLDONTLIE_API_KEY}`
  };
}

function apiFootballHeaders() {
  return {
    "x-apisports-key": API_FOOTBALL_KEY
  };
}

function refreshCacheForToken(token) {
  if (!token || token === lastRefreshToken) return;
  cache.clear();
  lastRefreshToken = token;
}

function normalizeDateKey(value) {
  const key = String(value || todayDateKey()).replaceAll("-", "");
  return /^\d{8}$/.test(key) ? key : todayDateKey();
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function onceInFlight(key, factory) {
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = factory().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

async function fetchJson(url, options = {}) {
  const key = url;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < (options.ttl ?? CACHE_MS)) {
    return { ...cached.value, cached: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
  const response = await fetch(url, {
    signal: controller.signal,
    headers: {
      "accept": "application/json,text/plain,*/*",
      "user-agent": "WorldCupMomentumDashboard/1.0"
    }
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const error = new Error(`Fetch failed ${response.status}`);
    error.status = response.status;
    error.detail = text.slice(0, 240);
    throw error;
  }

  const value = {
    url,
    status: response.status,
    fetchedAt: new Date().toISOString(),
    data: await response.json()
  };
  cache.set(key, { at: Date.now(), value });
  return { ...value, cached: false };
}

async function fetchJsonWithHeaders(url, headers, options = {}) {
  const key = `${url}:${JSON.stringify(Object.keys(headers).sort())}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < (options.ttl ?? CACHE_MS)) {
    return { ...cached.value, cached: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
  const response = await fetch(url, {
    signal: controller.signal,
    headers: {
      "accept": "application/json,text/plain,*/*",
      "user-agent": "WorldCupMomentumDashboard/1.0",
      ...headers
    }
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const error = new Error(`Fetch failed ${response.status}`);
    error.status = response.status;
    error.detail = text.slice(0, 240);
    throw error;
  }

  const value = {
    url,
    status: response.status,
    fetchedAt: new Date().toISOString(),
    data: await response.json()
  };
  cache.set(key, { at: Date.now(), value });
  return { ...value, cached: false };
}

async function fetchText(url, options = {}) {
  const key = `text:${url}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < (options.ttl ?? CACHE_MS)) {
    return { ...cached.value, cached: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
  const response = await fetch(url, {
    signal: controller.signal,
    headers: { "user-agent": "WorldCupMomentumDashboard/1.0" }
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    const error = new Error(`Fetch failed ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const value = {
    url,
    status: response.status,
    fetchedAt: new Date().toISOString(),
    text: await response.text()
  };
  cache.set(key, { at: Date.now(), value });
  return { ...value, cached: false };
}

function requireNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be numeric`);
  }
  return parsed;
}

function compact(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripMarks(value) {
  return compact(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function teamKey(value) {
  const cleaned = stripMarks(value)
    .replace(/&/g, "and")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(the|national|football|team)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const aliases = {
    "ivory coast": "cote divoire",
    "cote d ivoire": "cote divoire",
    "cote divoire": "cote divoire",
    "curacao": "curacao",
    "cura ao": "curacao",
    "usa": "usa",
    "united states": "usa",
    "united states of america": "usa",
    "south korea": "korea republic",
    "korea republic": "korea republic",
    "czech republic": "czechia",
    "ir iran": "iran",
    "iran": "iran",
    "cape verde": "cabo verde",
    "cabo verde": "cabo verde",
    "turkey": "turkiye",
    "turkiye": "turkiye",
    "tuerkiye": "turkiye"
  };

  return aliases[cleaned] || cleaned;
}

function nextDateKey(dateKey) {
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(4, 6)) - 1;
  const day = Number(dateKey.slice(6, 8));
  const date = new Date(Date.UTC(year, month, day + 1));
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function previousDateKey(dateKey) {
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(4, 6)) - 1;
  const day = Number(dateKey.slice(6, 8));
  const date = new Date(Date.UTC(year, month, day - 1));
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function dateKeyRange(startKey, endKey) {
  const keys = [];
  let current = startKey;
  let guard = 0;
  while (current <= endKey && guard < 80) {
    keys.push(current);
    current = nextDateKey(current);
    guard += 1;
  }
  return keys;
}

function dashedDate(dateKey) {
  return `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;
}

function dashedFromRepoLocalDate(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : "";
}

function americanToProbability(value) {
  const odds = Number(value);
  if (!Number.isFinite(odds) || odds === 0) return null;
  return odds < 0 ? Math.abs(odds) / (Math.abs(odds) + 100) : 100 / (odds + 100);
}

function normalizeProbabilities(odds) {
  if (!odds) return null;
  const home = americanToProbability(odds.homeTeamOdds?.moneyLine);
  const away = americanToProbability(odds.awayTeamOdds?.moneyLine);
  const draw = americanToProbability(odds.drawOdds?.moneyLine);
  const total = [home, away, draw].filter(Boolean).reduce((sum, value) => sum + value, 0);
  if (!total) return null;
  return {
    home: Number(((home || 0) / total * 100).toFixed(1)),
    draw: Number(((draw || 0) / total * 100).toFixed(1)),
    away: Number(((away || 0) / total * 100).toFixed(1))
  };
}

const GMT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DISPLAY_TIME_OFFSET_MINUTES = 120;
const DISPLAY_TIME_LABEL = "GMT+2";

function todayDateKey() {
  return applyDisplayTimeOffset(new Date()).toISOString().slice(0, 10).replaceAll("-", "");
}

function applyDisplayTimeOffset(date) {
  return new Date(date.getTime() + DISPLAY_TIME_OFFSET_MINUTES * 60 * 1000);
}

function gmtLabel(date) {
  const displayTime = applyDisplayTimeOffset(date);
  const day = String(displayTime.getUTCDate()).padStart(2, "0");
  const hour = String(displayTime.getUTCHours()).padStart(2, "0");
  const minute = String(displayTime.getUTCMinutes()).padStart(2, "0");
  return `${day} ${GMT_MONTHS[displayTime.getUTCMonth()]}, ${hour}:${minute} ${DISPLAY_TIME_LABEL}`;
}

function gmtFromIso(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const displayTime = applyDisplayTimeOffset(date);
  return {
    iso: date.toISOString(),
    time: displayTime.toISOString().slice(11, 16),
    label: gmtLabel(date),
    displayTimeZone: DISPLAY_TIME_LABEL
  };
}

function gmtFromOpenFootball(date, time) {
  const match = compact(time).match(/^(\d{1,2}):(\d{2})\s+UTC([+-]\d{1,2})$/);
  if (!date || !match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const offset = Number(match[3]);
  const utc = new Date(`${date}T00:00:00.000Z`);
  utc.setUTCHours(hour - offset, minute, 0, 0);
  return gmtFromIso(utc.toISOString());
}

function stadiumTimeZone(stadium = {}) {
  const city = String(stadium.city_en || "");
  if (city.includes("Mexico City") || city.includes("Guadalajara")) return "America/Mexico_City";
  if (city.includes("Monterrey")) return "America/Monterrey";
  if (city.includes("Dallas") || city.includes("Houston") || city.includes("Kansas City")) return "America/Chicago";
  if (city.includes("Los Angeles") || city.includes("Seattle") || city.includes("San Francisco")) return "America/Los_Angeles";
  if (city.includes("Vancouver")) return "America/Vancouver";
  if (city.includes("Toronto")) return "America/Toronto";
  if (city.includes("Atlanta") || city.includes("Miami") || city.includes("Boston") || city.includes("Philadelphia") || city.includes("New York")) {
    return "America/New_York";
  }
  return "";
}

function timeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const hour = Number(values.hour) % 24;
  const asUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), hour, Number(values.minute), Number(values.second));
  return asUtc - date.getTime();
}

function gmtFromRepoLocalDate(value, stadium) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  const timeZone = stadiumTimeZone(stadium);
  if (!match || !timeZone) return null;
  const [, month, day, year, hour, minute] = match;
  const localAsUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), 0);
  const firstPass = new Date(localAsUtc - timeZoneOffsetMs(new Date(localAsUtc), timeZone));
  const secondPass = new Date(localAsUtc - timeZoneOffsetMs(firstPass, timeZone));
  return gmtFromIso(secondPass.toISOString());
}

function teamStatNumber(stats, keys) {
  const wanted = new Set(keys);
  const item = (stats || []).find((stat) => wanted.has(stat.name) || wanted.has(stat.label));
  if (!item) return 0;
  const raw = String(item.displayValue ?? item.value ?? "0").replace(/[^\d.-]/g, "");
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function squadPower(profile) {
  if (!profile) return 50;
  const caps = Number(profile.averageCaps || 0);
  const goals = Number(profile.totalGoals || 0);
  const topScorerGoals = Number(profile.topScorers?.[0]?.goals || 0);
  const height = Number(profile.averageHeight || 0);
  return caps * 0.9 + goals * 0.11 + topScorerGoals * 0.55 + (height - 180) * 0.7;
}

function liveTeamPower(team) {
  const stats = team?.stats || [];
  const goals = teamStatNumber(stats, ["totalGoals", "Total Goals"]);
  const conceded = teamStatNumber(stats, ["goalsConceded", "Goals Against"]);
  const assists = teamStatNumber(stats, ["goalAssists", "Assists"]);
  const goalDifference = teamStatNumber(stats, ["goalDifference", "Goal Difference"]);
  return goals * 5 + assists * 2.5 + goalDifference * 4 - conceded * 2.5;
}

function modelFromStrength(homeStrength, awayStrength, overUnder) {
  const gap = clamp(homeStrength - awayStrength, -80, 80);
  const draw = clamp(25 - Math.abs(gap) * 0.13 + (Number(overUnder || 2.5) < 2.5 ? 2 : 0), 14, 31);
  const nonDraw = 100 - draw;
  const homeShare = 1 / (1 + Math.exp(-gap / 20));
  const home = nonDraw * homeShare;
  const away = nonDraw - home;
  return { home, draw, away };
}

function blendProbabilities(market, model, marketWeight = 0.62) {
  const weight = market ? marketWeight : 0;
  const blended = {
    home: (market?.home || 0) * weight + model.home * (1 - weight),
    draw: (market?.draw || 0) * weight + model.draw * (1 - weight),
    away: (market?.away || 0) * weight + model.away * (1 - weight)
  };
  const total = blended.home + blended.draw + blended.away || 1;
  return {
    home: Number((blended.home / total * 100).toFixed(1)),
    draw: Number((blended.draw / total * 100).toFixed(1)),
    away: Number((blended.away / total * 100).toFixed(1))
  };
}

function weightedProbabilities(parts) {
  const active = parts.filter((part) => part.probabilities && part.weight > 0);
  const totalWeight = active.reduce((sum, part) => sum + part.weight, 0) || 1;
  const blended = active.reduce((acc, part) => {
    acc.home += Number(part.probabilities.home || 0) * part.weight;
    acc.draw += Number(part.probabilities.draw || 0) * part.weight;
    acc.away += Number(part.probabilities.away || 0) * part.weight;
    return acc;
  }, { home: 0, draw: 0, away: 0 });
  const total = (blended.home + blended.draw + blended.away) / totalWeight || 1;
  return {
    home: Number(((blended.home / totalWeight) / total * 100).toFixed(1)),
    draw: Number(((blended.draw / totalWeight) / total * 100).toFixed(1)),
    away: Number(((blended.away / totalWeight) / total * 100).toFixed(1))
  };
}

function predictionWeights(hasMarket, hasExpert) {
  if (hasMarket && hasExpert) {
    return { market: 0.52, historicalSquad: 0.24, liveTournament: 0.10, expertMedia: 0.14 };
  }
  if (hasMarket) {
    return { market: 0.62, historicalSquad: 0.27, liveTournament: 0.11, expertMedia: 0 };
  }
  if (hasExpert) {
    return { market: 0, historicalSquad: 0.62, liveTournament: 0.22, expertMedia: 0.16 };
  }
  return { market: 0, historicalSquad: 0.72, liveTournament: 0.28, expertMedia: 0 };
}

function scaleExpertWeight(weights, scale) {
  if (!weights.expertMedia) return weights;
  const expertMedia = Number((weights.expertMedia * scale).toFixed(3));
  const released = weights.expertMedia - expertMedia;
  const base = weights.market + weights.historicalSquad + weights.liveTournament || 1;
  return {
    market: Number((weights.market + released * (weights.market / base)).toFixed(3)),
    historicalSquad: Number((weights.historicalSquad + released * (weights.historicalSquad / base)).toFixed(3)),
    liveTournament: Number((weights.liveTournament + released * (weights.liveTournament / base)).toFixed(3)),
    expertMedia
  };
}

function normalizeWeights(weights) {
  const total = Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0) || 1;
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, Number((Number(value || 0) / total).toFixed(3))]));
}

function applyQipWeights(weights, qipState) {
  if (!qipState?.active) return weights;
  const multipliers = qipState.componentMultipliers || {};
  return normalizeWeights({
    market: Number(weights.market || 0) * Number(multipliers.market || 1),
    historicalSquad: Number(weights.historicalSquad || 0) * Number(multipliers.historicalSquad || 1),
    liveTournament: Number(weights.liveTournament || 0) * Number(multipliers.liveTournament || 1),
    expertMedia: Number(weights.expertMedia || 0) * Number(multipliers.expertMedia || 1)
  });
}

function adjustQipProbabilities(probabilities, match, qipState) {
  if (!qipState?.active) return probabilities;
  const teamAdjustments = qipState.teamAdjustments || {};
  const homeFactor = Number(teamAdjustments[teamKey(match.home)]?.factor || 1);
  const awayFactor = Number(teamAdjustments[teamKey(match.away)]?.factor || 1);
  const drawLift = Number(qipState.drawLift || 0);
  const adjusted = {
    home: Number(probabilities.home || 0) * homeFactor,
    draw: Number(probabilities.draw || 0) + drawLift,
    away: Number(probabilities.away || 0) * awayFactor
  };
  const total = adjusted.home + adjusted.draw + adjusted.away || 1;
  return {
    home: Number((adjusted.home / total * 100).toFixed(1)),
    draw: Number((adjusted.draw / total * 100).toFixed(1)),
    away: Number((adjusted.away / total * 100).toFixed(1))
  };
}

function scoreOutcome(homeGoals, awayGoals) {
  if (homeGoals > awayGoals) return "home";
  if (awayGoals > homeGoals) return "away";
  return "draw";
}

function poissonProbability(lambda, goals) {
  const safeLambda = clamp(Number(lambda || 0), 0.05, 6);
  let probability = Math.exp(-safeLambda);
  for (let index = 1; index <= goals; index += 1) {
    probability *= safeLambda / index;
  }
  return probability;
}

function outcomeProbability(probabilities, outcome) {
  return Number(probabilities?.[outcome] || 0) / 100;
}

function favoriteOutcome(probabilities) {
  const home = Number(probabilities?.home || 0);
  const draw = Number(probabilities?.draw || 0);
  const away = Number(probabilities?.away || 0);
  if (home >= away && home >= draw) return "home";
  if (away >= draw) return "away";
  return "draw";
}

function scorelineGenericPenalty(homeGoals, awayGoals, calibration) {
  if (!isGenericScoreline(homeGoals, awayGoals)) return 1;
  return Number(calibration?.genericScorePenalty || 0.88);
}

function isGenericScoreline(homeGoals, awayGoals) {
  return (homeGoals === 2 && awayGoals === 1) || (homeGoals === 1 && awayGoals === 2);
}

function promoteCandidate(candidates, candidate, minimumProbability = 0, calibrationReason = "QIP calibration") {
  if (!candidate) return candidates;
  const [top] = candidates;
  if (!top || candidate === top) return candidates;
  const promoted = {
    ...candidate,
    probability: Math.max(candidate.probability, minimumProbability),
    calibrationReason
  };
  return [
    promoted,
    top,
    ...candidates.filter((item) => item !== top && item !== candidate)
  ];
}

function calibrateScoreRanking(candidates, calibration = {}, probabilities = {}, confidence = 0) {
  let ranked = candidates;
  const [top] = ranked;
  if (top && isGenericScoreline(top.homeGoals, top.awayGoals)) {
    const threshold = Number(calibration.genericSwitchThreshold || 0.76);
    const alternative = ranked.find((candidate) =>
      !isGenericScoreline(candidate.homeGoals, candidate.awayGoals)
      && candidate.probability >= top.probability * threshold
    );
    ranked = promoteCandidate(
      ranked,
      alternative,
      top.probability * 1.001,
      "QIP suppressed overused 2-1/1-2 scoreline"
    );
  }

  return ranked;
}

function rankedScoreCandidates(homeXg, awayXg, probabilities, calibration = {}, confidence = 0) {
  const candidates = [];
  const projectedTotal = homeXg + awayXg;
  const favored = favoriteOutcome(probabilities);
  const drawGap = Number(calibration.drawActualRate || 0) - Number(calibration.drawPredictedRate || 0);
  for (let homeGoals = 0; homeGoals <= 5; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= 5; awayGoals += 1) {
      const outcome = scoreOutcome(homeGoals, awayGoals);
      const total = homeGoals + awayGoals;
      const raw = poissonProbability(homeXg, homeGoals) * poissonProbability(awayXg, awayGoals);
      const outcomeWeight = clamp(0.45 + outcomeProbability(probabilities, outcome) * 2.35, 0.45, 2.25);
      const totalFit = clamp(1.2 - Math.abs(total - projectedTotal) * 0.13, 0.58, 1.2);
      const favoriteFit = confidence >= 24 && outcome !== favored ? 0.78 : 1;
      const genericPenalty = scorelineGenericPenalty(homeGoals, awayGoals, calibration);
      const drawFit = outcome === "draw" && outcomeProbability(probabilities, "draw") < 0.2 ? 0.76 : 1;
      const drawCorrectionFit = outcome === "draw" ? 1 + clamp(drawGap * 1.05, 0, 0.24) : 1;
      const lowGoalFit = total <= 1 && Number(calibration.lowGoalRate || 0) < 0.2 ? 0.82 : 1;
      const highGoalFit = total >= 4 && Number(calibration.highGoalRate || 0) > 0.24 ? 1.08 : 1;
      candidates.push({
        homeGoals,
        awayGoals,
        outcome,
        probability: raw * outcomeWeight * totalFit * favoriteFit * genericPenalty * drawFit * drawCorrectionFit * lowGoalFit * highGoalFit
      });
    }
  }
  const sorted = candidates
    .sort((left, right) => right.probability - left.probability)
    .slice(0, 8);
  return calibrateScoreRanking(sorted, calibration, probabilities, confidence)
    .slice(0, 6)
    .map((candidate) => ({
      ...candidate,
      score: `${candidate.homeGoals}-${candidate.awayGoals}`,
      probability: Number(candidate.probability.toFixed(5))
    }));
}

function scorePrediction(match, probabilities, summary, confidence, context = {}) {
  const calibration = context.qipState?.scoreCalibration || {};
  const homeProfile = context.homeProfile || {};
  const awayProfile = context.awayProfile || {};
  const marketTotal = Number(summary?.odds?.overUnder);
  const calibratedBase = Number(calibration.averageActualTotal || 2.5);
  const baseTotal = Number.isFinite(marketTotal) && marketTotal > 0 ? marketTotal : calibratedBase;
  const homeWin = Number(probabilities.home || 0);
  const awayWin = Number(probabilities.away || 0);
  const draw = Number(probabilities.draw || 0);
  const edge = clamp((homeWin - awayWin) / 100, -0.58, 0.58);
  const confidenceBoost = clamp(Number(confidence || 0) / 100, 0, 0.5);
  const homeGoalDepth = Number(homeProfile.totalGoals || 0) / Math.max(1, Number(homeProfile.players || 26));
  const awayGoalDepth = Number(awayProfile.totalGoals || 0) / Math.max(1, Number(awayProfile.players || 26));
  const scorerDepth = clamp((homeGoalDepth + awayGoalDepth - 6) / 18, -0.22, 0.38);
  const drawDrag = clamp((draw - 26) / 100, -0.14, 0.18) * -0.9;
  const confidenceLift = clamp((confidence - 18) / 100, -0.12, 0.28);
  const totalGoals = clamp(
    baseTotal * Number(calibration.totalGoalMultiplier || 1) + scorerDepth + drawDrag + confidenceLift,
    1.05,
    5.35
  );
  const historicalEdge = clamp((Number(context.homeHistorical || 50) - Number(context.awayHistorical || 50)) / 260, -0.11, 0.11);
  const liveEdge = clamp((Number(context.homeLive || 50) - Number(context.awayLive || 50)) / 320, -0.07, 0.07);
  const shareShift = Number(calibration.homeShareShift || 0);
  const homeShare = clamp(0.5 + edge * 0.42 + historicalEdge + liveEdge + confidenceBoost * Math.sign(edge) * 0.04 + shareShift, 0.18, 0.82);
  const homeXg = totalGoals * homeShare;
  const awayXg = Math.max(0.08, totalGoals - homeXg);
  const candidates = rankedScoreCandidates(homeXg, awayXg, probabilities, calibration, confidence);
  const selected = candidates[0] || {
    homeGoals: clamp(Math.round(homeXg), 0, 5),
    awayGoals: clamp(Math.round(awayXg), 0, 5),
    score: `${clamp(Math.round(homeXg), 0, 5)}-${clamp(Math.round(awayXg), 0, 5)}`,
    probability: 0
  };
  const homeGoals = selected.homeGoals;
  const awayGoals = selected.awayGoals;

  return {
    label: `${match.home} ${homeGoals}-${awayGoals} ${match.away}`,
    shortLabel: `${homeGoals}-${awayGoals}`,
    homeGoals,
    awayGoals,
    expectedGoals: {
      home: Number(homeXg.toFixed(2)),
      away: Number(awayXg.toFixed(2)),
      total: Number((homeXg + awayXg).toFixed(2))
    },
    candidates: candidates.map((candidate) => ({
      score: candidate.score,
      homeGoals: candidate.homeGoals,
      awayGoals: candidate.awayGoals,
      outcome: candidate.outcome,
      signal: candidate.probability,
      calibrationReason: candidate.calibrationReason || null
    })),
    calibration: {
      totalGoalMultiplier: Number(calibration.totalGoalMultiplier || 1),
      genericScorePenalty: Number(calibration.genericScorePenalty || 1),
      homeShareShift: Number(calibration.homeShareShift || 0),
      averageActualTotal: Number(calibration.averageActualTotal || 0)
    },
    basis: "QIP-calibrated scoreline distribution, blended win probability, scoring depth, and tournament goal tempo",
    volatility: confidence >= 28 ? "medium" : "high"
  };
}

function buildPredictionModel(match, homeProfile, awayProfile, summary, expertSignal = null, qipState = null) {
  const homeHistorical = squadPower(homeProfile);
  const awayHistorical = squadPower(awayProfile);
  const homeLive = liveTeamPower(summary?.home);
  const awayLive = liveTeamPower(summary?.away);
  const homeStrength = homeHistorical * 0.72 + homeLive * 0.28;
  const awayStrength = awayHistorical * 0.72 + awayLive * 0.28;
  const model = modelFromStrength(homeStrength, awayStrength, summary?.odds?.overUnder);
  const historicalModel = modelFromStrength(homeHistorical, awayHistorical, summary?.odds?.overUnder);
  const liveModel = modelFromStrength(homeLive, awayLive, summary?.odds?.overUnder);
  const market = summary?.odds?.probabilities || null;
  const hasExpertNotes = Number(expertSignal?.noteCount || 0) >= 3;
  const expert = hasExpertNotes ? expertSignal.probabilities : null;
  const baseWeights = expert && !expertSignal?.usable
    ? scaleExpertWeight(predictionWeights(Boolean(market), true), 0.45)
    : predictionWeights(Boolean(market), Boolean(expert));
  const weights = applyQipWeights(baseWeights, qipState);
  const rawProbabilities = weightedProbabilities([
    { probabilities: market, weight: weights.market },
    { probabilities: historicalModel, weight: weights.historicalSquad },
    { probabilities: liveModel, weight: weights.liveTournament },
    { probabilities: expert, weight: weights.expertMedia }
  ]);
  const probabilities = adjustQipProbabilities(rawProbabilities, match, qipState);
  const favorite =
    probabilities.home >= probabilities.away && probabilities.home >= probabilities.draw
      ? match.home
      : probabilities.away >= probabilities.draw
        ? match.away
        : "Draw";
  const rawConfidence = clamp(Math.max(probabilities.home, probabilities.draw, probabilities.away) - 33.3, 0, 66.7);
  const confidence = clamp(rawConfidence * Number(qipState?.confidenceMultiplier || 1), 0, 66.7);
  const score = scorePrediction(match, probabilities, summary, confidence, {
    homeProfile,
    awayProfile,
    homeHistorical,
    awayHistorical,
    homeLive,
    awayLive,
    qipState
  });
  const edges = [];
  const capsGap = Number(Math.abs((homeProfile?.averageCaps || 0) - (awayProfile?.averageCaps || 0)).toFixed(1));
  if (capsGap >= 5) {
    edges.push(`${(homeProfile?.averageCaps || 0) > (awayProfile?.averageCaps || 0) ? match.home : match.away} hold the historical experience edge by ${capsGap} caps per player.`);
  }
  const goalsGap = Math.abs((homeProfile?.totalGoals || 0) - (awayProfile?.totalGoals || 0));
  if (goalsGap >= 20) {
    edges.push(`${(homeProfile?.totalGoals || 0) > (awayProfile?.totalGoals || 0) ? match.home : match.away} have the deeper international scoring base by ${goalsGap} squad goals.`);
  }
  const liveGap = Number(Math.abs(homeLive - awayLive).toFixed(1));
  if (liveGap >= 4) {
    edges.push(`${homeLive > awayLive ? match.home : match.away} have the stronger live tournament stat signal in ESPN team metrics.`);
  }
  if (summary?.odds?.probabilities) {
    edges.push(`Live market signal from ${summary.odds.provider || "odds feed"} is blended with squad history and tournament stats.`);
  }
  if (expertSignal?.usable) {
    edges.push(`Expert media pulse leans ${expertSignal.leanLabel} from ${expertSignal.noteCount} live notes.`);
  } else if (expertSignal?.noteCount) {
    edges.push(`${expertSignal.noteCount} expert-media notes were pulled; neutral sentiment is treated as a smaller uncertainty input.`);
  }
  return {
    label: expert ? "Signal Room expert-aware model" : "Signal Room blended model",
    favorite,
    confidence: Number(confidence.toFixed(1)),
    probabilities,
    scorePrediction: score,
    components: {
      marketOdds: summary?.odds?.probabilities || null,
      historicalSquad: {
        home: Number(homeHistorical.toFixed(1)),
        away: Number(awayHistorical.toFixed(1)),
        probabilities: {
          home: Number(historicalModel.home.toFixed(1)),
          draw: Number(historicalModel.draw.toFixed(1)),
          away: Number(historicalModel.away.toFixed(1))
        }
      },
      liveTournament: {
        home: Number(homeLive.toFixed(1)),
        away: Number(awayLive.toFixed(1)),
        probabilities: {
          home: Number(liveModel.home.toFixed(1)),
          draw: Number(liveModel.draw.toFixed(1)),
          away: Number(liveModel.away.toFixed(1))
        }
      },
      expertMedia: expertSignal ? {
        usable: expertSignal.usable,
        lean: expertSignal.lean,
        leanLabel: expertSignal.leanLabel,
        confidence: expertSignal.confidence,
        probabilities: expertSignal.probabilities,
        noteCount: expertSignal.noteCount
      } : null,
      weights
    },
    edges,
    qip: qipState?.active ? {
      active: true,
      heartbeat: qipState.heartbeat,
      lessonCount: qipState.lessonCount,
      confidenceMultiplier: qipState.confidenceMultiplier,
      drawLift: qipState.drawLift,
      scoreCalibration: qipState.scoreCalibration,
      rationale: qipState.rationale,
      teamAdjustment: {
        home: qipState.teamAdjustments?.[teamKey(match.home)] || null,
        away: qipState.teamAdjustments?.[teamKey(match.away)] || null
      },
      baseWeights,
      adjustedWeights: weights,
      rawProbabilities
    } : { active: false }
  };
}

function topScorerPool(profile) {
  return (profile?.topScorers || []).slice(0, 5).reduce((sum, player) => sum + Number(player.goals || 0), 0);
}

function matchupEnvironment(homeProfile, awayProfile) {
  const homePower = squadPower(homeProfile);
  const awayPower = squadPower(awayProfile);
  const homeGoalDepth = Number(homeProfile?.totalGoals || 0) / Math.max(1, Number(homeProfile?.players || 26));
  const awayGoalDepth = Number(awayProfile?.totalGoals || 0) / Math.max(1, Number(awayProfile?.players || 26));
  const scorerPool = topScorerPool(homeProfile) + topScorerPool(awayProfile);
  const experience = (Number(homeProfile?.averageCaps || 0) + Number(awayProfile?.averageCaps || 0)) / 2;
  const totalGoals = clamp(
    1.85 + (homeGoalDepth + awayGoalDepth) / 150 + scorerPool / 340 + experience / 170 + Math.abs(homePower - awayPower) / 210,
    1.7,
    4.2
  );
  const homeShare = clamp(
    0.5 + (homePower - awayPower) / 175 + (homeGoalDepth - awayGoalDepth) / 320,
    0.26,
    0.74
  );
  const homeXg = Number((totalGoals * homeShare).toFixed(2));
  const awayXg = Number((totalGoals - homeXg).toFixed(2));

  return {
    totalGoals: Number(totalGoals.toFixed(2)),
    homeXg,
    awayXg,
    homePower: Number(homePower.toFixed(1)),
    awayPower: Number(awayPower.toFixed(1)),
    homeGoalDepth: Number(homeGoalDepth.toFixed(2)),
    awayGoalDepth: Number(awayGoalDepth.toFixed(2)),
    scorerPool
  };
}

function matchupStatsBlock(teamName, teamCode, projectedFor, projectedAgainst, profile) {
  const goalDifference = Number((projectedFor - projectedAgainst).toFixed(2));
  return {
    name: teamName,
    abbreviation: teamCode || teamName.slice(0, 3).toUpperCase(),
    logo: null,
    stats: [
      { name: "totalGoals", label: "Total Goals", value: projectedFor, displayValue: projectedFor.toFixed(2) },
      { name: "goalsConceded", label: "Goals Against", value: projectedAgainst, displayValue: projectedAgainst.toFixed(2) },
      { name: "goalAssists", label: "Assists", value: Number((projectedFor * 0.72).toFixed(2)), displayValue: Number((projectedFor * 0.72).toFixed(2)).toFixed(2) },
      { name: "goalDifference", label: "Goal Difference", value: goalDifference, displayValue: goalDifference.toFixed(2) },
      { name: "averageCaps", label: "Average Caps", value: Number(profile?.averageCaps || 0), displayValue: String(profile?.averageCaps || 0) },
      { name: "squadGoals", label: "Squad Goals", value: Number(profile?.totalGoals || 0), displayValue: String(profile?.totalGoals || 0) }
    ]
  };
}

function buildMatchupSummary(match, homeSquad, awaySquad, homeProfile, awayProfile) {
  const environment = matchupEnvironment(homeProfile, awayProfile);
  return {
    eventId: null,
    date: null,
    status: "Assumption lab",
    venue: "Neutral scenario model",
    broadcasts: ["Model refresh recalculates media and scoring priors"],
    odds: {
      provider: "Signal Room scoring prior",
      overUnder: environment.totalGoals,
      probabilities: null
    },
    home: matchupStatsBlock(match.home, homeSquad?.code, environment.homeXg, environment.awayXg, homeProfile),
    away: matchupStatsBlock(match.away, awaySquad?.code, environment.awayXg, environment.homeXg, awayProfile),
    environment
  };
}

function buildMatchupAssumptions(match, summary, prediction) {
  const environment = summary?.environment || {};
  return [
    {
      label: "Scenario",
      value: "Neutral matchup",
      detail: "This is not an official fixture unless the schedule feed maps the same teams."
    },
    {
      label: "Scoring prior",
      value: `${environment.totalGoals || prediction?.scorePrediction?.expectedGoals?.total || 2.5} expected goals`,
      detail: `${match.home} ${environment.homeXg || 0} xG, ${match.away} ${environment.awayXg || 0} xG before score rounding.`
    },
    {
      label: "Power signal",
      value: `${match.home} ${environment.homePower || 0} vs ${match.away} ${environment.awayPower || 0}`,
      detail: "Squad power blends average caps, total squad goals, top scorer output, and height."
    },
    {
      label: "Confidence growth",
      value: `${prediction?.confidence || 0} pts`,
      detail: "Refresh can move the prediction when public expert notes or updated source data change."
    }
  ];
}

function squadTeamOptions(squads) {
  return [...(squads?.teams || [])]
    .map((team) => ({
      team: team.team,
      code: team.code,
      coach: team.coach?.coachName || ""
    }))
    .sort((a, b) => a.team.localeCompare(b.team));
}

function decodeXml(value) {
  return compact(value)
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function tagValue(item, tag) {
  const match = item.match(new RegExp(`<${tag}(?: [^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? compact(decodeXml(match[1]).replace(/<[^>]*>/g, "")) : "";
}

function parseRssItems(xml, limit = 8) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .slice(0, limit)
    .map((match) => ({
      title: tagValue(match[1], "title"),
      description: tagValue(match[1], "description"),
      link: tagValue(match[1], "link"),
      source: tagValue(match[1], "source") || "Google News",
      publishedAt: tagValue(match[1], "pubDate")
    }))
    .filter((item) => item.title && item.link);
}

async function fetchGoogleNews(query, limit = 6) {
  const rss = await fetchText(
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
    { ttl: 1000 * 60 * 12, timeoutMs: 3000 }
  );
  return parseRssItems(rss.text, limit);
}

function articleText(item) {
  return stripMarks(`${item.title || item.headline || ""} ${item.description || ""}`);
}

function teamNeedles(team) {
  return [...new Set([stripMarks(team), teamKey(team)])].filter((needle) => needle.length >= 3);
}

function hasTeam(text, team) {
  return teamNeedles(team).some((needle) => text.includes(needle));
}

function sourceWeight(source) {
  const key = stripMarks(source);
  if (/espn|bbc|the athletic|guardian|reuters|associated press|ap news|sky sports|cbssports|cbs sports|fox sports|nbc sports|sporting news|goal|fourfourtwo|sports illustrated/.test(key)) return 1.25;
  return 1;
}

function teamDirectionalScore(text, team, opponent) {
  const teamText = stripMarks(team);
  const opponentText = stripMarks(opponent);
  const teamKeyText = teamKey(team);
  const opponentKeyText = teamKey(opponent);
  const teamPatterns = [teamText, teamKeyText].filter(Boolean);
  const opponentPatterns = [opponentText, opponentKeyText].filter(Boolean);
  let score = 0;

  for (const currentTeam of teamPatterns) {
    for (const currentOpponent of opponentPatterns) {
      if (text.includes(`${currentTeam} over ${currentOpponent}`)) score += 2.5;
      if (text.includes(`${currentTeam} to beat ${currentOpponent}`)) score += 2.5;
      if (text.includes(`${currentTeam} vs ${currentOpponent} pick`)) score += 0.7;
      if (text.includes(`${currentTeam} ${currentOpponent} prediction`)) score += 0.5;
    }
    if (text.includes(`${currentTeam} to win`)) score += 2.4;
    if (text.includes(`${currentTeam} win`)) score += 1.4;
    if (text.includes(`${currentTeam} favored`) || text.includes(`${currentTeam} favourite`) || text.includes(`${currentTeam} favorite`)) score += 1.8;
    if (text.includes(`back ${currentTeam}`) || text.includes(`lean ${currentTeam}`) || text.includes(`pick ${currentTeam}`)) score += 1.8;
    if (text.includes(`${currentTeam} edge`) || text.includes(`${currentTeam} advantage`)) score += 1.2;
    if (text.includes(`${currentTeam} upset`)) score += 1.2;
  }

  return score;
}

function classifyExpertItem(item, match) {
  const text = articleText(item);
  const mentionsHome = hasTeam(text, match.home);
  const mentionsAway = hasTeam(text, match.away);
  const predictionContext = /prediction|predict|pick|odds|betting|best bet|preview|forecast|expert|analysis|team news|lineup|injury|sentiment/.test(text);
  const weight = sourceWeight(item.source);
  let homeScore = teamDirectionalScore(text, match.home, match.away) * weight;
  let awayScore = teamDirectionalScore(text, match.away, match.home) * weight;

  if (predictionContext && mentionsHome && !mentionsAway) homeScore += 0.65 * weight;
  if (predictionContext && mentionsAway && !mentionsHome) awayScore += 0.65 * weight;
  if (!predictionContext && !(homeScore || awayScore)) {
    return { ...item, mentionsHome, mentionsAway, isPrediction: false, lean: "neutral", score: 0, note: "General media note" };
  }

  const diff = homeScore - awayScore;
  const lean = Math.abs(diff) < 0.75 ? "neutral" : diff > 0 ? "home" : "away";
  return {
    ...item,
    mentionsHome,
    mentionsAway,
    isPrediction: predictionContext,
    lean,
    score: Number(Math.abs(diff).toFixed(2)),
    note: predictionContext ? "Prediction, odds, or team-news context" : "Directional mention"
  };
}

function dedupeMediaItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = stripMarks(`${item.title || item.headline || ""}:${item.source || ""}`).slice(0, 180);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildExpertSignal(match, items = []) {
  const notes = dedupeMediaItems(items)
    .map((item) => classifyExpertItem({
      title: item.title || item.headline,
      description: item.description || "",
      source: item.source || "Media",
      link: item.link,
      publishedAt: item.publishedAt
    }, match))
    .filter((item) => item.mentionsHome || item.mentionsAway)
    .filter((item) => item.title)
    .slice(0, 12);

  const totals = notes.reduce((acc, item) => {
    if (item.lean === "home") acc.home += item.score || 0.8;
    if (item.lean === "away") acc.away += item.score || 0.8;
    if (item.lean === "neutral") acc.neutral += 1;
    return acc;
  }, { home: 0, away: 0, neutral: 0 });
  const directionalTotal = totals.home + totals.away;
  const diff = directionalTotal ? (totals.home - totals.away) / directionalTotal : 0;
  const draw = clamp(24 - Math.abs(diff) * 4 + Math.min(3, totals.neutral * 0.25), 18, 28);
  const homeShare = clamp(0.5 + diff * 0.36, 0.18, 0.82);
  const usable = directionalTotal >= 1.25 && Math.abs(diff) >= 0.18;
  const probabilities = {
    home: Number(((100 - draw) * homeShare).toFixed(1)),
    draw: Number(draw.toFixed(1)),
    away: Number(((100 - draw) * (1 - homeShare)).toFixed(1))
  };
  const lean = usable ? (diff > 0 ? "home" : "away") : "neutral";

  return {
    label: "Live expert media sentiment",
    usable,
    lean,
    leanLabel: lean === "home" ? match.home : lean === "away" ? match.away : "No clear lean",
    confidence: Number(clamp(Math.abs(diff) * 100, 0, 100).toFixed(1)),
    probabilities,
    noteCount: notes.length,
    directionalNotes: Number(directionalTotal.toFixed(1)),
    sourceCount: new Set(notes.map((item) => item.source)).size,
    notes
  };
}

async function fetchExpertMedia(match, summary, limit = 10) {
  const espnItems = (summary?.news || []).map((item) => ({
    title: item.headline || item.title,
    description: item.description || "",
    source: item.source || "ESPN",
    link: item.link,
    publishedAt: item.publishedAt
  }));
  const queries = [
    `${match.home} ${match.away} World Cup 2026 expert prediction preview odds`,
    `${match.home} ${match.away} World Cup 2026 team news predicted lineups`
  ];
  const pulled = await Promise.all(
    queries.map((query) => fetchGoogleNews(query, Math.ceil(limit / 2)).catch(() => []))
  );
  return buildExpertSignal(match, [...espnItems, ...pulled.flat()].slice(0, limit + espnItems.length));
}

async function getSquads() {
  const key = "local:squads-2026";
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const data = JSON.parse(await readFile(SQUADS_PATH, "utf8"));
  cache.set(key, { at: Date.now(), value: data });
  return data;
}

async function readJsonFile(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function getResultArchive() {
  const key = "local:signal-room-results-2026";
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const results = await readJsonFile(RESULTS_PATH).catch(() => []);
  cache.set(key, { at: Date.now(), value: results });
  return results;
}

function archivedResultForGame(game, results = []) {
  const matchId = String(game?.id || game?.match_id || "");
  const direct = results.find((result) => String(result.match_id || "") === matchId);
  if (direct) return direct;
  const home = teamKey(game?.home_team_name_en || game?.home);
  const away = teamKey(game?.away_team_name_en || game?.away);
  return results.find((result) => {
    const resultHome = teamKey(result.home);
    const resultAway = teamKey(result.away);
    return resultHome === home && resultAway === away;
  }) || null;
}

async function readWorldcupSourceFile(filename) {
  try {
    const result = await fetchJson(`${REZA_RAW_BASE}/${filename}`, { ttl: CACHE_MS, timeoutMs: 2500 });
    return result.data;
  } catch {
    return readJsonFile(join(REZA_REPO_DIR, filename));
  }
}

async function getWorldcupRepoData() {
  const key = "local:rezarahiminia-worldcup2026";
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const [matches, teams, stadiums, groups, openFootball, resultArchive] = await Promise.all([
    readWorldcupSourceFile("football.matches.json"),
    readWorldcupSourceFile("football.teams.json"),
    readWorldcupSourceFile("football.stadiums.json"),
    readWorldcupSourceFile("football.matchtables.json"),
    fetchJson(OPENFOOTBALL_2026, { ttl: CACHE_MS, timeoutMs: 2500 }).catch(() => ({ data: { matches: [] } })),
    getResultArchive()
  ]);

  const teamsById = Object.fromEntries(teams.map((team) => [String(team.id), team]));
  const stadiumsById = Object.fromEntries(stadiums.map((stadium) => [String(stadium.id), stadium]));
  const enrichedMatches = matches.map((match) => {
    const homeTeam = teamsById[String(match.home_team_id)];
    const awayTeam = teamsById[String(match.away_team_id)];
    const stadium = stadiumsById[String(match.stadium_id)];
    const repoDate = dashedFromRepoLocalDate(match.local_date);
    const openFootballMatch = (openFootball.data.matches || []).find((item) =>
      item.date === repoDate &&
      teamKey(item.team1) === teamKey(homeTeam?.name_en) &&
      teamKey(item.team2) === teamKey(awayTeam?.name_en)
    );
    const gmt = openFootballMatch
      ? gmtFromOpenFootball(openFootballMatch.date, openFootballMatch.time)
      : gmtFromRepoLocalDate(match.local_date, stadium);
    const result = archivedResultForGame({
      ...match,
      home_team_name_en: homeTeam?.name_en,
      away_team_name_en: awayTeam?.name_en
    }, resultArchive);
    return {
      ...match,
      home_team_name_en: homeTeam?.name_en,
      away_team_name_en: awayTeam?.name_en,
      home_score: result ? String(result.home_score) : match.home_score,
      away_score: result ? String(result.away_score) : match.away_score,
      finished: result ? "TRUE" : match.finished,
      time_elapsed: result ? "final" : match.time_elapsed,
      result_status: result?.status || "",
      result_source: result?.source || "",
      home_team_code: homeTeam?.fifa_code,
      away_team_code: awayTeam?.fifa_code,
      home_flag: homeTeam?.flag,
      away_flag: awayTeam?.flag,
      stadium_name: stadium?.fifa_name || stadium?.name_en,
      city_en: stadium?.city_en,
      country_en: stadium?.country_en,
      gmt,
      gmtTime: gmt?.time || "",
      openFootballTime: openFootballMatch?.time || ""
    };
  });

  const payload = {
    repo: "rezarahiminia/worldcup2026",
    commit: "a2908f1acfc74ce54a23ff188be909695550ea20",
    resultArchive: {
      source: "Signal Room momentum plot archive",
      matches: resultArchive.length
    },
    games: enrichedMatches,
    teams,
    groups,
    stadiums
  };
  cache.set(key, { at: Date.now(), value: payload });
  return payload;
}

function findSquad(squads, name) {
  const key = teamKey(name);
  return squads.teams.find((team) => teamKey(team.team) === key || teamKey(team.code) === key) || null;
}

function topPlayers(squad, count = 6) {
  if (!squad?.players?.length) return [];
  return [...squad.players]
    .sort((a, b) => (b.goals * 8 + b.caps + b.heightCm / 20) - (a.goals * 8 + a.caps + a.heightCm / 20))
    .slice(0, count);
}

function squadStats(squad) {
  const players = squad?.players || [];
  const totalCaps = players.reduce((sum, player) => sum + player.caps, 0);
  const totalGoals = players.reduce((sum, player) => sum + player.goals, 0);
  const averageHeight = players.length
    ? players.reduce((sum, player) => sum + player.heightCm, 0) / players.length
    : 0;
  const positions = players.reduce((acc, player) => {
    acc[player.position] = (acc[player.position] || 0) + 1;
    return acc;
  }, {});
  const clubs = players.reduce((acc, player) => {
    const country = player.club.match(/\(([A-Z]{3})\)$/)?.[1] || "UNK";
    acc[country] = (acc[country] || 0) + 1;
    return acc;
  }, {});
  const clubSpread = Object.entries(clubs)
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count);

  return {
    players: players.length,
    totalCaps,
    totalGoals,
    averageCaps: players.length ? Number((totalCaps / players.length).toFixed(1)) : 0,
    averageHeight: Number(averageHeight.toFixed(1)),
    positions,
    clubSpread: clubSpread.slice(0, 7),
    mostCapped: [...players].sort((a, b) => b.caps - a.caps).slice(0, 5),
    topScorers: [...players].sort((a, b) => b.goals - a.goals).slice(0, 5),
    tallest: [...players].sort((a, b) => b.heightCm - a.heightCm).slice(0, 3)
  };
}

function extractTeamStats(summary, teamName) {
  const key = teamKey(teamName);
  const boxTeam = summary?.boxscore?.teams?.find((item) => teamKey(item.team?.displayName) === key);
  return {
    logo: boxTeam?.team?.logo || boxTeam?.team?.logos?.[0]?.href || null,
    color: boxTeam?.team?.color || null,
    stats: boxTeam?.statistics || []
  };
}

function summaryTeams(summary) {
  const competitors = summary?.header?.competitions?.[0]?.competitors || [];
  const home = competitors.find((item) => item.homeAway === "home") || competitors[0] || {};
  const away = competitors.find((item) => item.homeAway === "away") || competitors[1] || {};
  return { home, away };
}

function athletePhoto(athlete) {
  return athlete?.headshot?.href || athlete?.headshot || null;
}

function athleteName(athlete) {
  return athlete?.displayName || athlete?.fullName || athlete?.shortName || athlete?.name || "";
}

function compactAthlete(athlete = {}) {
  return {
    id: athlete.id || null,
    name: athleteName(athlete),
    shortName: athlete.shortName || athleteName(athlete),
    photo: athletePhoto(athlete),
    position: athlete.position?.abbreviation || athlete.position?.displayName || athlete.position?.name || ""
  };
}

function cleanUniform(uniform = {}, fallback = {}) {
  return {
    type: uniform.type || fallback.type || "team",
    color: String(uniform.color || fallback.color || "1fc16b").replace(/^#/, ""),
    alternateColor: String(uniform.alternateColor || fallback.alternateColor || "0b0d0a").replace(/^#/, "")
  };
}

function compactSubstitutions(summary) {
  return (summary?.keyEvents || [])
    .filter((event) => event.type?.type === "substitution" || /substitution/i.test(event.type?.text || ""))
    .map((event) => {
      const incoming = compactAthlete(event.participants?.[0]?.athlete);
      const outgoing = compactAthlete(event.participants?.[1]?.athlete);
      return {
        minute: event.clock?.displayValue || "",
        team: event.team?.displayName || event.team?.name || "",
        in: incoming,
        out: outgoing,
        text: event.text || ""
      };
    })
    .filter((item) => item.in.name || item.out.name);
}

function compactLineups(summary) {
  const substitutions = compactSubstitutions(summary);
  const teams = summary?.boxscore?.teams || [];

  return (summary?.rosters || []).map((rosterBlock, index) => {
    const teamName = rosterBlock.team?.displayName
      || rosterBlock.team?.name
      || teams[index]?.team?.displayName
      || teams[index]?.team?.name
      || "";
    const teamSubs = substitutions.filter((item) => teamKey(item.team) === teamKey(teamName));
    const starterPlaceById = new Map();
    const starterPlaceByName = new Map();

    for (const entry of rosterBlock.roster || []) {
      if (!entry.starter) continue;
      const athlete = compactAthlete(entry.athlete);
      const place = String(entry.formationPlace || "0");
      if (athlete.id) starterPlaceById.set(String(athlete.id), place);
      if (athlete.name) starterPlaceByName.set(teamKey(athlete.name), place);
    }

    const replacementPlaceById = new Map();
    const replacementPlaceByName = new Map();
    const enrichedSubs = teamSubs.map((item) => {
      const replacedPlace = starterPlaceById.get(String(item.out.id || ""))
        || starterPlaceByName.get(teamKey(item.out.name))
        || "0";
      if (item.in.id) replacementPlaceById.set(String(item.in.id), replacedPlace);
      if (item.in.name) replacementPlaceByName.set(teamKey(item.in.name), replacedPlace);
      return { ...item, formationPlace: replacedPlace };
    });

    const players = (rosterBlock.roster || []).map((entry) => {
      const athlete = compactAthlete(entry.athlete);
      const rawPlace = String(entry.formationPlace || "0");
      const replacementPlace = replacementPlaceById.get(String(athlete.id || ""))
        || replacementPlaceByName.get(teamKey(athlete.name))
        || "";
      const formationPlace = rawPlace !== "0" ? rawPlace : replacementPlace || rawPlace;
      return {
        ...athlete,
        jersey: entry.jersey || "",
        formationPlace,
        starter: Boolean(entry.starter),
        active: entry.active !== false,
        subbedIn: Boolean(entry.subbedIn),
        subbedOut: Boolean(entry.subbedOut),
        current: Boolean((entry.starter && !entry.subbedOut) || entry.subbedIn)
      };
    });

    return {
      team: teamName,
      formation: rosterBlock.formation || "",
      uniform: cleanUniform(rosterBlock.uniform || teams[index]?.team?.uniform),
      current: players.filter((player) => player.current).slice(0, 11),
      starters: players.filter((player) => player.starter).slice(0, 11),
      bench: players.filter((player) => !player.starter),
      substitutions: enrichedSubs
    };
  });
}

function compactSummary(summary) {
  if (!summary?.header) return null;
  const competition = summary.header.competitions?.[0] || {};
  const { home, away } = summaryTeams(summary);
  const odds = summary.odds?.[0] || summary.pickcenter?.[0] || null;
  const probabilities = normalizeProbabilities(odds);
  const venue = competition.venue || summary.gameInfo?.venue || {};
  const homeName = home.team?.displayName || competition.competitors?.[0]?.team?.displayName;
  const awayName = away.team?.displayName || competition.competitors?.[1]?.team?.displayName;
  const status = competition.status || summary.header.competitions?.[0]?.status || {};
  const statusType = status.type || {};

  return {
    eventId: summary.header.id,
    name: summary.header.name || `${awayName} at ${homeName}`,
    shortName: summary.header.shortName,
    date: summary.header.competitions?.[0]?.date || summary.header.date,
    status: statusType.description || "Scheduled",
    statusDetail: statusType.detail || statusType.shortDetail || status.displayClock || statusType.description || "Scheduled",
    statusState: statusType.state || "",
    clock: status.displayClock || "",
    period: status.period || 0,
    venue: venue.fullName || venue.name || "Venue TBA",
    city: venue.address?.city || venue.address?.state || "",
    home: {
      name: homeName,
      abbreviation: home.team?.abbreviation,
      logo: home.team?.logo || home.team?.logos?.[0]?.href,
      color: home.team?.color,
      score: home.score || "0",
      stats: extractTeamStats(summary, homeName).stats
    },
    away: {
      name: awayName,
      abbreviation: away.team?.abbreviation,
      logo: away.team?.logo || away.team?.logos?.[0]?.href,
      color: away.team?.color,
      score: away.score || "0",
      stats: extractTeamStats(summary, awayName).stats
    },
    broadcasts: (summary.broadcasts || []).map((item) => item.media?.shortName || item.media?.name).filter(Boolean),
    odds: odds ? {
      provider: odds.provider?.name,
      details: odds.details,
      spread: odds.spread,
      overUnder: odds.overUnder,
      homeMoneyLine: odds.homeTeamOdds?.moneyLine,
      drawMoneyLine: odds.drawOdds?.moneyLine,
      awayMoneyLine: odds.awayTeamOdds?.moneyLine,
      probabilities
    } : null,
    form: summary.lastFiveGames || [],
    headToHead: summary.headToHeadGames || [],
    standings: summary.standings || null,
    leaders: summary.leaders || [],
    lineups: compactLineups(summary),
    news: summary.news?.articles?.slice(0, 6).map((article) => ({
      headline: article.headline,
      description: article.description,
      source: "ESPN",
      link: article.links?.web?.href || article.link
    })) || [],
    videos: (summary.videos || []).slice(0, 4).map((video) => ({
      headline: video.headline || video.title,
      link: video.links?.web?.href
    })).filter((video) => video.headline)
  };
}

async function fetchEspnSummary(eventId) {
  const result = await fetchJson(`${ESPN_BASE}/summary?event=${eventId}`, { ttl: 1000 * 60 * 3 });
  return result.data;
}

function liveScoreFromSummary(summary, source = "ESPN public API") {
  if (!summary?.home || !summary?.away) {
    return {
      available: false,
      source,
      label: "No live fixture",
      status: "No live fixture",
      detail: "No ESPN event mapped",
      home: null,
      away: null,
      homeScore: null,
      awayScore: null,
      isLive: false,
      isFinal: false
    };
  }

  const status = summary.status || "Scheduled";
  const state = String(summary.statusState || "").toLowerCase();
  const detail = summary.statusDetail || summary.clock || status;
  const homeScore = summary.home.score ?? "0";
  const awayScore = summary.away.score ?? "0";
  return {
    available: true,
    source,
    label: `${homeScore}-${awayScore}`,
    status,
    detail,
    clock: summary.clock || "",
    period: summary.period || 0,
    home: summary.home.name,
    away: summary.away.name,
    homeScore,
    awayScore,
    isLive: state === "in" || /in progress|halftime|half time|live/i.test(`${status} ${detail}`),
    isFinal: state === "post" || /final|full time/i.test(`${status} ${detail}`)
  };
}

async function findLiveMatchForTeams(dateKey, homeName, awayName) {
  const events = await fetchEspnScoreboards(dateKey).catch(() => []);
  const event = findEventForMatch(events, { home: homeName, away: awayName, team1: homeName, team2: awayName });
  if (!event?.id) {
    const repo = await getWorldcupRepoData().catch(() => null);
    const archivedGame = (repo?.games || []).find((game) =>
      gameDateKey(game) === dateKey &&
      ((teamKey(game.home_team_name_en) === teamKey(homeName) && teamKey(game.away_team_name_en) === teamKey(awayName)) ||
      (teamKey(game.home_team_name_en) === teamKey(awayName) && teamKey(game.away_team_name_en) === teamKey(homeName))) &&
      gameHasFinalResult(game)
    );
    const summary = summaryFromGameResult(archivedGame);
    return summary ? {
      eventId: summary.eventId,
      summary,
      liveScore: liveScoreFromSummary(summary, "Signal Room result archive")
    } : null;
  }
  const summary = compactSummary(await fetchEspnSummary(event.id));
  return {
    eventId: event.id,
    summary,
    liveScore: liveScoreFromSummary(summary)
  };
}

async function fetchEspnScoreboards(dateKey) {
  const keys = [dateKey, nextDateKey(dateKey)];
  const results = await Promise.all(
    keys.map((key) => fetchJson(`${ESPN_BASE}/scoreboard?dates=${key}&limit=100`, { ttl: 1000 * 60 * 3, timeoutMs: 3000 }).catch(() => ({ data: { events: [] } })))
  );
  return results.flatMap((result) => result.data.events || []);
}

function findEventForMatch(events, match) {
  const homeKey = teamKey(match.team1 || match.home_team_name_en || match.home);
  const awayKey = teamKey(match.team2 || match.away_team_name_en || match.away);
  return events.find((event) => {
    const competitors = event.competitions?.[0]?.competitors || [];
    const keys = competitors.map((item) => teamKey(item.team?.displayName || item.team?.name));
    return keys.includes(homeKey) && keys.includes(awayKey);
  });
}

async function fetchEspnScoreboardDate(dateKey) {
  const result = await fetchJson(`${ESPN_BASE}/scoreboard?dates=${dateKey}&limit=100`, { ttl: 1000 * 60 * 3, timeoutMs: 3000 })
    .catch(() => ({ data: { events: [] } }));
  return result.data.events || [];
}

function gameDateKey(game) {
  if (game?.gmt?.iso) return game.gmt.iso.slice(0, 10).replaceAll("-", "");
  const dashed = dashedFromRepoLocalDate(game?.local_date);
  return dashed ? dashed.replaceAll("-", "") : "";
}

function knownFixture(game) {
  return Boolean(game?.home_team_name_en && game?.away_team_name_en);
}

function gameHasFinalResult(game) {
  const hasScores = game?.home_score !== null && game?.away_score !== null
    && game?.home_score !== undefined && game?.away_score !== undefined;
  return Boolean(hasScores && (game?.finished === true || game?.finished === "TRUE" || game?.result_source));
}

function eventCompleted(event) {
  const status = event?.competitions?.[0]?.status || event?.status || {};
  const type = status.type || {};
  return Boolean(type.completed || type.state === "post" || /final/i.test(type.description || type.detail || type.shortDetail || ""));
}

function summaryFromGameResult(game) {
  if (!gameHasFinalResult(game)) return null;
  return {
    eventId: game.id ? `archive-${game.id}` : null,
    name: `${game.home_team_name_en} vs ${game.away_team_name_en}`,
    shortName: `${game.home_team_name_en} vs ${game.away_team_name_en}`,
    date: game.gmt?.iso || null,
    status: game.result_status || "Final",
    statusDetail: game.result_source || "Signal Room result archive",
    statusState: "post",
    clock: "",
    period: 2,
    venue: game.stadium_name || "Venue TBA",
    city: game.city_en || "",
    home: {
      name: game.home_team_name_en,
      abbreviation: game.home_team_code,
      logo: game.home_flag,
      score: String(game.home_score ?? "0"),
      stats: []
    },
    away: {
      name: game.away_team_name_en,
      abbreviation: game.away_team_code,
      logo: game.away_flag,
      score: String(game.away_score ?? "0"),
      stats: []
    },
    broadcasts: [],
    odds: null,
    form: [],
    headToHead: [],
    standings: null,
    leaders: [],
    lineups: [],
    news: [],
    videos: [],
    archivedResult: true
  };
}

function compactScoreboardSummary(event) {
  const competition = event?.competitions?.[0] || {};
  const competitors = competition.competitors || [];
  const home = competitors.find((item) => item.homeAway === "home") || competitors[0] || {};
  const away = competitors.find((item) => item.homeAway === "away") || competitors[1] || {};
  const status = competition.status || event?.status || {};
  const statusType = status.type || {};
  const teamBlock = (item) => ({
    name: item.team?.displayName || item.team?.name || "",
    abbreviation: item.team?.abbreviation,
    logo: item.team?.logo || item.team?.logos?.[0]?.href,
    color: item.team?.color,
    score: item.score || "0",
    stats: []
  });
  return {
    eventId: event?.id,
    name: event?.name,
    shortName: event?.shortName,
    date: competition.date || event?.date,
    status: statusType.description || "Scheduled",
    statusDetail: statusType.detail || statusType.shortDetail || status.displayClock || statusType.description || "Scheduled",
    statusState: statusType.state || "",
    clock: status.displayClock || "",
    period: status.period || 0,
    venue: competition.venue?.fullName || competition.venue?.name || "Venue TBA",
    city: competition.venue?.address?.city || competition.venue?.address?.state || "",
    home: teamBlock(home),
    away: teamBlock(away),
    broadcasts: [],
    odds: null,
    form: [],
    headToHead: [],
    standings: null,
    leaders: [],
    lineups: [],
    news: [],
    videos: []
  };
}

function swapSummaryOdds(odds) {
  if (!odds) return odds;
  return {
    ...odds,
    homeMoneyLine: odds.awayMoneyLine,
    awayMoneyLine: odds.homeMoneyLine,
    probabilities: odds.probabilities ? {
      home: odds.probabilities.away,
      draw: odds.probabilities.draw,
      away: odds.probabilities.home
    } : null
  };
}

function alignSummaryToMatch(summary, match) {
  if (!summary?.home || !summary?.away) return summary;
  const summaryHome = teamKey(summary.home.name);
  const summaryAway = teamKey(summary.away.name);
  const matchHome = teamKey(match.home);
  const matchAway = teamKey(match.away);
  if (summaryHome === matchHome && summaryAway === matchAway) return summary;
  if (summaryHome === matchAway && summaryAway === matchHome) {
    return {
      ...summary,
      home: summary.away,
      away: summary.home,
      odds: swapSummaryOdds(summary.odds)
    };
  }
  return summary;
}

function predictionOutcome(prediction, match) {
  const favorite = prediction?.favorite || "";
  if (favorite === "Draw") return "draw";
  if (teamKey(favorite) === teamKey(match.home)) return "home";
  if (teamKey(favorite) === teamKey(match.away)) return "away";
  const probabilities = prediction?.probabilities || {};
  if (probabilities.home >= probabilities.away && probabilities.home >= probabilities.draw) return "home";
  if (probabilities.away >= probabilities.draw) return "away";
  return "draw";
}

function outcomeLabel(outcome, match) {
  if (outcome === "home") return match.home;
  if (outcome === "away") return match.away;
  return "Draw";
}

function actualOutcome(homeScore, awayScore) {
  if (homeScore > awayScore) return "home";
  if (awayScore > homeScore) return "away";
  return "draw";
}

function brierScore(probabilities, outcome) {
  const actual = { home: 0, draw: 0, away: 0, [outcome]: 1 };
  const home = Number(probabilities?.home || 0) / 100;
  const draw = Number(probabilities?.draw || 0) / 100;
  const away = Number(probabilities?.away || 0) / 100;
  return Number(((home - actual.home) ** 2 + (draw - actual.draw) ** 2 + (away - actual.away) ** 2).toFixed(3));
}

function signalPredictionForGame(game, squads, summary = null, qipState = null) {
  const match = {
    eventId: summary?.eventId || null,
    group: game.group,
    localDate: game.local_date,
    gmt: game.gmt,
    home: game.home_team_name_en,
    away: game.away_team_name_en
  };
  const alignedSummary = alignSummaryToMatch(summary, match);
  const homeSquad = findSquad(squads, match.home);
  const awaySquad = findSquad(squads, match.away);
  const prediction = buildPredictionModel(match, squadStats(homeSquad), squadStats(awaySquad), alignedSummary, null, qipState);
  return { match, prediction, summary: alignedSummary };
}

const KNOCKOUT_TYPES = [
  ["r32", "Round of 32"],
  ["r16", "Round of 16"],
  ["qf", "Quarter-finals"],
  ["sf", "Semi-finals"],
  ["third", "Third Place"],
  ["final", "Final"]
];

function accuracySeries(rows) {
  const byDate = new Map();
  for (const row of rows) {
    const key = row.dateKey || "unknown";
    const value = byDate.get(key) || { dateKey: key, total: 0, correct: 0, brierSum: 0 };
    value.total += 1;
    value.correct += row.correct ? 1 : 0;
    value.brierSum += Number(row.brier || 0);
    byDate.set(key, value);
  }
  let runningTotal = 0;
  let runningCorrect = 0;
  return [...byDate.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey)).map((item) => {
    runningTotal += item.total;
    runningCorrect += item.correct;
    return {
      dateKey: item.dateKey,
      label: `${item.dateKey.slice(6, 8)} ${GMT_MONTHS[Number(item.dateKey.slice(4, 6)) - 1]}`,
      matches: item.total,
      dailyAccuracy: Number((item.correct / Math.max(1, item.total) * 100).toFixed(1)),
      cumulativeAccuracy: Number((runningCorrect / Math.max(1, runningTotal) * 100).toFixed(1)),
      averageBrier: Number((item.brierSum / Math.max(1, item.total)).toFixed(3))
    };
  });
}

async function buildQipAuditRows(dateKey = todayDateKey(), worldcupRepo = null, squads = null) {
  const [repoData, squadData] = await Promise.all([
    worldcupRepo ? Promise.resolve(worldcupRepo) : getWorldcupRepoData(),
    squads ? Promise.resolve(squads) : getSquads()
  ]);
  const auditDates = dateKeyRange("20260611", dateKey);
  const scoreboardSets = await Promise.all(auditDates.map((key) => fetchEspnScoreboardDate(key)));
  const events = scoreboardSets.flat();
  const knownGames = (repoData.games || []).filter(knownFixture);
  const completedPairs = knownGames
    .filter((game) => gameDateKey(game) <= dateKey)
    .map((game) => ({ game, event: findEventForMatch(events, game) }))
    .filter(({ game, event }) => eventCompleted(event) || gameHasFinalResult(game));

  const summaries = await Promise.all(completedPairs.map(({ event }) =>
    event?.id ? fetchEspnSummary(event.id).then(compactSummary).catch(() => compactScoreboardSummary(event)) : null
  ));

  const audit = completedPairs.map(({ game, event }, index) => {
    const summary = summaries[index] || (event ? compactScoreboardSummary(event) : summaryFromGameResult(game));
    const { match, prediction, summary: alignedSummary } = signalPredictionForGame(game, squadData, summary);
    const homeScore = Number(alignedSummary?.home?.score ?? 0);
    const awayScore = Number(alignedSummary?.away?.score ?? 0);
    const predictedOutcome = predictionOutcome(prediction, match);
    const actual = actualOutcome(homeScore, awayScore);
    const brier = brierScore(prediction.probabilities, actual);
    return {
      id: game.id,
      dateKey: gameDateKey(game),
      gmt: game.gmt,
      group: game.group,
      home: match.home,
      away: match.away,
      predictedOutcome,
      predictedWinner: outcomeLabel(predictedOutcome, match),
      predictedScore: prediction.scorePrediction.shortLabel,
      result: `${homeScore}-${awayScore}`,
      actualOutcome: actual,
      actualWinner: outcomeLabel(actual, match),
      correct: predictedOutcome === actual,
      exactScore: prediction.scorePrediction.homeGoals === homeScore && prediction.scorePrediction.awayGoals === awayScore,
      confidence: prediction.confidence,
      probabilities: prediction.probabilities,
      weights: prediction.components?.weights || {},
      brier,
      status: alignedSummary?.status || "Final",
      source: alignedSummary?.archivedResult ? "Signal Room result archive" : "ESPN public API"
    };
  }).sort((a, b) => String(a.gmt?.iso || "").localeCompare(String(b.gmt?.iso || "")));

  return { audit, completedPairs, knownGames, worldcupRepo: repoData, squads: squadData };
}

function buildScoreCalibration(audit = []) {
  const rows = audit.filter((row) => row.result && row.predictedScore);
  if (!rows.length) {
    return {
      averageActualTotal: 2.5,
      averagePredictedTotal: 2.5,
      totalGoalMultiplier: 1,
      homeShareShift: 0,
      genericScorePenalty: 0.88,
      lowGoalRate: 0,
      highGoalRate: 0,
      drawActualRate: 0,
      drawPredictedRate: 0
    };
  }
  const totals = rows.reduce((acc, row) => {
    const [actualHome, actualAway] = parseScore(row.result);
    const [predictedHome, predictedAway] = parseScore(row.predictedScore);
    const actualTotal = actualHome + actualAway;
    const predictedTotal = predictedHome + predictedAway;
    acc.actualTotal += actualTotal;
    acc.predictedTotal += predictedTotal;
    acc.actualHome += actualHome;
    acc.actualAway += actualAway;
    acc.predictedHome += predictedHome;
    acc.predictedAway += predictedAway;
    acc.lowGoal += actualTotal <= 1 ? 1 : 0;
    acc.highGoal += actualTotal >= 4 ? 1 : 0;
    acc.actualDraw += actualHome === actualAway ? 1 : 0;
    acc.predictedDraw += predictedHome === predictedAway ? 1 : 0;
    acc.genericPredicted += (row.predictedScore === "2-1" || row.predictedScore === "1-2") ? 1 : 0;
    acc.genericExact += (row.predictedScore === "2-1" || row.predictedScore === "1-2") && row.exactScore ? 1 : 0;
    return acc;
  }, {
    actualTotal: 0,
    predictedTotal: 0,
    actualHome: 0,
    actualAway: 0,
    predictedHome: 0,
    predictedAway: 0,
    lowGoal: 0,
    highGoal: 0,
    actualDraw: 0,
    predictedDraw: 0,
    genericPredicted: 0,
    genericExact: 0
  });
  const count = rows.length;
  const averageActualTotal = totals.actualTotal / count;
  const averagePredictedTotal = totals.predictedTotal / count;
  const actualHomeShare = totals.actualHome / Math.max(1, totals.actualTotal);
  const predictedHomeShare = totals.predictedHome / Math.max(1, totals.predictedTotal);
  const genericShare = totals.genericPredicted / count;
  const genericExactRate = totals.genericExact / Math.max(1, totals.genericPredicted);
  const genericScorePenalty = clamp(0.78 - (1 - genericExactRate) * 0.16 - genericShare * 0.28, 0.52, 0.82);
  return {
    averageActualTotal: Number(averageActualTotal.toFixed(2)),
    averagePredictedTotal: Number(averagePredictedTotal.toFixed(2)),
    totalGoalMultiplier: Number(clamp(averageActualTotal / Math.max(1.15, averagePredictedTotal), 0.72, 1.28).toFixed(3)),
    homeShareShift: Number(clamp((actualHomeShare - predictedHomeShare) * 0.45, -0.07, 0.07).toFixed(3)),
    genericScorePenalty: Number(genericScorePenalty.toFixed(3)),
    genericSwitchThreshold: 0.76,
    lowGoalRate: Number((totals.lowGoal / count).toFixed(3)),
    highGoalRate: Number((totals.highGoal / count).toFixed(3)),
    drawActualRate: Number((totals.actualDraw / count).toFixed(3)),
    drawPredictedRate: Number((totals.predictedDraw / count).toFixed(3)),
    genericShare: Number(genericShare.toFixed(3)),
    genericExactRate: Number(genericExactRate.toFixed(3))
  };
}

function buildQipState(audit = [], dateKey = todayDateKey()) {
  const lessonCount = audit.length;
  if (!lessonCount) {
    return {
      active: false,
      dateKey,
      heartbeat: "No completed results available for QIP calibration yet.",
      lessonCount: 0,
      confidenceMultiplier: 1,
      drawLift: 0,
      componentMultipliers: { market: 1, historicalSquad: 1, liveTournament: 1, expertMedia: 1 },
      scoreCalibration: {
        averageActualTotal: 2.5,
        averagePredictedTotal: 2.5,
        totalGoalMultiplier: 1,
        homeShareShift: 0,
        genericScorePenalty: 0.88,
        lowGoalRate: 0,
        highGoalRate: 0
      },
      teamAdjustments: {},
      rationale: ["QIP is waiting for completed match outcomes before changing model behavior."]
    };
  }

  const correct = audit.filter((row) => row.correct);
  const misses = audit.filter((row) => !row.correct);
  const avg = (rows, key) => rows.reduce((sum, row) => sum + Number(row[key] || 0), 0) / Math.max(1, rows.length);
  const hitRate = correct.length / lessonCount;
  const avgCorrectConfidence = avg(correct, "confidence");
  const avgMissConfidence = avg(misses, "confidence");
  const overconfidence = Math.max(0, avgMissConfidence - avgCorrectConfidence);
  const confidenceMultiplier = Number(clamp(1 - overconfidence / 140 - Math.max(0, 0.62 - hitRate) * 0.22, 0.78, 1.08).toFixed(3));
  const drawMisses = misses.filter((row) => row.actualOutcome === "draw" && row.predictedOutcome !== "draw").length;
  const drawLift = Number(clamp(drawMisses / Math.max(1, lessonCount) * 9, 0, 4.5).toFixed(2));
  const marketRows = audit.filter((row) => Number(row.weights?.market || 0) > 0);
  const marketHitRate = marketRows.filter((row) => row.correct).length / Math.max(1, marketRows.length);
  const historicalRows = audit.filter((row) => Number(row.weights?.historicalSquad || 0) > 0);
  const historicalHitRate = historicalRows.filter((row) => row.correct).length / Math.max(1, historicalRows.length);
  const componentMultipliers = {
    market: Number(clamp(1 + (marketHitRate - hitRate) * 0.35, 0.88, 1.12).toFixed(3)),
    historicalSquad: Number(clamp(1 + (historicalHitRate - hitRate) * 0.25, 0.9, 1.12).toFixed(3)),
    liveTournament: Number(clamp(1 + (hitRate - 0.5) * 0.16, 0.92, 1.1).toFixed(3)),
    expertMedia: 1
  };
  const scoreCalibration = buildScoreCalibration(audit);

  const teamMemory = new Map();
  for (const row of audit) {
    for (const team of [row.home, row.away]) {
      const key = teamKey(team);
      if (!teamMemory.has(key)) teamMemory.set(key, { team, calls: 0, correct: 0, overcalled: 0 });
      const memory = teamMemory.get(key);
      const wasPredicted = teamKey(row.predictedWinner) === key;
      const won = teamKey(row.actualWinner) === key;
      if (wasPredicted) {
        memory.calls += 1;
        if (won) memory.correct += 1;
        else memory.overcalled += 1;
      }
    }
  }
  const teamAdjustments = {};
  for (const [key, memory] of teamMemory.entries()) {
    if (!memory.calls) continue;
    const teamHit = memory.correct / memory.calls;
    const factor = Number(clamp(1 + (teamHit - hitRate) * 0.16 - memory.overcalled / memory.calls * 0.06, 0.9, 1.1).toFixed(3));
    if (Math.abs(factor - 1) >= 0.015) {
      teamAdjustments[key] = {
        team: memory.team,
        factor,
        evidence: `${memory.correct}/${memory.calls} correct when model favored this team`
      };
    }
  }

  const rationale = [
    `QIP audited ${lessonCount} completed matches and found ${correct.length} correct outcome calls.`,
    overconfidence > 0
      ? `Confidence is damped because missed calls averaged ${avgMissConfidence.toFixed(1)} pts vs ${avgCorrectConfidence.toFixed(1)} pts on correct calls.`
      : "Confidence is allowed to hold because misses are not more confident than correct calls.",
    drawLift > 0
      ? `Draw probability receives a ${drawLift} pt lift because ${drawMisses} missed calls landed as draws.`
      : "No draw correction is active from the current mistake pattern.",
    `Market and squad weights are recalibrated from their observed hit rates at this refresh.`,
    `Scorelines use a ${scoreCalibration.totalGoalMultiplier}x tournament goal-tempo multiplier and a ${scoreCalibration.genericScorePenalty}x penalty on overused 2-1/1-2 templates.`
  ];

  return {
    active: true,
    dateKey,
    heartbeat: "Agent Creates Task -> Heartbeat Picks Up -> Memory Informs Execution -> Lesson Stored",
    lessonCount,
    hitRate: Number((hitRate * 100).toFixed(1)),
    confidenceMultiplier,
    drawLift,
    componentMultipliers,
    scoreCalibration,
    teamAdjustments,
    rationale
  };
}

async function getQipState(dateKey = todayDateKey()) {
  const key = `qip:${dateKey}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < 1000 * 60 * 5) return cached.value;
  return onceInFlight(key, async () => {
    const { audit } = await buildQipAuditRows(dateKey);
    const value = { ...buildQipState(audit, dateKey), audit };
    cache.set(key, { at: Date.now(), value });
    return value;
  });
}

async function buildSignals(dateKey = todayDateKey()) {
  const [worldcupRepo, squads] = await Promise.all([getWorldcupRepoData(), getSquads()]);
  const qipState = await getQipState(dateKey);
  const audit = qipState.audit || [];
  const knownGames = (worldcupRepo.games || []).filter(knownFixture);
  const completedIds = new Set(audit.map((row) => String(row.id)));

  const upcoming = knownGames
    .filter((game) => !completedIds.has(String(game.id)) && gameDateKey(game) >= dateKey)
    .map((game) => {
      const { match, prediction } = signalPredictionForGame(game, squads, null, qipState);
      const predictedOutcome = predictionOutcome(prediction, match);
      return {
        id: game.id,
        dateKey: gameDateKey(game),
        gmt: game.gmt,
        group: game.group,
        home: match.home,
        away: match.away,
        favorite: outcomeLabel(predictedOutcome, match),
        predictedOutcome,
        predictedScore: prediction.scorePrediction.shortLabel,
        confidence: prediction.confidence,
        probabilities: prediction.probabilities,
        weights: prediction.components?.weights || {},
        expectedGoals: prediction.scorePrediction.expectedGoals,
        model: prediction.label
      };
    })
    .sort((a, b) => String(a.gmt?.iso || "").localeCompare(String(b.gmt?.iso || "")));

  const correct = audit.filter((row) => row.correct).length;
  const exact = audit.filter((row) => row.exactScore).length;
  const brierAverage = audit.reduce((sum, row) => sum + row.brier, 0) / Math.max(1, audit.length);
  const outcomeDistribution = audit.reduce((acc, row) => {
    acc[row.predictedOutcome] = (acc[row.predictedOutcome] || 0) + 1;
    return acc;
  }, { home: 0, draw: 0, away: 0 });
  const upcomingDistribution = upcoming.reduce((acc, row) => {
    acc[row.predictedOutcome] = (acc[row.predictedOutcome] || 0) + 1;
    return acc;
  }, { home: 0, draw: 0, away: 0 });
  const weightedRows = [...audit, ...upcoming].filter((row) => row.weights);
  const weightAverage = weightedRows.reduce((acc, row) => {
    acc.market += Number(row.weights.market || 0);
    acc.historicalSquad += Number(row.weights.historicalSquad || 0);
    acc.liveTournament += Number(row.weights.liveTournament || 0);
    acc.expertMedia += Number(row.weights.expertMedia || 0);
    return acc;
  }, { market: 0, historicalSquad: 0, liveTournament: 0, expertMedia: 0 });
  for (const key of Object.keys(weightAverage)) {
    weightAverage[key] = Number((weightAverage[key] / Math.max(1, weightedRows.length) * 100).toFixed(1));
  }

  return {
    fetchedAt: new Date().toISOString(),
    dateKey,
    source: ["Signal Room prediction model", "Signal Room result archive", "ESPN public API finals", "rezarahiminia/worldcup2026", "FIFA squad PDF"],
    method: "QIP refresh-time reconstruction. Completed results become calibration lessons for the next prediction pass.",
    qip: {
      active: qipState.active,
      heartbeat: qipState.heartbeat,
      lessonCount: qipState.lessonCount,
      confidenceMultiplier: qipState.confidenceMultiplier,
      drawLift: qipState.drawLift,
      componentMultipliers: qipState.componentMultipliers,
      scoreCalibration: qipState.scoreCalibration,
      rationale: qipState.rationale
    },
    summary: {
      auditedMatches: audit.length,
      correctCalls: correct,
      missedCalls: Math.max(0, audit.length - correct),
      hitRate: Number((correct / Math.max(1, audit.length) * 100).toFixed(1)),
      exactScoreRate: Number((exact / Math.max(1, audit.length) * 100).toFixed(1)),
      averageBrier: Number(brierAverage.toFixed(3)),
      modelScore: Number((100 - Math.min(2, brierAverage) / 2 * 100).toFixed(1)),
      upcomingMatches: upcoming.length
    },
    charts: {
      accuracySeries: accuracySeries(audit),
      resultPie: [
        { label: "Correct", value: correct, color: "var(--pitch)" },
        { label: "Missed", value: Math.max(0, audit.length - correct), color: "var(--red)" }
      ],
      outcomeDistribution,
      upcomingDistribution,
      modelWeights: [
        { label: "Market", value: weightAverage.market, color: "var(--pink)" },
        { label: "Historical squad", value: weightAverage.historicalSquad, color: "var(--home)" },
        { label: "Live tournament", value: weightAverage.liveTournament, color: "var(--away)" },
        { label: "Expert media", value: weightAverage.expertMedia, color: "var(--blue)" }
      ]
    },
    audit,
    upcoming
  };
}

function emptyStanding(team, group) {
  return { team, group, played: 0, points: 0, gf: 0, ga: 0, gd: 0, source: "pending" };
}

function addStandingResult(table, group, home, away, homeScore, awayScore, source) {
  if (!table.has(group)) table.set(group, new Map());
  const groupTable = table.get(group);
  if (!groupTable.has(teamKey(home))) groupTable.set(teamKey(home), emptyStanding(home, group));
  if (!groupTable.has(teamKey(away))) groupTable.set(teamKey(away), emptyStanding(away, group));
  const homeRow = groupTable.get(teamKey(home));
  const awayRow = groupTable.get(teamKey(away));
  homeRow.played += 1;
  awayRow.played += 1;
  homeRow.gf += homeScore;
  homeRow.ga += awayScore;
  awayRow.gf += awayScore;
  awayRow.ga += homeScore;
  homeRow.gd = homeRow.gf - homeRow.ga;
  awayRow.gd = awayRow.gf - awayRow.ga;
  homeRow.source = source;
  awayRow.source = source;
  if (homeScore > awayScore) homeRow.points += 3;
  else if (awayScore > homeScore) awayRow.points += 3;
  else {
    homeRow.points += 1;
    awayRow.points += 1;
  }
}

function sortedGroupRows(groupMap) {
  return [...(groupMap?.values() || [])].sort((a, b) =>
    b.points - a.points
    || b.gd - a.gd
    || b.gf - a.gf
    || a.team.localeCompare(b.team)
  );
}

function predictionForTeams(home, away, game, squads, qipState) {
  const match = {
    eventId: null,
    group: game?.group || game?.type || "Knockout",
    localDate: game?.local_date || null,
    gmt: game?.gmt || null,
    home,
    away
  };
  const homeSquad = findSquad(squads, home);
  const awaySquad = findSquad(squads, away);
  const prediction = buildPredictionModel(match, squadStats(homeSquad), squadStats(awaySquad), null, null, qipState);
  const outcome = predictionOutcome(prediction, match);
  return { match, prediction, outcome, winner: outcomeLabel(outcome, match) };
}

function parseScore(value) {
  const [home, away] = String(value || "0-0").split("-").map((part) => Number(part));
  return [Number.isFinite(home) ? home : 0, Number.isFinite(away) ? away : 0];
}

function projectGroupStandings(games, audit, squads, qipState, mode, dateKey) {
  const table = new Map();
  const actualById = new Map(audit.map((row) => [String(row.id), row]));
  const groupGames = games.filter((item) => item.type === "group" && knownFixture(item));
  const groupTotals = new Map();
  const groupActuals = new Map();
  const projectedResults = [];
  for (const game of groupGames) {
    groupTotals.set(game.group, (groupTotals.get(game.group) || 0) + 1);
    if (!table.has(game.group)) table.set(game.group, new Map());
    const groupTable = table.get(game.group);
    for (const team of [game.home_team_name_en, game.away_team_name_en]) {
      if (!groupTable.has(teamKey(team))) groupTable.set(teamKey(team), emptyStanding(team, game.group));
    }
    const actual = actualById.get(String(game.id));
    if (actual) {
      const [homeScore, awayScore] = parseScore(actual.result);
      groupActuals.set(game.group, (groupActuals.get(game.group) || 0) + 1);
      addStandingResult(table, game.group, game.home_team_name_en, game.away_team_name_en, homeScore, awayScore, "completed result");
      continue;
    }
    if (mode !== "signal") continue;
    const { prediction } = signalPredictionForGame(game, squads, null, qipState);
    projectedResults.push({
      id: game.id,
      group: game.group,
      dateKey: gameDateKey(game),
      gmt: game.gmt,
      home: game.home_team_name_en,
      away: game.away_team_name_en,
      score: prediction.scorePrediction.shortLabel,
      expectedGoals: prediction.scorePrediction.expectedGoals,
      candidates: prediction.scorePrediction.candidates?.slice(0, 4) || [],
      confidence: prediction.confidence,
      source: "QIP-calibrated group projection"
    });
    addStandingResult(
      table,
      game.group,
      game.home_team_name_en,
      game.away_team_name_en,
      prediction.scorePrediction.homeGoals,
      prediction.scorePrediction.awayGoals,
      "QIP projection"
    );
  }
  const groups = Object.fromEntries([...table.entries()].map(([group, groupMap]) => [group, sortedGroupRows(groupMap)]));
  const groupStatus = Object.fromEntries([...groupTotals.entries()].map(([group, total]) => {
    const completed = groupActuals.get(group) || 0;
    return {
      total,
      completed,
      complete: completed >= total,
      projected: mode === "signal"
    };
  }));
  const thirdRankings = Object.values(groups)
    .map((rows) => rows[2])
    .filter(Boolean)
    .sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team));
  return { groups, thirdRankings, groupStatus, projectedResults, mode, dateKey };
}

function resolveSlotLabel(label, standings) {
  const value = String(label || "");
  let match = value.match(/^Winner Group ([A-L])$/i);
  if (match) {
    const group = match[1].toUpperCase();
    const status = standings.groupStatus?.[group];
    if (standings.mode === "known" && !status?.complete) {
      return { team: value, source: "not clinched yet" };
    }
    const team = standings.groups[group]?.[0];
    return team ? { team: team.team, source: `${value}, ${team.source}` } : { team: value, source: "unresolved group winner" };
  }
  match = value.match(/^Runner-up Group ([A-L])$/i);
  if (match) {
    const group = match[1].toUpperCase();
    const status = standings.groupStatus?.[group];
    if (standings.mode === "known" && !status?.complete) {
      return { team: value, source: "not clinched yet" };
    }
    const team = standings.groups[group]?.[1];
    return team ? { team: team.team, source: `${value}, ${team.source}` } : { team: value, source: "unresolved group runner-up" };
  }
  match = value.match(/^3rd Group ([A-L/]+)$/i);
  if (match) {
    const allowed = new Set(match[1].split("/").map((part) => part.toUpperCase()));
    const team = standings.thirdRankings.find((row) =>
      allowed.has(row.group) && (standings.mode !== "known" || standings.groupStatus?.[row.group]?.complete)
    );
    return team ? { team: team.team, source: `${value}, ${team.source}` } : { team: value, source: "unresolved third-place slot" };
  }
  return { team: value || "TBD", source: "fixture label" };
}

function resolveKnockoutSlot(game, side, standings, winners) {
  const team = side === "home" ? game.home_team_name_en : game.away_team_name_en;
  if (team) return { team, source: "official fixture team" };
  const label = side === "home" ? game.home_team_label : game.away_team_label;
  const winnerMatch = String(label || "").match(/^Winner Match (\d+)$/i);
  if (winnerMatch && winners.has(winnerMatch[1])) return { team: winners.get(winnerMatch[1]), source: label };
  const loserMatch = String(label || "").match(/^Loser Match (\d+)$/i);
  if (loserMatch) return { team: label || "TBD", source: "third-place slot unresolved" };
  return resolveSlotLabel(label, standings);
}

async function buildKnockoutProjection(dateKey = todayDateKey(), mode = "signal") {
  const [worldcupRepo, squads, qipState] = await Promise.all([getWorldcupRepoData(), getSquads(), getQipState(dateKey)]);
  const audit = qipState.audit || [];
  const games = worldcupRepo.games || [];
  const standings = projectGroupStandings(games, audit, squads, qipState, mode, dateKey);
  const winners = new Map();
  const rounds = KNOCKOUT_TYPES.map(([type, label]) => ({ type, label, matches: [] }));
  const roundByType = new Map(rounds.map((round) => [round.type, round]));
  const confidenceByRound = [];

  for (const game of games.filter((item) => item.type && item.type !== "group").sort((a, b) => Number(a.id || 0) - Number(b.id || 0))) {
    const homeSlot = resolveKnockoutSlot(game, "home", standings, winners);
    const awaySlot = resolveKnockoutSlot(game, "away", standings, winners);
    let prediction = null;
    let winner = "";
    if (mode === "signal" && homeSlot.team && awaySlot.team && !/Match|Group|TBD/i.test(`${homeSlot.team} ${awaySlot.team}`)) {
      const projected = predictionForTeams(homeSlot.team, awaySlot.team, game, squads, qipState);
      prediction = {
        favorite: projected.winner,
        score: projected.prediction.scorePrediction.shortLabel,
        confidence: projected.prediction.confidence,
        probabilities: projected.prediction.probabilities,
        qip: projected.prediction.qip
      };
      winner = projected.winner;
      winners.set(String(game.id), winner);
      confidenceByRound.push({ round: game.type, matchId: game.id, confidence: projected.prediction.confidence });
    }
    const row = {
      id: game.id,
      type: game.type,
      gmt: game.gmt,
      stadium: game.stadium_name,
      city: game.city_en,
      home: homeSlot.team || "TBD",
      away: awaySlot.team || "TBD",
      homeSource: homeSlot.source,
      awaySource: awaySlot.source,
      prediction,
      winner
    };
    roundByType.get(game.type)?.matches.push(row);
  }

  const resolvedSlots = rounds.reduce((sum, round) =>
    sum + round.matches.flatMap((match) => [match.home, match.away]).filter((team) => !/Group|Match|TBD/i.test(team)).length,
    0
  );
  const avgConfidence = confidenceByRound.reduce((sum, item) => sum + item.confidence, 0) / Math.max(1, confidenceByRound.length);
  return {
    fetchedAt: new Date().toISOString(),
    dateKey,
    mode,
    rounds,
    standings,
    technical: {
      resolvedSlots,
      projectedMatches: confidenceByRound.length,
      averageConfidence: Number(avgConfidence.toFixed(1)),
      confidenceByRound
    },
    qip: {
      heartbeat: qipState.heartbeat,
      lessonCount: qipState.lessonCount,
      confidenceMultiplier: qipState.confidenceMultiplier,
      drawLift: qipState.drawLift,
      scoreCalibration: qipState.scoreCalibration,
      rationale: qipState.rationale
    }
  };
}

async function buildSignalDay(dateKey = todayDateKey()) {
  const [openFootball, worldcupRepo, squads, espnEvents] = await Promise.all([
    fetchJson(OPENFOOTBALL_2026, { ttl: CACHE_MS, timeoutMs: 2500 }).catch(() => ({ data: { matches: [] } })),
    getWorldcupRepoData(),
    getSquads(),
    fetchEspnScoreboards(dateKey)
  ]);
  const localDate = dashedDate(dateKey);
  const openMatches = (openFootball.data.matches || []).filter((match) => match.date === localDate);
  const fallbackMatches = (worldcupRepo.games || []).filter((match) =>
    String(match.local_date || "").startsWith(`${dateKey.slice(4, 6)}/${dateKey.slice(6, 8)}/${dateKey.slice(0, 4)}`)
  );

  const canonical = fallbackMatches.map((match) => ({
    date: localDate,
    time: match.local_date?.split(" ")[1] || "",
    team1: match.home_team_name_en,
    team2: match.away_team_name_en,
    group: match.group,
    githubMatch: match,
    openFootballCrossCheck: openMatches.find((openMatch) =>
      teamKey(openMatch.team1) === teamKey(match.home_team_name_en) &&
      teamKey(openMatch.team2) === teamKey(match.away_team_name_en)
    ) || null
  }));

  const eventMatches = canonical.map((match) => ({ match, event: findEventForMatch(espnEvents, match) }));
  const summaries = await Promise.all(
    eventMatches.map(({ event }) => event?.id ? fetchEspnSummary(event.id).catch(() => null) : null)
  );

  const preparedMatches = eventMatches.map(({ match, event }, index) => {
    const summary = compactSummary(summaries[index]) || summaryFromGameResult(match.githubMatch);
    const homeSquad = findSquad(squads, match.team1 || summary?.home?.name);
    const awaySquad = findSquad(squads, match.team2 || summary?.away?.name);
    const homeProfile = homeSquad ? squadStats(homeSquad) : null;
    const awayProfile = awaySquad ? squadStats(awaySquad) : null;
    const resolvedMatch = {
      home: summary?.home?.name || match.team1,
      away: summary?.away?.name || match.team2
    };
    return { match, event, summary, homeProfile, awayProfile, resolvedMatch };
  });

  const expertSignals = await Promise.all(
    preparedMatches.map(({ resolvedMatch, summary }) => fetchExpertMedia(resolvedMatch, summary, 10).catch(() => buildExpertSignal(resolvedMatch, [])))
  );
  const qipState = await getQipState(dateKey).catch(() => null);

  const matches = preparedMatches.map(({ match, event, summary, homeProfile, awayProfile, resolvedMatch }, index) => {
    const gmt = gmtFromIso(summary?.date)
      || match.githubMatch?.gmt
      || gmtFromOpenFootball(match.date, match.openFootballCrossCheck?.time);
    const expertMedia = expertSignals[index];
    const predictionModel = buildPredictionModel(resolvedMatch, homeProfile, awayProfile, summary, expertMedia, qipState);
    return {
      source: {
        schedule: "rezarahiminia/worldcup2026",
        crossCheck: match.openFootballCrossCheck ? "OpenFootball matched" : "OpenFootball not matched",
        live: summary?.archivedResult ? "Signal Room result archive" : event ? "ESPN public API" : "not mapped",
        expertMedia: expertMedia.noteCount ? "Google News RSS + ESPN news" : "not enough media notes"
      },
      eventId: event?.id || summary?.eventId || null,
      matchId: match.githubMatch?.id || null,
      group: match.group || null,
      localDate: match.date || localDate,
      localTime: match.time || "",
      gmt,
      gmtTime: gmt?.time || "",
      home: resolvedMatch.home,
      away: resolvedMatch.away,
      summary,
      liveScore: liveScoreFromSummary(summary, summary?.archivedResult ? "Signal Room result archive" : "ESPN public API"),
      predictionModel,
      expertMedia,
      squadSignals: {
        home: homeProfile,
        away: awayProfile
      }
    };
  });

  const teams = [...new Map(matches.flatMap((match) => [
    [teamKey(match.home), match.home],
    [teamKey(match.away), match.away]
  ])).values()];

  return {
    dateKey,
    localDate,
    fetchedAt: new Date().toISOString(),
    matches,
    teams,
    sources: ["rezarahiminia/worldcup2026", "Signal Room result archive", "ESPN public API", "OpenFootball", "FIFA squad PDF", "Google News RSS", "Expert media sentiment"]
  };
}

function buildPlayerInsights(squad, opponentSquad) {
  const players = squad?.players || [];
  if (!players.length) return [];
  const opponentHeight = opponentSquad ? squadStats(opponentSquad).averageHeight : 0;
  return [...players]
    .map((player) => {
      const scoringRate = player.caps ? player.goals / player.caps : player.goals;
      const tags = [];
      if (player.caps >= 80) tags.push("high-cap tournament operator");
      if (player.goals >= 20) tags.push("primary end-product source");
      if (player.heightCm >= 190) tags.push("set-piece leverage");
      if (opponentHeight && player.heightCm - opponentHeight >= 6) tags.push("aerial mismatch candidate");
      if (player.position === "GK" && player.caps < 10) tags.push("pressure point: low international sample");
      return {
        ...player,
        scoringRate: Number(scoringRate.toFixed(2)),
        impactScore: Number((player.goals * 7 + player.caps * 0.8 + (player.heightCm - 175) * 0.5).toFixed(1)),
        tags: tags.slice(0, 3)
      };
    })
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 10);
}

function personKey(value) {
  return stripMarks(value)
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((part) => part.length > 1)
    .sort()
    .join(" ");
}

function squadPlayerKeys(player) {
  return [
    player.playerName,
    `${player.firstNames || ""} ${player.lastNames || ""}`,
    `${player.firstNames || ""} ${player.shirtName || ""}`,
    player.shirtName
  ].map(personKey).filter(Boolean);
}

function lineupMediaIndex(lineup) {
  const map = new Map();
  const players = [
    ...(lineup?.current || []),
    ...(lineup?.starters || []),
    ...(lineup?.bench || [])
  ];

  for (const player of players) {
    const media = {
      espnId: player.id,
      photo: player.photo,
      espnName: player.name,
      jersey: player.jersey
    };
    for (const key of [personKey(player.name), personKey(player.shortName)].filter(Boolean)) {
      if (!map.has(key)) map.set(key, media);
    }
  }
  return map;
}

function enhancePlayersWithMedia(players, lineup) {
  if (!lineup) return players;
  const media = lineupMediaIndex(lineup);
  return players.map((player) => {
    const match = squadPlayerKeys(player).map((key) => media.get(key)).find(Boolean);
    return match ? {
      ...player,
      photo: match.photo || null,
      espnId: match.espnId,
      espnName: match.espnName,
      number: player.number || match.jersey
    } : player;
  });
}

function findLineup(summary, teamName) {
  return (summary?.lineups || []).find((lineup) => teamKey(lineup.team) === teamKey(teamName)) || null;
}

function buildUncommonInsights(match, homeSquad, awaySquad) {
  const homeStats = squadStats(homeSquad);
  const awayStats = squadStats(awaySquad);
  const insights = [];
  if (homeStats.averageCaps && awayStats.averageCaps) {
    const diff = Number(Math.abs(homeStats.averageCaps - awayStats.averageCaps).toFixed(1));
    const edge = homeStats.averageCaps > awayStats.averageCaps ? match.home : match.away;
    insights.push(`${edge} carry a ${diff} average-caps experience edge across the 26-player squad.`);
  }
  if (homeStats.averageHeight && awayStats.averageHeight) {
    const diff = Number(Math.abs(homeStats.averageHeight - awayStats.averageHeight).toFixed(1));
    const edge = homeStats.averageHeight > awayStats.averageHeight ? match.home : match.away;
    insights.push(`${edge} have a ${diff} cm average-height edge, useful for set-piece and late-game pressure reads.`);
  }
  const homeGoals = homeStats.totalGoals || 0;
  const awayGoals = awayStats.totalGoals || 0;
  if (homeGoals || awayGoals) {
    const edge = homeGoals > awayGoals ? match.home : match.away;
    const gap = Math.abs(homeGoals - awayGoals);
    insights.push(`${edge} have ${gap} more squad international goals, a better proxy than star reputation for finishing depth.`);
  }
  const homeForeign = homeStats.clubSpread?.filter((item) => item.country !== homeSquad?.code).reduce((sum, item) => sum + item.count, 0) || 0;
  const awayForeign = awayStats.clubSpread?.filter((item) => item.country !== awaySquad?.code).reduce((sum, item) => sum + item.count, 0) || 0;
  if (homeForeign || awayForeign) {
    const edge = homeForeign > awayForeign ? match.home : match.away;
    insights.push(`${edge} show the larger export footprint in club distribution, often a signal of varied tactical exposure.`);
  }
  return insights.slice(0, 5);
}

function safePathFromUrl(pathname) {
  const decoded = decodeURIComponent(pathname);
  const target = decoded === "/" ? "/index.html" : decoded;
  const fullPath = normalize(join(PUBLIC_DIR, target));
  if (!fullPath.startsWith(PUBLIC_DIR)) return null;
  return fullPath;
}

function imagePathFromUrl(pathname) {
  const name = decodeURIComponent(pathname.replace("/momentum-images/", ""));
  const fullPath = normalize(join(ROOT, name));
  if (!fullPath.startsWith(ROOT) || !/\.jpe?g$/i.test(fullPath)) return null;
  return fullPath;
}

function getEventTeam(event) {
  return event?.team?.name || "Unknown";
}

function minuteIndex(event) {
  const minute = Number(event.minute || 0);
  const second = Number(event.second || 0);
  return Math.max(0, Math.floor(minute + second / 60));
}

function threatAt(location) {
  if (!Array.isArray(location) || location.length < 2) return 0;
  const x = Math.max(0, Math.min(120, Number(location[0] || 0))) / 120;
  const y = Math.abs((Number(location[1] || 40) - 40) / 40);
  const centrality = 1 - Math.min(1, y);
  const boxBoost = x > 0.82 ? 0.18 : x > 0.68 ? 0.08 : 0;
  return Math.max(0, Math.min(1, Math.pow(x, 2.15) * (0.72 + centrality * 0.38) + boxBoost));
}

function actionThreat(event) {
  const type = event?.type?.name;
  const start = event.location;

  if (type === "Pass") {
    if (event.pass?.outcome) return 0;
    const end = event.pass?.end_location;
    return threatAt(end) - threatAt(start);
  }

  if (type === "Carry") {
    return threatAt(event.carry?.end_location) - threatAt(start);
  }

  if (type === "Shot") {
    const xg = Number(event.shot?.statsbomb_xg || 0);
    return Math.max(0.01, xg);
  }

  if (type === "Dribble") {
    return event.dribble?.outcome?.name === "Complete" ? 0.012 : -0.006;
  }

  if (type === "Ball Recovery") return 0.008;
  if (type === "Dispossessed" || type === "Miscontrol") return -0.01;
  return 0;
}

function summarizeMatch(match, events, lineups, frames) {
  const teams = [...new Set(events.map(getEventTeam).filter(Boolean))];
  const home = match?.home_team?.home_team_name || teams[0] || "Home";
  const away = match?.away_team?.away_team_name || teams.find((team) => team !== home) || "Away";
  const buckets = Array.from({ length: 130 }, (_, minute) => ({
    minute,
    homeThreat: 0,
    awayThreat: 0,
    homeXg: 0,
    awayXg: 0,
    homeActions: 0,
    awayActions: 0
  }));
  const eventCounts = new Map();
  const goals = [];
  let homeXg = 0;
  let awayXg = 0;

  for (const event of events) {
    const type = event?.type?.name || "Unknown";
    const team = getEventTeam(event);
    eventCounts.set(type, (eventCounts.get(type) || 0) + 1);

    const minute = Math.min(buckets.length - 1, minuteIndex(event));
    const threat = actionThreat(event);
    const isHome = team === home;
    const bucket = buckets[minute];

    if (isHome) {
      bucket.homeThreat += threat;
      bucket.homeActions += 1;
    } else if (team === away) {
      bucket.awayThreat += threat;
      bucket.awayActions += 1;
    }

    if (type === "Shot") {
      const xg = Number(event.shot?.statsbomb_xg || 0);
      if (isHome) {
        homeXg += xg;
        bucket.homeXg += xg;
      } else if (team === away) {
        awayXg += xg;
        bucket.awayXg += xg;
      }

      if (event.shot?.outcome?.name === "Goal") {
        goals.push({
          id: event.id,
          minute,
          team,
          player: event.player?.name || "Unknown",
          xg,
          side: isHome ? "home" : "away"
        });
      }
    }
  }

  const used = buckets.filter((bucket) => bucket.homeActions || bucket.awayActions || bucket.homeThreat || bucket.awayThreat);
  const lastMinute = Math.max(95, ...used.map((bucket) => bucket.minute));
  const timeline = buckets.slice(0, lastMinute + 1).map((bucket, index, all) => {
    const start = Math.max(0, index - 4);
    const window = all.slice(start, index + 1);
    const home = window.reduce((sum, item) => sum + item.homeThreat + item.homeXg, 0) / window.length;
    const away = window.reduce((sum, item) => sum + item.awayThreat + item.awayXg, 0) / window.length;
    return {
      minute: bucket.minute,
      homeThreat: Number(home.toFixed(4)),
      awayThreat: Number(away.toFixed(4)),
      net: Number((home - away).toFixed(4)),
      homeActions: bucket.homeActions,
      awayActions: bucket.awayActions
    };
  });

  const sortedEventCounts = [...eventCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return {
    match: {
      matchId: match.match_id,
      date: match.match_date,
      competition: match.competition?.competition_name,
      season: match.season?.season_name,
      home,
      away,
      homeScore: match.home_score,
      awayScore: match.away_score,
      stadium: match.stadium?.name,
      city: match.stadium?.country?.name,
      status: match.match_status
    },
    totals: {
      events: events.length,
      lineups: Array.isArray(lineups) ? lineups.reduce((sum, team) => sum + (team.lineup?.length || 0), 0) : 0,
      frames360: Array.isArray(frames) ? frames.length : 0,
      homeXg: Number(homeXg.toFixed(2)),
      awayXg: Number(awayXg.toFixed(2)),
      goals: goals.length
    },
    goals,
    eventCounts: sortedEventCounts.slice(0, 18),
    timeline,
    sourceFields: {
      events: events[0] ? Object.keys(events[0]).sort() : [],
      lineups: lineups?.[0]?.lineup?.[0] ? Object.keys(lineups[0].lineup[0]).sort() : [],
      frames360: frames?.[0] ? Object.keys(frames[0]).sort() : []
    }
  };
}

async function probeJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "WorldCupMomentumDashboard/1.0" }
    }).finally(() => clearTimeout(timeout));
    return { status: response.status, ok: response.ok };
  } catch (error) {
    clearTimeout(timeout);
    return { status: "unreachable", ok: false, detail: error.message };
  }
}

async function probeBallDontLie() {
  if (!BALLDONTLIE_API_KEY) {
    return { status: "missing_key", ok: false };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${BALLDONTLIE_BASE}/teams?seasons[]=2026&per_page=1`, {
      signal: controller.signal,
      headers: {
        "accept": "application/json",
        "user-agent": "WorldCupMomentumDashboard/1.0",
        ...ballDontLieHeaders()
      }
    }).finally(() => clearTimeout(timeout));
    return { status: response.status, ok: response.ok };
  } catch (error) {
    clearTimeout(timeout);
    return { status: "unreachable", ok: false, detail: error.message };
  }
}

async function fetchBallDontLie(path, fallback = null) {
  if (!BALLDONTLIE_API_KEY) return fallback;
  try {
    const separator = path.includes("?") ? "&" : "?";
    const url = `${BALLDONTLIE_BASE}${path}${separator}seasons[]=2026`;
    const result = await fetchJsonWithHeaders(url, ballDontLieHeaders(), { ttl: 1000 * 60 * 3 });
    return result.data;
  } catch {
    return fallback;
  }
}

async function getBallDontLieOverview() {
  return onceInFlight("ball-dont-lie:overview", async () => {
    const cached = cache.get("ball-dont-lie:overview");
    if (cached && Date.now() - cached.at < 1000 * 60 * 3) return cached.value;
    if (!BALLDONTLIE_API_KEY) {
      return { status: "missing_key", connected: false, data: null };
    }
    const status = await probeBallDontLie();
    if (!status.ok) {
      return { status: status.status, connected: false, data: null };
    }

    const data = {};
    const endpoints = [
      ["matches", "/matches?per_page=100"],
      ["teams", "/teams?per_page=100"],
      ["players", "/players?per_page=100"],
      ["standings", "/group_standings?per_page=100"]
    ];
    for (const [key, path] of endpoints) {
      data[key] = await fetchBallDontLie(path);
      await delay(250);
    }

    const value = {
      status: status.status,
      connected: true,
      data
    };
    cache.set("ball-dont-lie:overview", { at: Date.now(), value });
    return value;
  });
}

function providerRecordCount(value) {
  if (Array.isArray(value)) return value.length;
  if (Array.isArray(value?.data)) return value.data.length;
  return 0;
}

function summarizeBallDontLieOverview(overview) {
  const available = Object.fromEntries(
    Object.entries(overview?.data || {}).map(([key, value]) => [key, providerRecordCount(value)])
  );
  return {
    status: overview?.status || "unknown",
    connected: Boolean(overview?.connected),
    available
  };
}

function apiFootballErrorLabel(errors) {
  if (!errors || (Array.isArray(errors) && !errors.length)) return "";
  if (typeof errors === "string") return errors;
  if (Array.isArray(errors)) return errors.join(", ");
  return Object.values(errors).filter(Boolean).join(", ");
}

function apiFootballCoverageFlags(coverage = {}) {
  const fixtures = coverage.fixtures || {};
  return [
    ["Fixture events", fixtures.events],
    ["Lineups", fixtures.lineups],
    ["Fixture stats", fixtures.statistics_fixtures],
    ["Player stats", fixtures.statistics_players],
    ["Standings", coverage.standings],
    ["Players", coverage.players],
    ["Top scorers", coverage.top_scorers],
    ["Top assists", coverage.top_assists],
    ["Top cards", coverage.top_cards],
    ["Predictions", coverage.predictions],
    ["Odds", coverage.odds],
    ["Injuries", coverage.injuries]
  ].map(([label, enabled]) => ({ label, enabled: Boolean(enabled) }));
}

function summarizeApiFootballFixture(fixture = {}) {
  return {
    id: fixture.fixture?.id || null,
    round: fixture.league?.round || "",
    date: fixture.fixture?.date || "",
    venue: fixture.fixture?.venue?.name || "",
    city: fixture.fixture?.venue?.city || "",
    status: fixture.fixture?.status?.short || "",
    home: fixture.teams?.home?.name || "",
    away: fixture.teams?.away?.name || "",
    score: `${fixture.goals?.home ?? 0}-${fixture.goals?.away ?? 0}`,
    events: fixture.events?.length || 0,
    lineups: fixture.lineups?.length || 0,
    fixtureStats: fixture.statistics?.length || 0,
    playerStatsTeams: fixture.players?.length || 0
  };
}

function summarizeApiFootballStandings(data) {
  const groups = data?.response?.[0]?.league?.standings || [];
  return groups.slice(0, 4).map((groupRows) => ({
    group: groupRows?.[0]?.group || "",
    leaders: (groupRows || []).slice(0, 4).map((row) => ({
      rank: row.rank,
      team: row.team?.name || "",
      points: row.points ?? 0,
      played: row.all?.played ?? 0,
      goalsFor: row.all?.goals?.for ?? 0,
      goalsAgainst: row.all?.goals?.against ?? 0,
      goalDifference: row.goalsDiff ?? 0,
      form: row.form || ""
    }))
  }));
}

function summarizeApiFootballScorers(data) {
  return (data?.response || []).slice(0, 6).map((row) => ({
    player: row.player?.name || "",
    photo: row.player?.photo || "",
    team: row.statistics?.[0]?.team?.name || "",
    goals: row.statistics?.[0]?.goals?.total ?? 0,
    assists: row.statistics?.[0]?.goals?.assists ?? 0,
    rating: row.statistics?.[0]?.games?.rating || ""
  }));
}

async function probeApiFootball() {
  if (!API_FOOTBALL_KEY) {
    return { status: "missing_key", ok: false, plan: "not_configured", requests: null };
  }
  try {
    const result = await fetchJsonWithHeaders(`${API_FOOTBALL_BASE}/status`, apiFootballHeaders(), { ttl: 1000 * 60 * 10 });
    return {
      status: result.status,
      ok: true,
      plan: result.data?.response?.subscription?.plan || "unknown",
      requests: result.data?.response?.requests || null
    };
  } catch (error) {
    return { status: "unreachable", ok: false, plan: "unknown", requests: null, detail: error.message };
  }
}

async function fetchApiFootball(path, options = {}) {
  if (!API_FOOTBALL_KEY) return null;
  const result = await fetchJsonWithHeaders(`${API_FOOTBALL_BASE}${path}`, apiFootballHeaders(), options);
  return result.data;
}

async function getApiFootballWorldCupOverview() {
  return onceInFlight("api-football:worldcup", async () => {
    const cached = cache.get("api-football:worldcup");
    if (cached && Date.now() - cached.at < 1000 * 60 * 10) return cached.value;

    const status = await probeApiFootball();
    if (!status.ok) {
      return {
        provider: "API-SPORTS API-Football",
        connected: false,
        status: status.status,
        plan: status.plan,
        requests: status.requests,
        activeSeason: 2026,
        fallbackSeason: 2022,
        lockedReason: status.status === "missing_key" ? "API_FOOTBALL_KEY is not configured" : "Credential probe failed",
        coverage: [],
        endpoints: [],
        examples: {},
        predictionLeverage: []
      };
    }

    const league = await fetchApiFootball("/leagues?id=1", { ttl: 1000 * 60 * 60 });
    const worldCup = league?.response?.[0] || {};
    const season2026 = (worldCup.seasons || []).find((season) => Number(season.year) === 2026) || {};
    const coverage = apiFootballCoverageFlags(season2026.coverage || {});
    const activeFixtures = await fetchApiFootball("/fixtures?league=1&season=2026", { ttl: 1000 * 60 * 10 }).catch((error) => ({
      errors: { request: error.message },
      results: 0,
      response: []
    }));
    await delay(120);
    const activeError = apiFootballErrorLabel(activeFixtures?.errors);
    const fallbackFixtures = await fetchApiFootball("/fixtures?league=1&season=2022", { ttl: 1000 * 60 * 60 }).catch(() => null);
    await delay(120);
    const fallbackStandings = await fetchApiFootball("/standings?league=1&season=2022", { ttl: 1000 * 60 * 60 }).catch(() => null);
    await delay(120);
    const fallbackScorers = await fetchApiFootball("/players/topscorers?league=1&season=2022", { ttl: 1000 * 60 * 60 }).catch(() => null);

    const endpointRows = [
      ["2026 fixtures", activeFixtures],
      ["2026 teams", activeError ? { errors: activeFixtures?.errors, results: 0 } : { results: 0 }],
      ["2026 standings", activeError ? { errors: activeFixtures?.errors, results: 0 } : { results: 0 }],
      ["2022 fixtures fallback", fallbackFixtures],
      ["2022 standings fallback", fallbackStandings],
      ["2022 top scorers fallback", fallbackScorers]
    ].map(([label, payload]) => ({
      label,
      results: Number(payload?.results || 0),
      status: apiFootballErrorLabel(payload?.errors) ? "locked" : "available",
      note: apiFootballErrorLabel(payload?.errors)
    }));

    const examples = {
      fixtures: (fallbackFixtures?.response || []).slice(0, 5).map(summarizeApiFootballFixture),
      standings: summarizeApiFootballStandings(fallbackStandings),
      topScorers: summarizeApiFootballScorers(fallbackScorers)
    };

    const value = {
      provider: "API-SPORTS API-Football",
      connected: true,
      status: status.status,
      plan: status.plan,
      requests: status.requests,
      activeSeason: 2026,
      fallbackSeason: 2022,
      lockedReason: activeError || "",
      league: {
        id: worldCup.league?.id || 1,
        name: (worldCup.league?.name || "WORLDCUP").replace(/World Cup/g, "WORLDCUP"),
        logo: worldCup.league?.logo || ""
      },
      coverage,
      endpoints: endpointRows,
      examples,
      predictionLeverage: [
        "Use fixture events and lineups as live priors once the credential has 2026 season access.",
        "Blend API-Football predictions as an external model vote, then measure disagreement against Signal Room QIP.",
        "Use player ratings, cards, top scorers, and injury fields to adjust finishing, discipline, and lineup volatility.",
        "Use historical 2022 fixtures as a calibration benchmark for goal totals, upset rate, and knockout tempo."
      ]
    };
    cache.set("api-football:worldcup", { at: Date.now(), value });
    return value;
  });
}

async function handleApi(req, res, url) {
  try {
    refreshCacheForToken(url.searchParams.get("refresh"));

    if (url.pathname === "/api/sources") {
      const [competitions, worldcupRepo, squads, resultArchive, espnProbe, bdl, apiFootball, footballData] = await Promise.all([
        fetchJson(`${STATSBOMB_BASE}/competitions.json`, { ttl: CACHE_MS, timeoutMs: 2500 }).catch(() => ({ data: [] })),
        getWorldcupRepoData(),
        getSquads(),
        getResultArchive(),
        probeJson(`${ESPN_BASE}/scoreboard?dates=${todayDateKey()}&limit=100`),
        probeBallDontLie(),
        probeApiFootball(),
        probeJson("https://api.football-data.org/v4/competitions/WC/matches")
      ]);

      const wcCompetitions = competitions.data.filter((item) =>
        /World Cup/i.test(item.competition_name)
      );

      jsonResponse(res, 200, {
        generatedAt: new Date().toISOString(),
        sources: [
          {
            id: "rezarahiminia-worldcup2026",
            name: "rezarahiminia/worldcup2026",
            access: "open_source_git",
            status: "connected",
            pulled: {
              games: worldcupRepo.games.length,
              teams: worldcupRepo.teams.length,
              stadiums: worldcupRepo.stadiums.length,
              groups: worldcupRepo.groups.length
            },
            fields: ["fixtures", "teams", "groups", "stadiums", "score/status fields"],
            freshness: "local git clone"
          },
          {
            id: "signal-room-result-archive",
            name: "Signal Room result archive",
            access: "curated_local",
            status: resultArchive.length ? "connected" : "locked",
            pulled: { results: resultArchive.length },
            fields: ["completed match scores", "final status", "result source", "QIP calibration truth"],
            freshness: "momentum plot archive fallback"
          },
          {
            id: "fifa-squad-pdf",
            name: "FIFA official squad PDF",
            access: "public_pdf",
            status: "connected",
            pulled: { teams: squads.teamCount, players: squads.playerCount },
            fields: ["player names", "shirt numbers", "positions", "DOB", "clubs", "height", "caps", "goals", "coaches"],
            freshness: "official tournament squad list"
          },
          {
            id: "espn-public-api",
            name: "ESPN public soccer API",
            access: "public_undocumented",
            status: espnProbe.ok ? "connected" : "blocked",
            pulled: {},
            fields: ["scoreboard", "summary", "odds", "broadcasts", "news", "standings", "team stats"],
            freshness: "live public endpoint"
          },
          {
            id: "statsbomb-open-data",
            name: "StatsBomb Open Data",
            access: "public",
            status: "connected",
            pulled: {
              competitions: competitions.data.length,
              worldCupSeasons: wcCompetitions.length
            },
            fields: ["competitions", "matches", "events", "lineups", "360 freeze frames"],
            freshness: "historical"
          },
          {
            id: "expert-media-rss",
            name: "Expert media pulse",
            access: "public_rss",
            status: "connected",
            pulled: {},
            fields: ["prediction headlines", "preview notes", "team news", "predicted lineups", "source sentiment"],
            freshness: "live on refresh via Google News RSS and ESPN news metadata"
          },
          {
            id: "balldontlie-fifa",
            name: "BALLDONTLIE FIFA API",
            access: "api_key",
            status: bdl.ok ? "connected" : bdl.status === "missing_key" ? "locked" : "blocked",
            pulled: {},
            fields: ["matches", "players", "rosters", "lineups", "events", "shots", "stats", "match momentum", "average positions"],
            freshness: bdl.ok ? "credentialed live feed" : `auth status ${bdl.status}`
          },
          {
            id: "api-football",
            name: "API-SPORTS API-Football",
            access: "api_key",
            status: apiFootball.ok ? "connected" : apiFootball.status === "missing_key" ? "locked" : "blocked",
            pulled: {},
            fields: ["WORLDCUP coverage metadata", "fixtures", "standings", "teams", "lineups", "events", "player stats", "top scorers", "predictions", "odds"],
            freshness: apiFootball.ok ? `${apiFootball.plan} plan credential` : `auth status ${apiFootball.status}`
          },
          {
            id: "football-data",
            name: "football-data.org",
            access: "api_key",
            status: footballData.status === 403 || footballData.status === 401 ? "locked" : footballData.ok ? "connected" : "blocked",
            pulled: {},
            fields: ["fixtures", "scores", "standings"],
            freshness: "live with key"
          },
          {
            id: "opta-stats-perform",
            name: "Opta / Stats Perform",
            access: "commercial_license",
            status: "licensed_only",
            pulled: {},
            fields: ["XY events", "metadata", "live match feeds", "official WORLDCUP data"],
            freshness: "live licensed"
          }
        ]
      });
      return;
    }

    if (url.pathname === "/api/api-football/worldcup") {
      const overview = await getApiFootballWorldCupOverview();
      jsonResponse(res, 200, overview);
      return;
    }

    if (url.pathname === "/api/ball-dont-lie/status") {
      const status = await probeBallDontLie();
      jsonResponse(res, 200, {
        provider: "BALLDONTLIE FIFA API",
        connected: status.ok,
        status: status.status,
        credentialGate: status.ok ? "connected" : status.status === "missing_key" ? "not_configured" : "blocked",
        fieldsWhenConnected: [
          "teams",
          "stadiums",
          "group standings",
          "matches",
          "odds",
          "players",
          "injuries",
          "rosters",
          "lineups",
          "events",
          "player match stats",
          "team match stats",
          "shots",
          "momentum",
          "best players",
          "average positions",
          "team form"
        ]
      });
      return;
    }

    if (url.pathname === "/api/ball-dont-lie/overview") {
      const overview = await getBallDontLieOverview();
      jsonResponse(res, 200, {
        provider: "BALLDONTLIE FIFA API",
        ...summarizeBallDontLieOverview(overview)
      });
      return;
    }

    if (url.pathname === "/api/worldcup26") {
      const repo = await getWorldcupRepoData();
      jsonResponse(res, 200, {
        fetchedAt: new Date().toISOString(),
        source: repo.repo,
        commit: repo.commit,
        resultArchive: repo.resultArchive,
        games: repo.games,
        teams: repo.teams,
        groups: repo.groups,
        stadiums: repo.stadiums
      });
      return;
    }

    if (url.pathname === "/api/squads") {
      const squads = await getSquads();
      jsonResponse(res, 200, squads);
      return;
    }

    if (url.pathname === "/api/signal-day") {
      const dateKey = normalizeDateKey(url.searchParams.get("date"));
      const day = await buildSignalDay(dateKey);
      const bdl = await getBallDontLieOverview();
      day.ballDontLie = summarizeBallDontLieOverview(bdl);
      if (bdl.connected) day.sources.push("BALLDONTLIE FIFA API");
      jsonResponse(res, 200, day);
      return;
    }

    if (url.pathname === "/api/signals") {
      const dateKey = normalizeDateKey(url.searchParams.get("date"));
      const signals = await buildSignals(dateKey);
      jsonResponse(res, 200, signals);
      return;
    }

    if (url.pathname === "/api/knockout") {
      const dateKey = normalizeDateKey(url.searchParams.get("date"));
      const mode = url.searchParams.get("mode") === "known" ? "known" : "signal";
      const knockout = await buildKnockoutProjection(dateKey, mode);
      jsonResponse(res, 200, knockout);
      return;
    }

    if (url.pathname === "/api/team-room") {
      const dateKey = normalizeDateKey(url.searchParams.get("date"));
      const teamName = url.searchParams.get("team");
      if (!teamName) {
        badRequest(res, "team is required");
        return;
      }

      const [day, squads, news] = await Promise.all([
        buildSignalDay(dateKey),
        getSquads(),
        fetchGoogleNews(`${teamName} World Cup 2026 preview prediction squad`, 8).catch(() => [])
      ]);
      const squad = findSquad(squads, teamName);
      const match = day.matches.find((item) =>
        teamKey(item.home) === teamKey(teamName) || teamKey(item.away) === teamKey(teamName)
      ) || null;
      const opponentName = match ? (teamKey(match.home) === teamKey(teamName) ? match.away : match.home) : null;
      const opponentSquad = opponentName ? findSquad(squads, opponentName) : null;
      const profile = squadStats(squad);
      const teamLineup = match ? findLineup(match.summary, squad?.team || teamName) : null;
      const insights = enhancePlayersWithMedia(buildPlayerInsights(squad, opponentSquad), teamLineup);

      jsonResponse(res, 200, {
        fetchedAt: new Date().toISOString(),
        source: ["rezarahiminia/worldcup2026", "FIFA squad PDF", "ESPN public API", "Google News RSS"],
        team: squad?.team || teamName,
        code: squad?.code,
        coach: squad?.coach,
        profile,
        players: squad?.players || [],
        playerInsights: insights,
        todayMatch: match,
        liveSetup: teamLineup,
        expertMedia: match?.expertMedia || null,
        opponent: opponentName,
        news
      });
      return;
    }

    if (url.pathname === "/api/matchup-lab") {
      const squads = await getSquads();
      const dateKey = normalizeDateKey(url.searchParams.get("date"));
      const requestedHome = url.searchParams.get("home") || "Netherlands";
      const requestedAway = url.searchParams.get("away") || "Sweden";
      const homeSquad = findSquad(squads, requestedHome) || squads.teams[0];
      let awaySquad = findSquad(squads, requestedAway) || squads.teams.find((team) => teamKey(team.team) !== teamKey(homeSquad?.team));

      if (!homeSquad || !awaySquad) {
        jsonResponse(res, 404, { error: "Not enough squads available for matchup modeling" });
        return;
      }

      if (teamKey(homeSquad.team) === teamKey(awaySquad.team)) {
        awaySquad = squads.teams.find((team) => teamKey(team.team) !== teamKey(homeSquad.team));
      }

      if (!awaySquad) {
        badRequest(res, "Choose two different teams");
        return;
      }

      const match = {
        eventId: null,
        group: "Lab",
        localDate: null,
        gmt: null,
        home: homeSquad.team,
        away: awaySquad.team
      };
      const homeProfile = squadStats(homeSquad);
      const awayProfile = squadStats(awaySquad);
      const summary = buildMatchupSummary(match, homeSquad, awaySquad, homeProfile, awayProfile);
      const [expertMedia, news, liveFixture] = await Promise.all([
        fetchExpertMedia(match, summary, 12).catch(() => buildExpertSignal(match, [])),
        fetchGoogleNews(`${match.home} ${match.away} World Cup 2026 prediction preview squad news`, 10).catch(() => []),
        findLiveMatchForTeams(dateKey, match.home, match.away).catch(() => null)
      ]);
      const qipState = await getQipState(dateKey).catch(() => null);
      const prediction = buildPredictionModel(match, homeProfile, awayProfile, summary, expertMedia, qipState);
      prediction.label = expertMedia?.noteCount >= 3
        ? "Signal Room high-likelihood matchup model"
        : "Signal Room neutral matchup model";
      prediction.scorePrediction.basis = "FIFA squad history, projected scoring environment, and public expert-media sentiment";
      const liveSummary = liveFixture?.summary || null;
      const homeLineup = liveSummary ? findLineup(liveSummary, match.home) : null;
      const awayLineup = liveSummary ? findLineup(liveSummary, match.away) : null;

      jsonResponse(res, 200, {
        fetchedAt: new Date().toISOString(),
        source: ["FIFA squad PDF", "Signal Room scoring prior", ...(liveSummary?.archivedResult ? ["Signal Room result archive"] : []), "Google News RSS", "Expert media sentiment"],
        teams: squadTeamOptions(squads),
        match: { ...match, summary },
        squads: {
          home: homeSquad,
          away: awaySquad
        },
        profiles: {
          home: homeProfile,
          away: awayProfile
        },
        keyPlayers: {
          home: enhancePlayersWithMedia(buildPlayerInsights(homeSquad, awaySquad), homeLineup),
          away: enhancePlayersWithMedia(buildPlayerInsights(awaySquad, homeSquad), awayLineup)
        },
        uncommonInsights: buildUncommonInsights(match, homeSquad, awaySquad),
        prediction,
        assumptions: buildMatchupAssumptions(match, summary, prediction),
        liveScore: liveFixture?.liveScore || liveScoreFromSummary(null),
        lineups: {
          home: homeLineup,
          away: awayLineup
        },
        liveFixture: liveFixture ? {
          eventId: liveFixture.eventId,
          match: {
            home: liveFixture.summary?.home?.name,
            away: liveFixture.summary?.away?.name,
            gmt: gmtFromIso(liveFixture.summary?.date)
          }
        } : null,
        expertMedia,
        news
      });
      return;
    }

    if (url.pathname === "/api/match-room") {
      const dateKey = normalizeDateKey(url.searchParams.get("date"));
      const eventId = url.searchParams.get("eventId");
      const matchId = url.searchParams.get("matchId");
      const [day, squads] = await Promise.all([buildSignalDay(dateKey), getSquads()]);
      const match = day.matches.find((item) => matchId && String(item.matchId || "") === String(matchId))
        || day.matches.find((item) => eventId && item.eventId === eventId)
        || day.matches[0]
        || null;
      if (!match) {
        jsonResponse(res, 404, { error: "No match found" });
        return;
      }

      const summary = match.summary || (match.eventId ? compactSummary(await fetchEspnSummary(match.eventId)) : null);
      const homeSquad = findSquad(squads, match.home);
      const awaySquad = findSquad(squads, match.away);
      const homeProfile = squadStats(homeSquad);
      const awayProfile = squadStats(awaySquad);
      const expertMedia = await fetchExpertMedia(match, summary, 12).catch(() => match.expertMedia || buildExpertSignal(match, []));
      const qipState = await getQipState(dateKey).catch(() => null);
      const prediction = buildPredictionModel(match, homeProfile, awayProfile, summary, expertMedia, qipState);
      const news = await fetchGoogleNews(`${match.home} ${match.away} World Cup 2026 prediction preview odds`, 10).catch(() => []);
      const homeLineup = findLineup(summary, match.home);
      const awayLineup = findLineup(summary, match.away);

      jsonResponse(res, 200, {
        fetchedAt: new Date().toISOString(),
        source: ["rezarahiminia/worldcup2026", ...(summary?.archivedResult ? ["Signal Room result archive"] : []), "ESPN public API", "FIFA squad PDF", "Google News RSS", "OpenFootball cross-check", "Expert media sentiment"],
        match: { ...match, summary },
        squads: {
          home: homeSquad,
          away: awaySquad
        },
        profiles: {
          home: homeProfile,
          away: awayProfile
        },
        keyPlayers: {
          home: enhancePlayersWithMedia(buildPlayerInsights(homeSquad, awaySquad), homeLineup),
          away: enhancePlayersWithMedia(buildPlayerInsights(awaySquad, homeSquad), awayLineup)
        },
        uncommonInsights: buildUncommonInsights(match, homeSquad, awaySquad),
        prediction,
        liveScore: liveScoreFromSummary(summary),
        lineups: {
          home: homeLineup,
          away: awayLineup
        },
        expertMedia,
        market: summary?.odds || null,
        news
      });
      return;
    }

    if (url.pathname === "/api/statsbomb/competitions") {
      const result = await fetchJson(`${STATSBOMB_BASE}/competitions.json`);
      const worldCups = result.data
        .filter((item) => /World Cup/i.test(item.competition_name))
        .sort((a, b) => String(b.season_name).localeCompare(String(a.season_name)));
      jsonResponse(res, 200, { fetchedAt: result.fetchedAt, competitions: worldCups });
      return;
    }

    if (url.pathname === "/api/statsbomb/matches") {
      const competitionId = requireNumber(url.searchParams.get("competition_id"), "competition_id");
      const seasonId = requireNumber(url.searchParams.get("season_id"), "season_id");
      const result = await fetchJson(`${STATSBOMB_BASE}/matches/${competitionId}/${seasonId}.json`);
      const matches = result.data
        .map((match) => ({
          matchId: match.match_id,
          date: match.match_date,
          home: match.home_team?.home_team_name,
          away: match.away_team?.away_team_name,
          homeScore: match.home_score,
          awayScore: match.away_score,
          stadium: match.stadium?.name,
          competition: match.competition?.competition_name,
          season: match.season?.season_name,
          match
        }))
        .sort((a, b) => `${b.date}`.localeCompare(`${a.date}`));
      jsonResponse(res, 200, { fetchedAt: result.fetchedAt, matches });
      return;
    }

    if (url.pathname.startsWith("/api/statsbomb/match/")) {
      const matchId = requireNumber(url.pathname.split("/").pop(), "match_id");
      const matchParam = url.searchParams.get("match");
      const [events, lineups, frames] = await Promise.all([
        fetchJson(`${STATSBOMB_BASE}/events/${matchId}.json`),
        fetchJson(`${STATSBOMB_BASE}/lineups/${matchId}.json`),
        fetchJson(`${STATSBOMB_BASE}/three-sixty/${matchId}.json`).catch(() => ({
          fetchedAt: new Date().toISOString(),
          data: []
        }))
      ]);

      let match = {};
      if (matchParam) {
        try {
          match = JSON.parse(Buffer.from(matchParam, "base64url").toString("utf8"));
        } catch {
          match = {};
        }
      }

      jsonResponse(res, 200, {
        fetchedAt: events.fetchedAt,
        ...summarizeMatch(match, events.data, lineups.data, frames.data)
      });
      return;
    }

    if (url.pathname === "/api/momentum-images") {
      const images = [
        "Momentum.jpeg",
        "Momentum2.jpeg",
        "Momentum3.jpeg",
        "Momentum4.jpeg",
        "Momentum 6.jpeg",
        "Momentum 7.jpeg",
        "Momentum 8.jpeg"
      ];

      const available = [];
      for (const name of images) {
        try {
          const info = await stat(join(ROOT, name));
          available.push({
            name,
            src: `/momentum-images/${encodeURIComponent(name)}`,
            bytes: info.size
          });
        } catch {
          // Skip missing user-provided reference images.
        }
      }
      jsonResponse(res, 200, { images: available });
      return;
    }

    jsonResponse(res, 404, { error: "Unknown API route" });
  } catch (error) {
    if (/must be numeric/.test(error.message)) {
      badRequest(res, error.message);
      return;
    }

    jsonResponse(res, error.status || 500, {
      error: error.message,
      detail: error.detail
    });
  }
}

async function serveFile(req, res, url) {
  let filePath = null;
  if (url.pathname.startsWith("/momentum-images/")) {
    filePath = imagePathFromUrl(url.pathname);
  } else {
    filePath = safePathFromUrl(url.pathname);
  }

  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(body);
  } catch {
    if (!url.pathname.includes(".")) {
      const index = await readFile(join(PUBLIC_DIR, "index.html"));
      res.writeHead(200, {
        "content-type": mimeTypes[".html"],
        "cache-control": "no-store"
      });
      res.end(index);
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  }
}

export async function appHandler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type"
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url);
    return;
  }

  await serveFile(req, res, url);
}

export default appHandler;

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] || "")) {
  const server = createServer(appHandler);
  server.listen(PORT, () => {
    console.log(`WORLDCUP dashboard running at http://localhost:${PORT}`);
  });
}
