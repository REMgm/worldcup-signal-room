import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 4173);
const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PUBLIC_DIR = join(ROOT, "public");
const SQUADS_PATH = join(ROOT, "data", "squads-2026.json");
const REZA_REPO_DIR = join(ROOT, "data", "worldcup-source");
const REZA_RAW_BASE = "https://raw.githubusercontent.com/rezarahiminia/worldcup2026/main";
const STATSBOMB_BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data";
const WORLDCUP26_BASE = "https://worldcup26.ir/get";
const OPENFOOTBALL_2026 = "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world";
const BALLDONTLIE_BASE = "https://api.balldontlie.io/fifa/worldcup/v1";
const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY || "";

const cache = new Map();
const CACHE_MS = 1000 * 60 * 10;

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

async function fetchJson(url, options = {}) {
  const key = url;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < (options.ttl ?? CACHE_MS)) {
    return { ...cached.value, cached: true };
  }

  const response = await fetch(url, {
    headers: {
      "accept": "application/json,text/plain,*/*",
      "user-agent": "WorldCupMomentumDashboard/1.0"
    }
  });

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

  const response = await fetch(url, {
    headers: {
      "accept": "application/json,text/plain,*/*",
      "user-agent": "WorldCupMomentumDashboard/1.0",
      ...headers
    }
  });

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

  const response = await fetch(url, {
    headers: { "user-agent": "WorldCupMomentumDashboard/1.0" }
  });

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

function gmtLabel(date) {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day} ${GMT_MONTHS[date.getUTCMonth()]}, ${hour}:${minute} GMT`;
}

function gmtFromIso(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    iso: date.toISOString(),
    time: date.toISOString().slice(11, 16),
    label: gmtLabel(date)
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

function scorePrediction(match, probabilities, summary, confidence) {
  const totalGoals = clamp(Number(summary?.odds?.overUnder || 2.5), 1.5, 4.5);
  const homeWin = Number(probabilities.home || 0);
  const awayWin = Number(probabilities.away || 0);
  const draw = Number(probabilities.draw || 0);
  const edge = clamp((homeWin - awayWin) / 100, -0.58, 0.58);
  const confidenceBoost = clamp(Number(confidence || 0) / 100, 0, 0.5);
  let homeXg = totalGoals * clamp(0.5 + edge * 0.55 + confidenceBoost * Math.sign(edge) * 0.05, 0.22, 0.78);
  let awayXg = Math.max(0.15, totalGoals - homeXg);
  let homeGoals = clamp(Math.round(homeXg), 0, 5);
  let awayGoals = clamp(Math.round(awayXg), 0, 5);
  const winner = homeWin >= awayWin && homeWin >= draw ? "home" : awayWin >= draw ? "away" : "draw";

  if (winner === "home" && homeGoals <= awayGoals) homeGoals = Math.min(5, awayGoals + 1);
  if (winner === "away" && awayGoals <= homeGoals) awayGoals = Math.min(5, homeGoals + 1);
  if (winner === "draw") {
    const drawGoals = totalGoals < 2.1 ? 0 : 1;
    homeGoals = drawGoals;
    awayGoals = drawGoals;
  }

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
    basis: "Blended win probability, total-goals market, live tournament signal",
    volatility: confidence >= 28 ? "medium" : "high"
  };
}

function buildPredictionModel(match, homeProfile, awayProfile, summary, expertSignal = null) {
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
  const weights = expert && !expertSignal?.usable
    ? scaleExpertWeight(predictionWeights(Boolean(market), true), 0.45)
    : predictionWeights(Boolean(market), Boolean(expert));
  const probabilities = weightedProbabilities([
    { probabilities: market, weight: weights.market },
    { probabilities: historicalModel, weight: weights.historicalSquad },
    { probabilities: liveModel, weight: weights.liveTournament },
    { probabilities: expert, weight: weights.expertMedia }
  ]);
  const favorite =
    probabilities.home >= probabilities.away && probabilities.home >= probabilities.draw
      ? match.home
      : probabilities.away >= probabilities.draw
        ? match.away
        : "Draw";
  const confidence = clamp(Math.max(probabilities.home, probabilities.draw, probabilities.away) - 33.3, 0, 66.7);
  const score = scorePrediction(match, probabilities, summary, confidence);
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
    edges
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
    { ttl: 1000 * 60 * 12 }
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

async function readWorldcupSourceFile(filename) {
  try {
    const result = await fetchJson(`${REZA_RAW_BASE}/${filename}`, { ttl: CACHE_MS });
    return result.data;
  } catch {
    return readJsonFile(join(REZA_REPO_DIR, filename));
  }
}

async function getWorldcupRepoData() {
  const key = "local:rezarahiminia-worldcup2026";
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const [matches, teams, stadiums, groups, openFootball] = await Promise.all([
    readWorldcupSourceFile("football.matches.json"),
    readWorldcupSourceFile("football.teams.json"),
    readWorldcupSourceFile("football.stadiums.json"),
    readWorldcupSourceFile("football.matchtables.json"),
    fetchJson(OPENFOOTBALL_2026, { ttl: CACHE_MS }).catch(() => ({ data: { matches: [] } }))
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
    const gmt = openFootballMatch ? gmtFromOpenFootball(openFootballMatch.date, openFootballMatch.time) : null;
    return {
      ...match,
      home_team_name_en: homeTeam?.name_en,
      away_team_name_en: awayTeam?.name_en,
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
  if (!event?.id) return null;
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
    keys.map((key) => fetchJson(`${ESPN_BASE}/scoreboard?dates=${key}&limit=100`, { ttl: 1000 * 60 * 3 }).catch(() => ({ data: { events: [] } })))
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

async function buildSignalDay(dateKey = "20260620") {
  const [openFootball, worldcupRepo, squads, espnEvents] = await Promise.all([
    fetchJson(OPENFOOTBALL_2026, { ttl: CACHE_MS }),
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
    const summary = compactSummary(summaries[index]);
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

  const matches = preparedMatches.map(({ match, event, summary, homeProfile, awayProfile, resolvedMatch }, index) => {
    const gmt = gmtFromIso(summary?.date) || gmtFromOpenFootball(match.date, match.openFootballCrossCheck?.time);
    const expertMedia = expertSignals[index];
    const predictionModel = buildPredictionModel(resolvedMatch, homeProfile, awayProfile, summary, expertMedia);
    return {
      source: {
        schedule: "rezarahiminia/worldcup2026",
        crossCheck: match.openFootballCrossCheck ? "OpenFootball matched" : "OpenFootball not matched",
        live: event ? "ESPN public API" : "not mapped",
        expertMedia: expertMedia.noteCount ? "Google News RSS + ESPN news" : "not enough media notes"
      },
      eventId: event?.id || null,
      group: match.group || null,
      localDate: match.date || localDate,
      localTime: match.time || "",
      gmt,
      gmtTime: gmt?.time || "",
      home: resolvedMatch.home,
      away: resolvedMatch.away,
      summary,
      liveScore: liveScoreFromSummary(summary),
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
    sources: ["rezarahiminia/worldcup2026", "ESPN public API", "OpenFootball", "FIFA squad PDF", "Google News RSS", "Expert media sentiment"]
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
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "WorldCupMomentumDashboard/1.0" }
    });
    return { status: response.status, ok: response.ok };
  } catch (error) {
    return { status: "unreachable", ok: false, detail: error.message };
  }
}

async function probeBallDontLie() {
  if (!BALLDONTLIE_API_KEY) {
    return { status: "missing_key", ok: false };
  }
  try {
    const response = await fetch(`${BALLDONTLIE_BASE}/teams?seasons[]=2026&per_page=1`, {
      headers: {
        "accept": "application/json",
        "user-agent": "WorldCupMomentumDashboard/1.0",
        "Authorization": BALLDONTLIE_API_KEY
      }
    });
    return { status: response.status, ok: response.ok };
  } catch (error) {
    return { status: "unreachable", ok: false, detail: error.message };
  }
}

async function fetchBallDontLie(path, fallback = null) {
  if (!BALLDONTLIE_API_KEY) return fallback;
  try {
    const separator = path.includes("?") ? "&" : "?";
    const url = `${BALLDONTLIE_BASE}${path}${separator}seasons[]=2026`;
    const result = await fetchJsonWithHeaders(url, { Authorization: BALLDONTLIE_API_KEY }, { ttl: 1000 * 60 * 3 });
    return result.data;
  } catch {
    return fallback;
  }
}

async function getBallDontLieOverview() {
  if (!BALLDONTLIE_API_KEY) {
    return { status: "missing_key", connected: false, data: null };
  }
  const status = await probeBallDontLie();
  if (!status.ok) {
    return { status: status.status, connected: false, data: null };
  }
  const [matches, teams, players, standings] = await Promise.all([
    fetchBallDontLie("/matches?per_page=100"),
    fetchBallDontLie("/teams?per_page=100"),
    fetchBallDontLie("/players?per_page=100"),
    fetchBallDontLie("/group_standings?per_page=100")
  ]);
  return {
    status: status.status,
    connected: true,
    data: { matches, teams, players, standings }
  };
}

async function handleApi(req, res, url) {
  try {
    if (url.searchParams.has("refresh")) {
      cache.clear();
    }

    if (url.pathname === "/api/sources") {
      const [competitions, worldcupRepo, squads, espnProbe, bdl, footballData] = await Promise.all([
        fetchJson(`${STATSBOMB_BASE}/competitions.json`, { ttl: CACHE_MS }),
        getWorldcupRepoData(),
        getSquads(),
        probeJson(`${ESPN_BASE}/scoreboard?dates=20260620&limit=100`),
        probeBallDontLie(),
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
            fields: ["XY events", "metadata", "live match feeds", "official World Cup data"],
            freshness: "live licensed"
          }
        ]
      });
      return;
    }

    if (url.pathname === "/api/ball-dont-lie/status") {
      const status = await probeBallDontLie();
      jsonResponse(res, 200, {
        provider: "BALLDONTLIE FIFA API",
        hasKey: Boolean(BALLDONTLIE_API_KEY),
        connected: status.ok,
        status: status.status,
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
      jsonResponse(res, overview.connected ? 200 : 401, {
        provider: "BALLDONTLIE FIFA API",
        ...overview
      });
      return;
    }

    if (url.pathname === "/api/worldcup26") {
      const repo = await getWorldcupRepoData();
      jsonResponse(res, 200, {
        fetchedAt: new Date().toISOString(),
        source: repo.repo,
        commit: repo.commit,
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
      const dateKey = url.searchParams.get("date") || "20260620";
      const day = await buildSignalDay(dateKey);
      const bdl = await getBallDontLieOverview();
      day.ballDontLie = {
        connected: bdl.connected,
        status: bdl.status,
        available: bdl.connected ? Object.fromEntries(
          Object.entries(bdl.data || {}).map(([key, value]) => [key, Array.isArray(value?.data) ? value.data.length : Array.isArray(value) ? value.length : 0])
        ) : {}
      };
      if (bdl.connected) day.sources.push("BALLDONTLIE FIFA API");
      jsonResponse(res, 200, day);
      return;
    }

    if (url.pathname === "/api/team-room") {
      const dateKey = url.searchParams.get("date") || "20260620";
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
      const dateKey = url.searchParams.get("date") || "20260620";
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
      const prediction = buildPredictionModel(match, homeProfile, awayProfile, summary, expertMedia);
      prediction.label = expertMedia?.noteCount >= 3
        ? "Signal Room high-likelihood matchup model"
        : "Signal Room neutral matchup model";
      prediction.scorePrediction.basis = "FIFA squad history, projected scoring environment, and public expert-media sentiment";
      const liveSummary = liveFixture?.summary || null;
      const homeLineup = liveSummary ? findLineup(liveSummary, match.home) : null;
      const awayLineup = liveSummary ? findLineup(liveSummary, match.away) : null;

      jsonResponse(res, 200, {
        fetchedAt: new Date().toISOString(),
        source: ["FIFA squad PDF", "Signal Room scoring prior", "Google News RSS", "Expert media sentiment"],
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
      const dateKey = url.searchParams.get("date") || "20260620";
      const eventId = url.searchParams.get("eventId");
      const [day, squads] = await Promise.all([buildSignalDay(dateKey), getSquads()]);
      const match = day.matches.find((item) => item.eventId === eventId) || day.matches[0] || null;
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
      const prediction = buildPredictionModel(match, homeProfile, awayProfile, summary, expertMedia);
      const news = await fetchGoogleNews(`${match.home} ${match.away} World Cup 2026 prediction preview odds`, 10).catch(() => []);
      const homeLineup = findLineup(summary, match.home);
      const awayLineup = findLineup(summary, match.away);

      jsonResponse(res, 200, {
        fetchedAt: new Date().toISOString(),
        source: ["rezarahiminia/worldcup2026", "ESPN public API", "FIFA squad PDF", "Google News RSS", "OpenFootball cross-check", "Expert media sentiment"],
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
    console.log(`World Cup dashboard running at http://localhost:${PORT}`);
  });
}
