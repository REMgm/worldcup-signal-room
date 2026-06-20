const state = {
  sources: null,
  worldcup26: null,
  signalDay: null,
  teamRoom: null,
  matchRoom: null,
  competitions: [],
  matches: [],
  activeMatch: null
};

const API_BASE = window.location.protocol === "file:" ? "http://localhost:4173" : "";
const DEFAULT_DATE = "20260620";
const GMT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function setStatus(text, mode = "") {
  const node = $("#refreshStatus");
  node.textContent = text;
  node.dataset.mode = mode;
}

async function getJson(url, options = {}) {
  const requestUrl = withRefresh(url, options.refreshToken);
  const response = await fetch(`${API_BASE}${requestUrl}`, {
    cache: options.refreshToken ? "no-store" : "default"
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed ${response.status}`);
  }
  return response.json();
}

function withRefresh(url, refreshToken) {
  if (!refreshToken) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}refresh=${encodeURIComponent(refreshToken)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "TBD";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

function formatGMT(value) {
  if (!value) return "TBD GMT";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBD GMT";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day} ${GMT_MONTHS[date.getUTCMonth()]}, ${hour}:${minute} GMT`;
}

function matchGmtLabel(match) {
  return match?.gmt?.label || (match?.summary?.date ? formatGMT(match.summary.date) : "TBD GMT");
}

function matchSignature(match) {
  return [match?.home, match?.away, match?.localDate || match?.summary?.date || ""]
    .filter(Boolean)
    .join("|")
    .toLowerCase();
}

function captureSelection() {
  const favoriteSelect = $("#favoriteTeamSelect");
  const matchSelect = $("#todayMatchSelect");
  const matchOption = matchSelect?.selectedOptions?.[0];
  return {
    favoriteTeam: favoriteSelect?.value || state.teamRoom?.team || "",
    matchValue: matchOption?.value || state.matchRoom?.match?.eventId || "",
    matchSignature: matchOption?.dataset?.signature || matchSignature(state.matchRoom?.match)
  };
}

function selectPreferredOption(select, preferredValue, preferredSignature = "") {
  const options = [...select.options];
  const exactValueIsStable = preferredValue && !String(preferredValue).startsWith("index-");
  const target = (exactValueIsStable ? options.find((option) => option.value === preferredValue) : null)
    || options.find((option) => preferredSignature && option.dataset.signature === preferredSignature)
    || options.find((option) => option.value === preferredValue);
  if (target) {
    select.value = target.value;
  } else if (options.length) {
    select.selectedIndex = 0;
  }
}

function switchView(id) {
  $$(".tab").forEach((item) => item.classList.toggle("active", item.dataset.view === id));
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === id));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderMetrics() {
  const grid = $("#metricGrid");
  const template = $("#metricTemplate");
  const games = state.worldcup26?.games || [];
  const teams = state.worldcup26?.teams || [];
  const stadiums = state.worldcup26?.stadiums || [];
  const connected = state.sources?.sources?.filter((source) => source.status === "connected").length || 0;
  const todayMatches = state.signalDay?.matches?.length || 0;
  const metrics = [
    ["Today", todayMatches, "match intelligence rooms"],
    ["Tournament", games.length, "GitHub-sourced fixtures"],
    ["Official squads", teams.length * 26, "FIFA player records"],
    ["Connected feeds", connected, `${stadiums.length} venue records`]
  ];

  grid.replaceChildren(...metrics.map(([label, value, detail]) => {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector("p").textContent = label;
    node.querySelector("strong").textContent = formatNumber(value);
    node.querySelector("span").textContent = detail;
    return node;
  }));
}

function renderSourceTicker() {
  const ticker = $("#sourceTicker");
  const sources = state.sources?.sources || [];
  const connected = sources.filter((source) => source.status === "connected").length;
  const locked = sources.filter((source) => source.status === "locked" || source.status === "licensed_only").length;
  const fixtureCount = state.worldcup26?.games?.length || 0;
  const daySources = state.signalDay?.sources?.length || 0;
  const bdl = state.signalDay?.ballDontLie;
  const bdlText = bdl ? ` · BALLDONTLIE ${bdl.connected ? "connected" : `auth ${bdl.status}`}` : "";
  ticker.textContent = `${connected} connected feeds · ${fixtureCount} GitHub fixtures · ${daySources} signal sources · ${locked} credential gates${bdlText}`;
}

function renderControls(selection = {}) {
  const teams = state.signalDay?.teams || [];
  const matches = state.signalDay?.matches || [];
  const favoriteSelect = $("#favoriteTeamSelect");
  const matchSelect = $("#todayMatchSelect");

  favoriteSelect.replaceChildren(...teams.map((team) => {
    const option = document.createElement("option");
    option.value = team;
    option.textContent = team;
    return option;
  }));
  selectPreferredOption(favoriteSelect, selection.favoriteTeam);

  matchSelect.replaceChildren(...matches.map((match, index) => {
    const option = document.createElement("option");
    option.value = match.eventId || `index-${index}`;
    option.dataset.index = index;
    option.dataset.signature = matchSignature(match);
    option.textContent = `${match.home} vs ${match.away} · ${matchGmtLabel(match)}`;
    return option;
  }));
  selectPreferredOption(matchSelect, selection.matchValue, selection.matchSignature);
}

function renderFixtures() {
  const rows = $("#fixtureRows");
  const query = $("#fixtureSearch").value.trim().toLowerCase();
  const games = state.worldcup26?.games || [];
  const filtered = games.filter((game) => {
    const blob = [
      game.home_team_name_en,
      game.away_team_name_en,
      game.group,
      game.type,
      game.local_date,
      game.stadium_name,
      game.city_en
    ].join(" ").toLowerCase();
    return blob.includes(query);
  });

  rows.replaceChildren(...filtered.slice(0, 120).map((game) => {
    const tr = document.createElement("tr");
    const home = game.home_team_name_en || `Team ${game.home_team_id || ""}`.trim();
    const away = game.away_team_name_en || `Team ${game.away_team_id || ""}`.trim();
    const status = game.finished === "TRUE" || game.finished === true ? "Final" : game.time_elapsed || "Scheduled";
    const score = game.home_score !== null && game.away_score !== null && game.home_score !== undefined
      ? `<span class="score">${escapeHtml(game.home_score)}-${escapeHtml(game.away_score)}</span>`
      : "";
    tr.innerHTML = `
      <td>${escapeHtml(game.gmt?.label || "TBD GMT")}</td>
      <td class="match-cell">${escapeHtml(home)} ${score} ${escapeHtml(away)}<br><small>${escapeHtml(game.stadium_name || "")}</small></td>
      <td>${escapeHtml(game.group || game.type || "Group")}</td>
      <td>${escapeHtml(status)}</td>
    `;
    return tr;
  }));

  if (!filtered.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4" class="empty">No fixtures match the current filter.</td>`;
    rows.append(tr);
  }
}

function renderTodayMatches() {
  const grid = $("#todayMatchGrid");
  const matches = state.signalDay?.matches || [];
  grid.replaceChildren(...matches.map((match, index) => {
    const card = document.createElement("button");
    card.className = "today-card";
    card.type = "button";
    card.dataset.eventId = match.eventId || "";
    const prediction = match.predictionModel;
    const odds = match.summary?.odds;
    const expert = prediction?.components?.expertMedia || match.expertMedia;
    const homeProb = prediction?.probabilities?.home;
    const awayProb = prediction?.probabilities?.away;
    card.innerHTML = `
      <div class="today-card-top">
        <span>${escapeHtml(match.group ? `Group ${match.group}` : "Match")}</span>
        <strong>${escapeHtml(matchGmtLabel(match))}</strong>
      </div>
      <div class="team-line">
        ${match.summary?.home?.logo ? `<img src="${escapeHtml(match.summary.home.logo)}" alt="">` : ""}
        <b>${escapeHtml(match.home)}</b>
      </div>
      <div class="team-line">
        ${match.summary?.away?.logo ? `<img src="${escapeHtml(match.summary.away.logo)}" alt="">` : ""}
        <b>${escapeHtml(match.away)}</b>
      </div>
      <div class="today-card-meta">${escapeHtml(match.summary?.venue || match.githubMatch?.stadium_name || "")}</div>
      <div class="mini-prob">
        <span style="width:${homeProb || 50}%"></span>
        <i style="width:${awayProb || 50}%"></i>
      </div>
      <div class="today-card-meta">${prediction ? `Favorite: ${escapeHtml(prediction.favorite)} · ${escapeHtml(prediction.confidence)} confidence` : "Prediction data pending"}</div>
      <div class="today-card-meta">${odds ? `${escapeHtml(odds.provider || "Odds")} market blended with squad history` : "Historical squad model only"}</div>
      <div class="today-card-meta">${expert?.noteCount ? `Expert pulse: ${escapeHtml(expert.leanLabel || "No clear lean")} · ${escapeHtml(expert.noteCount)} notes` : "Expert pulse pending"}</div>
    `;
    card.addEventListener("click", async () => {
      $("#todayMatchSelect").selectedIndex = index;
      await loadMatchRoom();
      switchView("match-room");
    });
    return card;
  }));
}

function renderImages(images = []) {
  const grid = $("#referenceGrid");
  if (!images.length) {
    grid.innerHTML = `<div class="empty">No local reference images found.</div>`;
    return;
  }
  grid.replaceChildren(...images.map((image) => {
    const card = document.createElement("article");
    card.className = "reference-card";
    const src = image.src.startsWith("/") ? `${API_BASE}${image.src}` : image.src;
    card.innerHTML = `<img src="${escapeHtml(src)}" alt="${escapeHtml(image.name)}">`;
    return card;
  }));
}

function renderSources() {
  const grid = $("#sourceGrid");
  const generatedAt = state.sources?.generatedAt;
  $("#sourceTimestamp").textContent = generatedAt ? `Updated ${new Date(generatedAt).toLocaleString()}` : "Status";
  const sources = state.sources?.sources || [];
  grid.replaceChildren(...sources.map((source) => {
    const card = document.createElement("article");
    card.className = "source-card";
    const pulled = Object.entries(source.pulled || {})
      .map(([key, value]) => `${key}: ${formatNumber(value)}`)
      .join(" · ");
    card.innerHTML = `
      <span class="source-status ${escapeHtml(source.status)}">${escapeHtml(source.status.replaceAll("_", " "))}</span>
      <h3>${escapeHtml(source.name)}</h3>
      <p>${escapeHtml(source.access.replaceAll("_", " "))} · ${escapeHtml(source.freshness)}</p>
      <p>${escapeHtml(pulled || "No rows pulled without credentials")}</p>
      <ul>${source.fields.map((field) => `<li>${escapeHtml(field)}</li>`).join("")}</ul>
    `;
    return card;
  }));
}

function statCard(label, value, note = "") {
  return `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${note ? `<em>${escapeHtml(note)}</em>` : ""}</div>`;
}

function renderBars(items, colorClass = "") {
  const max = Math.max(1, ...items.map((item) => Number(item.value || item.count || 0)));
  return items.map((item) => {
    const value = Number(item.value ?? item.count ?? 0);
    return `
      <div class="bar-row ${colorClass}">
        <span>${escapeHtml(item.label || item.country || item.name)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, (value / max) * 100)}%"></div></div>
        <strong>${escapeHtml(item.display ?? value)}</strong>
      </div>
    `;
  }).join("");
}

function renderNews(items, target) {
  const node = $(target);
  const list = items || [];
  if (!list.length) {
    node.innerHTML = `<div class="empty">No news items pulled for this view.</div>`;
    return;
  }
  node.innerHTML = list.map((item) => `
    <a class="news-item" href="${escapeHtml(item.link)}" target="_blank" rel="noreferrer">
      <span>${escapeHtml(item.source || "Source")}</span>
      <strong>${escapeHtml(item.title || item.headline)}</strong>
      ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}
    </a>
  `).join("");
}

function renderExpertNotes(expertMedia) {
  const node = $("#expertNotes");
  if (!node) return;
  const notes = expertMedia?.notes || [];
  if (!notes.length) {
    node.innerHTML = `<div class="empty">No expert media notes pulled yet.</div>`;
    return;
  }
  node.innerHTML = `
    <div class="expert-summary">
      <span>${escapeHtml(expertMedia.leanLabel || "No clear lean")}</span>
      <b>${escapeHtml(expertMedia.confidence || 0)} sentiment</b>
      <em>${escapeHtml(expertMedia.noteCount || notes.length)} live notes · ${escapeHtml(expertMedia.sourceCount || 0)} sources</em>
    </div>
    <div class="expert-note-list">
      ${notes.map((item) => `
        <a class="expert-note ${escapeHtml(item.lean || "neutral")}" href="${escapeHtml(item.link || "#")}" target="_blank" rel="noreferrer">
          <span>${escapeHtml(item.source || "Expert media")} · ${escapeHtml(item.lean === "home" || item.lean === "away" ? "directional" : "neutral")}</span>
          <strong>${escapeHtml(item.title)}</strong>
          ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}
        </a>
      `).join("")}
    </div>
  `;
}

function renderPlayerCards(players, target, labelPrefix = "") {
  const node = $(target);
  const list = players || [];
  if (!list.length) {
    node.innerHTML = `<div class="empty">No player signals available.</div>`;
    return;
  }
  node.innerHTML = list.map((player) => `
    <article class="player-card">
      <div>
        <span>${escapeHtml(labelPrefix || player.position)} · #${escapeHtml(player.number || "")}</span>
        <strong>${escapeHtml(player.shirtName || player.playerName)}</strong>
      </div>
      <p>${escapeHtml(player.club || "")}</p>
      <div class="player-stats">
        <b>${escapeHtml(player.caps)} caps</b>
        <b>${escapeHtml(player.goals)} goals</b>
        <b>${escapeHtml(player.heightCm)} cm</b>
      </div>
      ${player.tags?.length ? `<div class="tag-row">${player.tags.map((tag) => `<i>${escapeHtml(tag)}</i>`).join("")}</div>` : ""}
    </article>
  `).join("");
}

function renderTeamRoom(data) {
  const match = data.todayMatch;
  $("#teamHero").innerHTML = `
    <div>
      <p class="eyebrow">Favorite Team Intelligence</p>
      <h2>${escapeHtml(data.team)}</h2>
      <p>${escapeHtml(data.code || "")} · Coach: ${escapeHtml(data.coach?.coachName || "TBA")}</p>
    </div>
    <div class="hero-score">
      <span>Today</span>
      <strong>${match ? `${escapeHtml(match.home)} vs ${escapeHtml(match.away)}` : "No match today"}</strong>
      <small>${escapeHtml(match ? matchGmtLabel(match) : "")} · ${escapeHtml(match?.summary?.venue || "")}</small>
    </div>
  `;

  const profile = data.profile || {};
  $("#teamProfile").innerHTML = [
    statCard("Players", profile.players || 0, "official squad"),
    statCard("Total Caps", profile.totalCaps || 0, "experience bank"),
    statCard("Total Goals", profile.totalGoals || 0, "international output"),
    statCard("Avg Height", `${profile.averageHeight || 0} cm`, "set-piece shape"),
    statCard("Avg Caps", profile.averageCaps || 0, "squad maturity"),
    statCard("Opponent", data.opponent || "TBA", "today's context")
  ].join("");

  const positions = Object.entries(profile.positions || {}).map(([label, value]) => ({ label, value }));
  const scorers = (profile.topScorers || []).map((player) => ({ label: player.shirtName || player.playerName, value: player.goals, display: player.goals }));
  const clubs = (profile.clubSpread || []).map((item) => ({ label: item.country, value: item.count, display: item.count }));
  $("#teamCharts").innerHTML = `
    <div class="chart-block"><h3>Position Mix</h3>${renderBars(positions)}</div>
    <div class="chart-block"><h3>Goal Sources</h3>${renderBars(scorers, "warm")}</div>
    <div class="chart-block"><h3>Club Country Spread</h3>${renderBars(clubs, "cool")}</div>
  `;

  renderPlayerCards(data.playerInsights, "#teamPlayers");
  renderNews(data.news, "#teamNews");
}

function renderPrediction(prediction, match = {}) {
  if (!prediction?.probabilities) {
    $("#predictionChart").innerHTML = `<div class="empty">No blended prediction available yet.</div>`;
    return;
  }
  const probs = prediction.probabilities;
  const items = [
    { label: match.home || "Home", value: probs.home, display: `${probs.home}%` },
    { label: "Draw", value: probs.draw, display: `${probs.draw}%` },
    { label: match.away || "Away", value: probs.away, display: `${probs.away}%` }
  ];
  $("#predictionChart").innerHTML = `
    <div class="probability-rings">
      ${items.map((item) => `
        <div class="prob-ring" style="--value:${item.value}">
          <strong>${escapeHtml(item.display)}</strong>
          <span>${escapeHtml(item.label)}</span>
        </div>
      `).join("")}
    </div>
    <div class="odds-strip">
      <b>${escapeHtml(prediction.label || "Signal Room model")}</b>
      <span>Favorite: ${escapeHtml(prediction.favorite)}</span>
      <span>Confidence ${escapeHtml(prediction.confidence)} pts</span>
    </div>
    <div class="model-sources">
      <span>Market ${escapeHtml(Math.round((prediction.components?.weights?.market || 0) * 100))}%</span>
      <span>Squad ${escapeHtml(Math.round((prediction.components?.weights?.historicalSquad || 0) * 100))}%</span>
      <span>Live ${escapeHtml(Math.round((prediction.components?.weights?.liveTournament || 0) * 100))}%</span>
      <span>Expert ${escapeHtml(Math.round((prediction.components?.weights?.expertMedia || 0) * 100))}%</span>
    </div>
    ${prediction.edges?.length ? `<div class="model-edges">${prediction.edges.map((edge) => `<p>${escapeHtml(edge)}</p>`).join("")}</div>` : ""}
  `;
}

function renderComparison(data) {
  const home = data.profiles?.home || {};
  const away = data.profiles?.away || {};
  const match = data.match || {};
  const rows = [
    ["Average caps", home.averageCaps, away.averageCaps],
    ["Squad goals", home.totalGoals, away.totalGoals],
    ["Average height", home.averageHeight, away.averageHeight],
    ["Total caps", home.totalCaps, away.totalCaps]
  ];
  const max = Math.max(1, ...rows.flatMap((row) => [Number(row[1] || 0), Number(row[2] || 0)]));
  $("#comparisonBars").innerHTML = rows.map(([label, homeValue, awayValue]) => `
    <div class="compare-row">
      <span>${escapeHtml(label)}</span>
      <div class="compare-track">
        <i style="width:${(Number(homeValue || 0) / max) * 100}%"></i>
        <b style="width:${(Number(awayValue || 0) / max) * 100}%"></b>
      </div>
      <small>${escapeHtml(match.home)} ${escapeHtml(homeValue || 0)} · ${escapeHtml(match.away)} ${escapeHtml(awayValue || 0)}</small>
    </div>
  `).join("");
}

function renderMatchRoom(data) {
  const match = data.match || {};
  const summary = match.summary || {};
  const score = data.prediction?.scorePrediction;
  $("#matchRoomHero").innerHTML = `
    <div class="match-side">
      ${summary.home?.logo ? `<img src="${escapeHtml(summary.home.logo)}" alt="">` : ""}
      <h2>${escapeHtml(match.home)}</h2>
      <span>${escapeHtml(summary.home?.abbreviation || "")}</span>
    </div>
    <div class="match-center">
      <p class="eyebrow">Match Deep Dive</p>
      <strong>${escapeHtml(matchGmtLabel(match))}</strong>
      ${score ? `
        <div class="score-prediction">
          <span>Score Prediction</span>
          <b>${escapeHtml(score.label)}</b>
          <small>May change as confidence grows throughout the game</small>
        </div>
      ` : ""}
      <span>${escapeHtml(summary.venue || match.githubMatch?.stadium_name || "")}</span>
      <small>${escapeHtml((summary.broadcasts || []).join(" · ") || "Broadcast TBA")}</small>
    </div>
    <div class="match-side away-side">
      ${summary.away?.logo ? `<img src="${escapeHtml(summary.away.logo)}" alt="">` : ""}
      <h2>${escapeHtml(match.away)}</h2>
      <span>${escapeHtml(summary.away?.abbreviation || "")}</span>
    </div>
  `;

  renderPrediction(data.prediction, match);
  renderComparison(data);
  $("#uncommonInsights").innerHTML = (data.uncommonInsights || []).length
    ? data.uncommonInsights.map((item) => `<article>${escapeHtml(item)}</article>`).join("")
    : `<div class="empty">No uncommon cross-source signals generated.</div>`;
  renderExpertNotes(data.expertMedia);

  const homePlayers = (data.keyPlayers?.home || []).slice(0, 5).map((player) => ({ ...player, tags: [`${match.home}`, ...(player.tags || [])] }));
  const awayPlayers = (data.keyPlayers?.away || []).slice(0, 5).map((player) => ({ ...player, tags: [`${match.away}`, ...(player.tags || [])] }));
  renderPlayerCards([...homePlayers, ...awayPlayers], "#matchPlayers");
  renderNews(data.news, "#matchNews");
}

function encodeMatch(match) {
  const json = JSON.stringify(match.match || {});
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function renderCompetitions() {
  const select = $("#competitionSelect");
  select.replaceChildren(...state.competitions.map((competition) => {
    const option = document.createElement("option");
    option.value = `${competition.competition_id}:${competition.season_id}`;
    option.textContent = `${competition.competition_name} · ${competition.season_name}`;
    option.dataset.competitionId = competition.competition_id;
    option.dataset.seasonId = competition.season_id;
    return option;
  }));
}

function renderMatches() {
  const select = $("#matchSelect");
  select.replaceChildren(...state.matches.map((match) => {
    const option = document.createElement("option");
    option.value = String(match.matchId);
    option.dataset.match = encodeMatch(match);
    option.textContent = `${match.date} · ${match.home} ${match.homeScore}-${match.awayScore} ${match.away}`;
    return option;
  }));
}

function areaPath(points, baseline) {
  if (!points.length) return "";
  const start = points[0];
  const end = points[points.length - 1];
  const path = [`M ${start.x} ${baseline}`];
  for (const point of points) path.push(`L ${point.x} ${point.y}`);
  path.push(`L ${end.x} ${baseline}`, "Z");
  return path.join(" ");
}

function renderMomentumChart(data) {
  const container = $("#momentumChart");
  const timeline = data.timeline || [];
  if (!timeline.length) {
    container.innerHTML = `<div class="empty">No timeline data available.</div>`;
    return;
  }

  const width = 1040;
  const height = 400;
  const margin = { top: 22, right: 22, bottom: 34, left: 52 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const baseline = margin.top + innerHeight / 2;
  const maxMinute = Math.max(95, ...timeline.map((item) => item.minute));
  const maxAbs = Math.max(0.025, ...timeline.map((item) => Math.abs(item.net)));
  const x = (minute) => margin.left + (minute / maxMinute) * innerWidth;
  const y = (net) => baseline - (net / maxAbs) * (innerHeight / 2 - 14);
  const homePoints = timeline.map((item) => ({ x: x(item.minute), y: y(Math.max(0, item.net)) }));
  const awayPoints = timeline.map((item) => ({ x: x(item.minute), y: y(Math.min(0, item.net)) }));
  const ticks = [0, 15, 30, 45, 60, 75, 90, maxMinute].filter((value, index, list) => list.indexOf(value) === index);
  const breakBands = [[22, 26, "WB"], [45, 50, "HT"], [67, 71, "WB"]].map(([start, end, label]) => {
    const bx = x(start);
    const bw = x(end) - bx;
    return `<rect class="break-band" x="${bx}" y="${margin.top}" width="${bw}" height="${innerHeight}"></rect>
      <text class="chart-label" x="${bx + bw / 2}" y="${margin.top + 26}" text-anchor="middle">${label}</text>`;
  }).join("");
  const goals = (data.goals || []).map((goal) => {
    const gx = x(goal.minute);
    const gy = goal.side === "home" ? margin.top + 28 : margin.top + innerHeight - 28;
    const color = goal.side === "home" ? "var(--home)" : "var(--away)";
    return `<circle class="goal-marker" cx="${gx}" cy="${gy}" r="10" stroke="${color}"></circle>
      <text class="chart-label" x="${gx}" y="${gy - 16}" text-anchor="middle">${goal.minute}'</text>`;
  }).join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Rolling momentum chart">
      ${breakBands}
      <line class="chart-axis" x1="${margin.left}" y1="${baseline}" x2="${width - margin.right}" y2="${baseline}"></line>
      <line class="chart-grid" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}"></line>
      ${ticks.map((tick) => `
        <line class="chart-grid" x1="${x(tick)}" y1="${baseline - 5}" x2="${x(tick)}" y2="${baseline + 5}"></line>
        <text class="chart-label" x="${x(tick)}" y="${height - 9}" text-anchor="middle">${tick}'</text>
      `).join("")}
      <text class="chart-label" x="10" y="${baseline - 104}">${escapeHtml(data.match.home)}</text>
      <text class="chart-label" x="10" y="${baseline + 112}">${escapeHtml(data.match.away)}</text>
      <text class="chart-label" x="10" y="${baseline + 4}">Balanced</text>
      <path class="home-area" d="${areaPath(homePoints, baseline)}"></path>
      <path class="away-area" d="${areaPath(awayPoints, baseline)}"></path>
      ${goals}
    </svg>
  `;
}

function renderMatchDetails(data) {
  $("#matchTitle").textContent = `${data.match.home} ${data.match.homeScore}-${data.match.awayScore} ${data.match.away}`;
  $("#matchSubtitle").textContent = `${data.match.date || ""} · ${data.match.competition || "StatsBomb"} ${data.match.season || ""}`.trim();
  $("#matchPullStatus").textContent = `Pulled ${new Date(data.fetchedAt).toLocaleString()}`;
  const stats = [
    ["Events", data.totals.events],
    ["360 frames", data.totals.frames360],
    [`${data.match.home} xG`, data.totals.homeXg],
    [`${data.match.away} xG`, data.totals.awayXg],
    ["Lineup players", data.totals.lineups],
    ["Goals", data.totals.goals]
  ];
  $("#matchStats").replaceChildren(...stats.map(([label, value]) => {
    const item = document.createElement("div");
    item.className = "stat";
    item.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>`;
    return item;
  }));
  const goals = data.goals || [];
  $("#goalList").replaceChildren(...(goals.length ? goals.map((goal) => {
    const item = document.createElement("div");
    item.className = "event-item";
    item.innerHTML = `<strong>${goal.minute}' ${escapeHtml(goal.team)}</strong><br>${escapeHtml(goal.player)} · xG ${goal.xg.toFixed(2)}`;
    return item;
  }) : [Object.assign(document.createElement("div"), { className: "empty", textContent: "No goals in this match." })]));
  const max = Math.max(1, ...(data.eventCounts || []).map((item) => item.count));
  $("#eventMix").replaceChildren(...(data.eventCounts || []).map((item) => {
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <span>${escapeHtml(item.name)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(item.count / max) * 100}%"></div></div>
      <strong>${escapeHtml(item.count)}</strong>
    `;
    return row;
  }));
  const fields = [
    ...(data.sourceFields.events || []).map((field) => `event.${field}`),
    ...(data.sourceFields.lineups || []).map((field) => `lineup.${field}`),
    ...(data.sourceFields.frames360 || []).map((field) => `360.${field}`)
  ];
  $("#fieldList").replaceChildren(...fields.map((field) => {
    const pill = document.createElement("span");
    pill.className = "field-pill";
    pill.textContent = field;
    return pill;
  }));
  renderMomentumChart(data);
}

async function loadWorldcup26(options = {}) {
  state.worldcup26 = await getJson("/api/worldcup26", options);
  renderMetrics();
  renderFixtures();
  renderSourceTicker();
}

async function loadSources(options = {}) {
  state.sources = await getJson("/api/sources", options);
  renderMetrics();
  renderSources();
  renderSourceTicker();
}

async function loadSignalDay(options = {}) {
  state.signalDay = await getJson(`/api/signal-day?date=${DEFAULT_DATE}`, options);
  renderControls(options.selection);
  renderTodayMatches();
  renderMetrics();
  renderSourceTicker();
}

async function loadTeamRoom(options = {}) {
  const team = $("#favoriteTeamSelect").value || state.signalDay?.teams?.[0];
  if (!team) return;
  state.teamRoom = await getJson(`/api/team-room?date=${DEFAULT_DATE}&team=${encodeURIComponent(team)}`, options);
  renderTeamRoom(state.teamRoom);
}

async function loadMatchRoom(options = {}) {
  const selected = $("#todayMatchSelect").selectedOptions[0];
  const eventId = selected?.value?.startsWith("index-") ? "" : selected?.value || "";
  state.matchRoom = await getJson(`/api/match-room?date=${DEFAULT_DATE}${eventId ? `&eventId=${encodeURIComponent(eventId)}` : ""}`, options);
  renderMatchRoom(state.matchRoom);
}

async function loadCompetitions(options = {}) {
  const result = await getJson("/api/statsbomb/competitions", options);
  state.competitions = result.competitions;
  renderCompetitions();
}

async function loadMatches(options = {}) {
  const selected = $("#competitionSelect").selectedOptions[0];
  if (!selected) return;
  const result = await getJson(`/api/statsbomb/matches?competition_id=${selected.dataset.competitionId}&season_id=${selected.dataset.seasonId}`, options);
  state.matches = result.matches;
  renderMatches();
  await loadActiveMatch(options);
}

async function loadActiveMatch(options = {}) {
  const selected = $("#matchSelect").selectedOptions[0];
  if (!selected) return;
  $("#matchPullStatus").textContent = "Pulling";
  const data = await getJson(`/api/statsbomb/match/${selected.value}?match=${selected.dataset.match}`, options);
  state.activeMatch = data;
  renderMatchDetails(data);
}

async function loadImages(options = {}) {
  const result = await getJson("/api/momentum-images", options);
  renderImages(result.images);
}

async function refreshAll(options = {}) {
  try {
    const selection = captureSelection();
    const refreshToken = options.force ? String(Date.now()) : "";
    const requestOptions = { refreshToken };
    const refreshButton = $("#refreshButton");
    refreshButton.disabled = true;
    setStatus(options.force ? "Pulling latest" : "Refreshing");
    await Promise.all([
      loadSources(requestOptions),
      loadWorldcup26(requestOptions),
      loadCompetitions(requestOptions),
      loadImages(requestOptions),
      loadSignalDay({ ...requestOptions, selection })
    ]);
    await Promise.all([
      loadMatches(requestOptions),
      loadTeamRoom(requestOptions),
      loadMatchRoom(requestOptions)
    ]);
    setStatus("Live");
  } catch (error) {
    console.error(error);
    setStatus("Error", "error");
    const activeView = $(".view.active");
    const node = document.createElement("div");
    node.className = "error";
    node.textContent = error.message;
    activeView.prepend(node);
  } finally {
    $("#refreshButton").disabled = false;
  }
}

function bindEvents() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });
  $("#fixtureSearch").addEventListener("input", renderFixtures);
  $("#competitionSelect").addEventListener("change", loadMatches);
  $("#matchSelect").addEventListener("change", loadActiveMatch);
  $("#favoriteTeamSelect").addEventListener("change", loadTeamRoom);
  $("#todayMatchSelect").addEventListener("change", loadMatchRoom);
  $("#openTeamButton").addEventListener("click", async () => {
    await loadTeamRoom();
    switchView("team-room");
  });
  $("#openMatchButton").addEventListener("click", async () => {
    await loadMatchRoom();
    switchView("match-room");
  });
  $("#refreshButton").addEventListener("click", () => refreshAll({ force: true }));
}

bindEvents();
refreshAll();
