const state = {
  sources: null,
  worldcup26: null,
  signalDay: null,
  signals: null,
  upcoming: null,
  apiFootball: null,
  knockout: null,
  knockoutMode: "signal",
  knockoutRequestId: 0,
  teamRoom: null,
  matchRoom: null,
  squads: null,
  matchupLab: null,
  matchupRequestId: 0,
  playerSort: { key: "goals", direction: "desc" },
  competitions: [],
  matches: [],
  activeMatch: null,
  timeZone: localStorage.getItem("signalRoomTimeZone") || "gmt2"
};

const API_BASE = window.location.protocol === "file:" ? "http://localhost:4173" : "";
const GMT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TIME_ZONE_OPTIONS = {
  gmt2: { label: "GMT+2", offsetMinutes: 120 },
  edt: { label: "EDT", timeZone: "America/New_York" }
};
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function activeTimeZone() {
  return TIME_ZONE_OPTIONS[state.timeZone] ? state.timeZone : "gmt2";
}

function activeTimeZoneConfig() {
  return TIME_ZONE_OPTIONS[activeTimeZone()];
}

function activeTimeZoneLabel() {
  return activeTimeZoneConfig().label;
}

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

function timePartsInActiveZone(date) {
  const parsed = date instanceof Date ? date : new Date(date);
  const zone = activeTimeZoneConfig();
  if (Number.isNaN(parsed.getTime())) return null;
  if (zone.offsetMinutes !== undefined) {
    const shifted = new Date(parsed.getTime() + zone.offsetMinutes * 60 * 1000);
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes()
    };
  }
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: zone.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(parsed).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour) % 24,
    minute: Number(values.minute)
  };
}

function todayDateKey() {
  const parts = timePartsInActiveZone(new Date());
  return `${parts.year}${String(parts.month).padStart(2, "0")}${String(parts.day).padStart(2, "0")}`;
}

function inputDateToKey(value) {
  return String(value || "").replaceAll("-", "") || todayDateKey();
}

function keyToInputDate(value) {
  const key = String(value || todayDateKey());
  if (!/^\d{8}$/.test(key)) return keyToInputDate(todayDateKey());
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

function dashedDateFromKey(value) {
  return keyToInputDate(value);
}

function selectedDateKey() {
  return inputDateToKey($("#matchDateInput")?.value);
}

function selectedKnockoutDateKey() {
  return inputDateToKey($("#knockoutDateInput")?.value || $("#matchDateInput")?.value);
}

function setSelectedDate(key) {
  const input = $("#matchDateInput");
  if (input) input.value = keyToInputDate(key);
  const knockoutInput = $("#knockoutDateInput");
  if (knockoutInput && !knockoutInput.value) knockoutInput.value = keyToInputDate(key);
}

function refreshTimeLabel() {
  const parts = timePartsInActiveZone(new Date());
  return `Live ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")} ${activeTimeZoneLabel()}`;
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
  if (!value) return `TBD ${activeTimeZoneLabel()}`;
  const date = new Date(value);
  const parts = timePartsInActiveZone(date);
  if (!parts) return `TBD ${activeTimeZoneLabel()}`;
  const day = String(parts.day).padStart(2, "0");
  const hour = String(parts.hour).padStart(2, "0");
  const minute = String(parts.minute).padStart(2, "0");
  return `${day} ${GMT_MONTHS[parts.month - 1]}, ${hour}:${minute} ${activeTimeZoneLabel()}`;
}

function gmtObjectLabel(gmt) {
  if (gmt?.iso) return formatGMT(gmt.iso);
  return activeTimeZone() === "gmt2" ? gmt?.label || "" : "";
}

function matchGmtLabel(match) {
  return gmtObjectLabel(match?.gmt) || (match?.summary?.date ? formatGMT(match.summary.date) : `TBD ${activeTimeZoneLabel()}`);
}

function dateKeyLabel(key) {
  const date = new Date(`${keyToInputDate(key)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(key || "");
  return `${date.getUTCDate()} ${GMT_MONTHS[date.getUTCMonth()]}`;
}

function dateKeyFromGame(game) {
  const value = String(game?.local_date || "");
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) return `${match[3]}${match[1]}${match[2]}`;
  if (game?.gmt?.iso) return game.gmt.iso.slice(0, 10).replaceAll("-", "");
  return selectedDateKey();
}

function isFinalFixture(item) {
  return item?.finished === true || item?.finished === "TRUE" || item?.liveScore?.isFinal || item?.summary?.archivedResult;
}

function countdownLabel(item) {
  if (isFinalFixture(item)) return "Final";
  if (item?.liveScore?.isLive) return "Live now";
  const iso = item?.gmt?.iso || item?.summary?.date;
  if (!iso) return "Kickoff TBA";
  const kickoff = new Date(iso);
  if (Number.isNaN(kickoff.getTime())) return "Kickoff TBA";
  const diffMs = kickoff.getTime() - Date.now();
  const absMinutes = Math.max(0, Math.round(Math.abs(diffMs) / 60000));
  const days = Math.floor(absMinutes / 1440);
  const hours = Math.floor((absMinutes % 1440) / 60);
  const minutes = absMinutes % 60;
  const compact = days > 0
    ? `${days}d ${hours}h`
    : hours > 0
      ? `${hours}h ${minutes}m`
      : `${minutes}m`;
  if (diffMs > 0) return `Kickoff in ${compact}`;
  if (absMinutes <= 130) return "Live window";
  return `Kickoff passed ${compact}`;
}

function scoreStateLabel(score = {}, context = {}) {
  const statusText = [
    score.status,
    score.detail,
    context?.summary?.status,
    context?.summary?.statusDetail,
    context?.summary?.statusState
  ].filter(Boolean).join(" ");
  if (/final|full time|\bft\b|post/i.test(statusText)) return "Match finished";
  if (/live|in progress|halftime|half time|\bin\b/i.test(statusText)) return "Match live";
  if (score.isFinal || isFinalFixture(context)) return "Match finished";
  if (score.isLive || context?.liveScore?.isLive) return "Match live";
  const iso = context?.gmt?.iso || context?.summary?.date || score.date;
  if (!iso) return "Kickoff TBA";
  const kickoff = new Date(iso);
  if (Number.isNaN(kickoff.getTime())) return "Kickoff TBA";
  const diffMs = kickoff.getTime() - Date.now();
  if (diffMs > 0) return countdownLabel(context || { gmt: { iso } });
  if (Math.abs(diffMs) <= 130 * 60000) return "Match live";
  return "Match finished";
}

function fixtureStatus(game) {
  if (isFinalFixture(game)) {
    return {
      label: "Final",
      detail: game.result_source || game.liveScore?.detail || "Result confirmed",
      className: "final"
    };
  }
  const raw = String(game?.time_elapsed || "").trim();
  const rawKey = raw.toLowerCase();
  if (raw && rawKey !== "notstarted" && rawKey !== "scheduled") {
    return {
      label: /final|full/i.test(raw) ? "Final" : "Live",
      detail: raw,
      className: /final|full/i.test(raw) ? "final" : "live"
    };
  }
  const iso = game?.gmt?.iso;
  if (!iso) return { label: "Scheduled", detail: "Kickoff TBA", className: "scheduled" };
  const kickoff = new Date(iso);
  const diffMs = kickoff.getTime() - Date.now();
  if (diffMs > 0) return { label: "Scheduled", detail: countdownLabel(game), className: "scheduled" };
  if (Math.abs(diffMs) <= 130 * 60000) return { label: "Live feed pending", detail: "Kickoff window active", className: "live" };
  return { label: "Result pending", detail: "No final feed connected yet", className: "pending" };
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
    matchId: matchOption?.dataset?.matchId || state.matchRoom?.match?.matchId || "",
    matchSignature: matchOption?.dataset?.signature || matchSignature(state.matchRoom?.match),
    teamRoomTeam: $("#teamRoomSelect")?.value || state.teamRoom?.team || "",
    matchupHome: $("#matchupHomeSelect")?.value || state.matchupLab?.match?.home || "",
    matchupAway: $("#matchupAwaySelect")?.value || state.matchupLab?.match?.away || ""
  };
}

function selectPreferredOption(select, preferredValue, preferredSignature = "", preferredMatchId = "") {
  const options = [...select.options];
  const exactValueIsStable = preferredValue && !String(preferredValue).startsWith("index-");
  const target = (exactValueIsStable ? options.find((option) => option.value === preferredValue) : null)
    || options.find((option) => preferredMatchId && option.dataset.matchId === String(preferredMatchId))
    || options.find((option) => preferredSignature && option.dataset.signature === preferredSignature)
    || options.find((option) => option.value === preferredValue);
  if (target) {
    select.value = target.value;
  } else if (options.length) {
    select.selectedIndex = 0;
  }
}

function switchView(id) {
  $$(".tab").forEach((item) => {
    const active = item.dataset.view === id;
    item.classList.toggle("active", active);
    if (active) {
      item.setAttribute("aria-current", "page");
    } else {
      item.removeAttribute("aria-current");
    }
  });
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === id));
  closeMobileMenu();
  if (window.matchMedia("(min-width: 761px)").matches) {
    $(`.tab[data-view="${id}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeMobileMenu() {
  const nav = $(".nav-row");
  const toggle = $("#mobileMenuButton");
  if (!nav || !toggle) return;
  nav.classList.remove("open");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", "Open dashboard menu");
}

function toggleMobileMenu() {
  const nav = $(".nav-row");
  const toggle = $("#mobileMenuButton");
  if (!nav || !toggle) return;
  const open = !nav.classList.contains("open");
  nav.classList.toggle("open", open);
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
  toggle.setAttribute("aria-label", open ? "Close dashboard menu" : "Open dashboard menu");
}

function initializeActiveTabState() {
  $$(".tab").forEach((item) => {
    if (item.classList.contains("active")) {
      item.setAttribute("aria-current", "page");
    } else {
      item.removeAttribute("aria-current");
    }
  });
}

function renderMetrics() {
  const grid = $("#metricGrid");
  const template = $("#metricTemplate");
  if (!grid || !template) return;
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
  if (!ticker) return;
  const sources = state.sources?.sources || [];
  const connected = sources.filter((source) => source.status === "connected").length;
  const locked = sources.filter((source) => source.status === "locked" || source.status === "licensed_only").length;
  const fixtureCount = state.worldcup26?.games?.length || 0;
  const daySources = state.signalDay?.sources?.length || 0;
  const bdl = state.signalDay?.ballDontLie;
  const bdlText = bdl ? ` · BALLDONTLIE ${bdl.connected ? "connected" : `auth ${bdl.status}`}` : "";
  ticker.textContent = `${connected} connected feeds · ${fixtureCount} GitHub fixtures · ${daySources} signal sources · ${locked} credential gates${bdlText}`;
}

function renderTimeZoneSwitch() {
  $$("[data-time-zone]").forEach((button) => {
    const active = button.dataset.timeZone === activeTimeZone();
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function rerenderTimeSensitiveViews() {
  const selection = captureSelection();
  renderTimeZoneSwitch();
  renderControls(selection);
  renderFixtures();
  renderTodayMatches();
  if (state.upcoming) renderUpcomingMatches(state.upcoming);
  if (state.signals) renderSignals(state.signals);
  if (state.knockout) renderKnockout(state.knockout);
  if (state.teamRoom) renderTeamRoom(state.teamRoom);
  if (state.matchRoom) renderMatchRoom(state.matchRoom);
  if (state.matchupLab) renderMatchupLab(state.matchupLab);
  if (!$("#refreshButton")?.disabled) setStatus(refreshTimeLabel());
}

function setTimeZone(value) {
  if (!TIME_ZONE_OPTIONS[value] || value === activeTimeZone()) return;
  state.timeZone = value;
  localStorage.setItem("signalRoomTimeZone", value);
  rerenderTimeSensitiveViews();
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
    option.value = match.eventId || (match.matchId ? `match-${match.matchId}` : `index-${index}`);
    option.dataset.index = index;
    option.dataset.matchId = match.matchId || "";
    option.dataset.signature = matchSignature(match);
    option.textContent = `${match.home} vs ${match.away} · ${matchGmtLabel(match)}`;
    return option;
  }));
  selectPreferredOption(matchSelect, selection.matchValue, selection.matchSignature, selection.matchId);
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
    tr.className = "fixture-row";
    tr.tabIndex = 0;
    tr.dataset.matchId = game.id || "";
    tr.setAttribute("role", "button");
    tr.setAttribute("aria-label", `Open ${game.home_team_name_en || "home"} vs ${game.away_team_name_en || "away"} in Match Room`);
    const home = game.home_team_name_en || `Team ${game.home_team_id || ""}`.trim();
    const away = game.away_team_name_en || `Team ${game.away_team_id || ""}`.trim();
    const status = fixtureStatus(game);
    const hasScore = isFinalFixture(game) || status.className === "live" || Number(game.home_score || 0) || Number(game.away_score || 0);
    const score = hasScore
      ? `<span class="score">${escapeHtml(game.home_score ?? 0)}-${escapeHtml(game.away_score ?? 0)}</span>`
      : `<span class="vs-pill">vs</span>`;
    tr.innerHTML = `
      <td>${escapeHtml(gmtObjectLabel(game.gmt) || `TBD ${activeTimeZoneLabel()}`)}<br><small class="fixture-countdown">${escapeHtml(countdownLabel(game))}</small></td>
      <td class="match-cell">${escapeHtml(home)} ${score} ${escapeHtml(away)}<br><small>${escapeHtml(game.stadium_name || "")}</small></td>
      <td>${escapeHtml(game.group || game.type || "Group")}</td>
      <td><span class="fixture-status-pill ${escapeHtml(status.className)}">${escapeHtml(status.label)}</span><br><small>${escapeHtml(status.detail)}</small></td>
    `;
    tr.addEventListener("click", () => openFixtureMatch(game));
    tr.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openFixtureMatch(game);
      }
    });
    return tr;
  }));

  if (!filtered.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4" class="empty">No fixtures match the current filter.</td>`;
    rows.append(tr);
  }
}

async function openFixtureMatch(game) {
  const dateKey = dateKeyFromGame(game);
  setSelectedDate(dateKey);
  await loadSignalDay({
    selection: {
      ...captureSelection(),
      matchId: String(game.id || ""),
      matchSignature: matchSignature({
        home: game.home_team_name_en,
        away: game.away_team_name_en,
        localDate: dashedDateFromKey(dateKey)
      })
    }
  });
  const select = $("#todayMatchSelect");
  const target = [...select.options].find((option) => option.dataset.matchId === String(game.id || ""));
  if (target) select.value = target.value;
  await loadMatchRoom();
  switchView("match-room");
}

function renderTodayMatches() {
  const grid = $("#todayMatchGrid");
  const matches = state.signalDay?.matches || [];
  grid.replaceChildren(...matches.map((match, index) => {
    const card = document.createElement("button");
    card.className = "today-card";
    card.type = "button";
    card.dataset.eventId = match.eventId || "";
    card.dataset.matchId = match.matchId || "";
    const prediction = match.predictionModel;
    const odds = match.summary?.odds;
    const expert = prediction?.components?.expertMedia || match.expertMedia;
    const homeProb = prediction?.probabilities?.home;
    const awayProb = prediction?.probabilities?.away;
    const drawProb = prediction?.probabilities?.draw;
    const projectedScore = prediction?.scorePrediction;
    card.innerHTML = `
      <div class="today-card-top">
        <span>${escapeHtml(match.group ? `Group ${match.group}` : "Match")}</span>
        <strong>${escapeHtml(matchGmtLabel(match))}</strong>
        <small class="today-countdown">${escapeHtml(countdownLabel(match))}</small>
      </div>
      ${liveScoreMarkup(match.liveScore, true, match)}
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
      <div class="today-prediction">
        <span>Prediction Experiment</span>
        <strong>${escapeHtml(projectedScore?.label || "Prediction pending")}</strong>
        <small>${escapeHtml(match.home)} ${escapeHtml(homeProb || 0)}% · Draw ${escapeHtml(drawProb || 0)}% · ${escapeHtml(match.away)} ${escapeHtml(awayProb || 0)}%</small>
      </div>
      <div class="today-card-meta">${prediction ? `Favorite: ${escapeHtml(prediction.favorite)} · ${escapeHtml(prediction.confidence)} confidence` : "Prediction data pending"}</div>
      <div class="today-card-meta">${odds ? `${escapeHtml(odds.provider || "Odds")} market blended with squad history` : "Historical squad model only"}</div>
      <div class="today-card-meta">Live feed: ${escapeHtml(match.source?.live || "not mapped")}</div>
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

function percentWeight(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function teamRankMarkup(name, rank) {
  const rankText = rank ? `Pool ${rank.group} #${rank.rank}` : "Pool rank pending";
  return `
    <span class="ranked-team">
      <b>${escapeHtml(name)}</b>
      ${rank?.crowned ? `<span class="pool-crown" aria-label="current pool leader">♛</span>` : ""}
      <small>${escapeHtml(rankText)}${rank ? ` · ${escapeHtml(rank.points)} pts` : ""}</small>
    </span>
  `;
}

function modelBlendMarkup(weights = {}) {
  const rows = [
    ["Market", weights.market],
    ["Squad", weights.historicalSquad],
    ["Live", weights.liveTournament],
    ["Expert", weights.expertMedia]
  ];
  return rows.map(([label, value]) => `
    <span>
      <i style="width:${Math.max(4, Number(value || 0) * 100)}%"></i>
      <b>${escapeHtml(label)}</b>
      <em>${escapeHtml(percentWeight(value))}</em>
    </span>
  `).join("");
}

function renderUpcomingMatches(data) {
  const weekNode = $("#upcomingWeek");
  const rankNode = $("#poolRankings");
  if (!weekNode || !rankNode) return;
  if (!data) {
    weekNode.innerHTML = `<div class="empty">Upcoming matches are loading.</div>`;
    rankNode.innerHTML = `<div class="empty">Pool rankings are loading.</div>`;
    return;
  }
  const matches = (data.week || []).flatMap((day) => day.matches || []);
  $("#upcomingRange").textContent = `${dateKeyLabel(data.dateKey)} to ${dateKeyLabel(data.endDateKey)} · ${matches.length} scheduled matches`;
  $("#upcomingKpis").innerHTML = [
    statCard("Week Matches", matches.length, "scheduled"),
    statCard("Pools", data.poolRankings?.groups?.length || 0, "ranked"),
    statCard("QIP Lessons", data.qip?.lessonCount || 0, "result calls learned")
  ].join("");

  weekNode.innerHTML = (data.week || []).map((day) => `
    <section class="upcoming-day">
      <h3>${escapeHtml(dateKeyLabel(day.dateKey))}</h3>
      ${(day.matches || []).length ? day.matches.map((match) => `
        <article class="upcoming-match-card">
          <div class="upcoming-match-head">
            <span>${escapeHtml(match.group || "Match")}</span>
            <strong>${escapeHtml(gmtObjectLabel(match.gmt) || `TBD ${activeTimeZoneLabel()}`)}</strong>
          </div>
          <div class="upcoming-teams">
            ${teamRankMarkup(match.home, match.homeRank)}
            <span class="vs-pill">vs</span>
            ${teamRankMarkup(match.away, match.awayRank)}
          </div>
          <small>${escapeHtml([match.venue, match.city].filter(Boolean).join(" · "))}</small>
          <div class="upcoming-call-grid">
            <div class="result-call-card">
              <span>Result Call</span>
              <b>${escapeHtml(match.resultCall?.favorite || "TBD")}</b>
              <strong>${escapeHtml(match.resultCall?.score || "Score TBA")}</strong>
              <em>${escapeHtml(match.resultCall?.confidence || 0)} pts confidence · ${escapeHtml(match.resultCall?.probabilities?.home || 0)} / ${escapeHtml(match.resultCall?.probabilities?.draw || 0)} / ${escapeHtml(match.resultCall?.probabilities?.away || 0)}</em>
            </div>
            <div class="model-blend-card">
              <span>Model Blend</span>
              ${modelBlendMarkup(match.modelBlend?.weights)}
            </div>
          </div>
          ${match.modelBlend?.edges?.length ? `<div class="upcoming-edges">${match.modelBlend.edges.slice(0, 2).map((edge) => `<p>${escapeHtml(edge)}</p>`).join("")}</div>` : ""}
        </article>
      `).join("") : `<div class="empty">No scheduled matches.</div>`}
    </section>
  `).join("");

  rankNode.innerHTML = (data.poolRankings?.groups || []).map((group) => `
    <article class="pool-table">
      <h3>Pool ${escapeHtml(group.group)}</h3>
      ${group.teams.map((team) => `
        <div class="pool-row ${team.crowned ? "crowned" : ""}">
          <span>${escapeHtml(team.rank)}</span>
          <strong>${escapeHtml(team.team)}${team.crowned ? ` <i class="pool-crown" aria-label="current pool leader">♛</i>` : ""}</strong>
          <em>${escapeHtml(team.points)} pts · ${escapeHtml(team.gd >= 0 ? `+${team.gd}` : team.gd)} GD · ${escapeHtml(team.played)} played</em>
        </div>
      `).join("")}
    </article>
  `).join("");
}

function renderImages(images = []) {
  const grid = $("#referenceGrid");
  if (!grid) return;
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

function allSquadPlayers() {
  return (state.squads?.teams || []).flatMap((team) =>
    (team.players || []).map((player) => ({
      ...player,
      team: team.team,
      code: team.code,
      name: player.shirtName || player.playerName || `${player.firstNames || ""} ${player.lastNames || ""}`.trim()
    }))
  );
}

function playerSortValue(player, key) {
  if (key === "caps" || key === "goals") return Number(player[key] || 0);
  return String(player[key] || "").toLowerCase();
}

function sortedSquadPlayers() {
  const { key, direction } = state.playerSort;
  const multiplier = direction === "asc" ? 1 : -1;
  return allSquadPlayers().sort((a, b) => {
    const left = playerSortValue(a, key);
    const right = playerSortValue(b, key);
    if (typeof left === "number" && typeof right === "number") {
      return (left - right || String(a.name).localeCompare(String(b.name))) * multiplier;
    }
    return (String(left).localeCompare(String(right)) || String(a.name).localeCompare(String(b.name))) * multiplier;
  });
}

function renderPlayersTable() {
  const rows = $("#playerRows");
  if (!rows) return;
  const players = sortedSquadPlayers();
  if (!players.length) {
    rows.innerHTML = `<tr><td colspan="6" class="empty">No squad players loaded yet.</td></tr>`;
    return;
  }
  rows.replaceChildren(...players.map((player) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="player-table-name">
        ${playerPhotoMarkup(player, "table-player-photo")}
        <div>
          <strong>${escapeHtml(player.name || player.playerName)}</strong>
          <small>#${escapeHtml(player.number || "")} · ${escapeHtml(player.playerName || "")}</small>
          <small class="mobile-club">${escapeHtml(player.club || "Club TBA")}</small>
        </div>
      </td>
      <td>${escapeHtml(player.team)}${player.code ? `<br><small>${escapeHtml(player.code)}</small>` : ""}</td>
      <td><span class="position-pill">${escapeHtml(player.position || "TBD")}</span></td>
      <td>${escapeHtml(player.club || "Club TBA")}</td>
      <td>${escapeHtml(player.caps ?? 0)}</td>
      <td>${escapeHtml(player.goals ?? 0)}</td>
    `;
    return tr;
  }));

  $$(".players-table th[data-sort]").forEach((header) => {
    header.dataset.active = header.dataset.sort === state.playerSort.key ? state.playerSort.direction : "";
  });
}

function knockoutTeamSource(text) {
  return text ? `<small>${escapeHtml(text)}</small>` : "";
}

function knockoutPredictionMarkup(match) {
  if (!match.prediction) return "";
  const probabilities = match.prediction.probabilities || {};
  return `
    <div class="bracket-prediction">
      <span>Signal pick</span>
      <strong>${escapeHtml(match.prediction.favorite || "TBD")} ${escapeHtml(match.prediction.score || "")}</strong>
      <small>${escapeHtml(match.prediction.confidence || 0)} pts · ${escapeHtml(probabilities.home || 0)} / ${escapeHtml(probabilities.draw || 0)} / ${escapeHtml(probabilities.away || 0)}</small>
    </div>
  `;
}

function roundConfidenceSummary(data) {
  const grouped = new Map();
  for (const item of data?.technical?.confidenceByRound || []) {
    if (!grouped.has(item.round)) grouped.set(item.round, []);
    grouped.get(item.round).push(Number(item.confidence || 0));
  }
  return [...grouped.entries()].map(([round, values]) => ({
    round,
    confidence: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length),
    matches: values.length
  }));
}

function renderKnockoutTech(data = state.knockout) {
  const node = $("#knockoutTechChart");
  if (!node) return;
  const technical = data?.technical || {};
  const rows = roundConfidenceSummary(data);
  const max = Math.max(1, ...rows.map((row) => row.confidence));
  node.innerHTML = `
    <div class="tech-head">
      <span>Technical projection</span>
      <strong>${escapeHtml(technical.averageConfidence || 0)} pts avg confidence</strong>
      <small>${escapeHtml(technical.resolvedSlots || 0)} resolved slots · ${escapeHtml(technical.projectedMatches || 0)} modeled matches</small>
    </div>
    <div class="tech-bars">
      ${rows.length ? rows.map((row) => `
        <div class="tech-row">
          <span>${escapeHtml(row.round.toUpperCase())}</span>
          <div><i style="width:${Math.max(6, (row.confidence / max) * 100)}%"></i></div>
          <strong>${escapeHtml(row.confidence.toFixed(1))}</strong>
        </div>
      `).join("") : `<div class="empty">No projected knockout confidence is available in known-only mode.</div>`}
    </div>
  `;
}

function renderKnockoutQip(data = state.knockout) {
  const node = $("#knockoutQipBox");
  if (!node) return;
  const qip = data?.qip || {};
  const rationale = qip.rationale || [];
  node.innerHTML = `
    <span>QIP Compounding Knowledge</span>
    <strong>${escapeHtml(qip.lessonCount || 0)} lessons stored</strong>
    <p>Confidence multiplier ${escapeHtml(qip.confidenceMultiplier || 1)} · draw correction ${escapeHtml(qip.drawLift || 0)} pts</p>
    <div class="qip-heartbeat">${escapeHtml(qip.heartbeat || "Waiting for completed results before calibration.")}</div>
    ${rationale.length ? `<ul>${rationale.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
  `;
}

function renderKnockout(data = state.knockout) {
  const node = $("#knockoutBracket");
  if (!node) return;
  if (!data?.rounds?.length) {
    node.innerHTML = `<div class="empty">Knockout projection loading.</div>`;
    renderKnockoutTech(data);
    renderKnockoutQip(data);
    return;
  }
  node.innerHTML = data.rounds.map((round) => `
    <section class="knockout-round ${escapeHtml(round.type)}">
      <h3>${escapeHtml(round.label)}</h3>
      <div class="bracket-stack">
        ${round.matches.length ? round.matches.map((match) => `
          <article class="bracket-card ${match.winner ? "projected" : ""}">
            <div class="bracket-meta">
              <span>Match ${escapeHtml(match.id || "")}</span>
              <b>${escapeHtml(signalTime(match))}</b>
            </div>
            <div class="bracket-team ${match.winner && match.winner === match.home ? "winner" : ""}">
              <span>${escapeHtml(match.home || "TBD")}</span>
              ${knockoutTeamSource(match.homeSource)}
            </div>
            <div class="bracket-team ${match.winner && match.winner === match.away ? "winner" : ""}">
              <span>${escapeHtml(match.away || "TBD")}</span>
              ${knockoutTeamSource(match.awaySource)}
            </div>
            ${knockoutPredictionMarkup(match)}
            <small>${escapeHtml(match.stadium || "")}${match.city ? ` · ${escapeHtml(match.city)}` : ""}</small>
          </article>
        `).join("") : `<div class="empty">No fixtures mapped for this round yet.</div>`}
      </div>
    </section>
  `).join("");
  renderKnockoutTech(data);
  renderKnockoutQip(data);
}

function percentLabel(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function signalTime(row) {
  return gmtObjectLabel(row?.gmt) || (row?.dateKey ? `${row.dateKey.slice(6, 8)} ${GMT_MONTHS[Number(row.dateKey.slice(4, 6)) - 1]}` : "TBD");
}

function renderSignalKpis(data) {
  const node = $("#signalKpis");
  if (!node) return;
  const summary = data?.summary || {};
  const kpis = [
    ["Audited", summary.auditedMatches || 0, "completed matches"],
    ["Hit Rate", percentLabel(summary.hitRate), `${summary.correctCalls || 0} correct calls`],
    ["Exact Score", percentLabel(summary.exactScoreRate), "scoreline precision"],
    ["Model Score", percentLabel(summary.modelScore), `Brier ${summary.averageBrier ?? "n/a"}`],
    ["Upcoming", summary.upcomingMatches || 0, "known fixtures"]
  ];
  node.innerHTML = kpis.map(([label, value, detail]) => `
    <article>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `).join("");
}

function renderAccuracyLine(series = []) {
  const node = $("#accuracyLineChart");
  if (!node) return;
  if (!series.length) {
    node.innerHTML = `<div class="empty">No completed match results are available yet for the selected date.</div>`;
    return;
  }
  const width = 760;
  const height = 300;
  const margin = { top: 24, right: 24, bottom: 42, left: 48 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const x = (index) => margin.left + (series.length === 1 ? innerWidth / 2 : (index / (series.length - 1)) * innerWidth);
  const y = (value) => margin.top + innerHeight - (Number(value || 0) / 100) * innerHeight;
  const points = series.map((item, index) => `${x(index)},${y(item.cumulativeAccuracy)}`).join(" ");
  const area = `${margin.left},${margin.top + innerHeight} ${points} ${margin.left + innerWidth},${margin.top + innerHeight}`;
  node.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Prediction accuracy over time">
      <line class="chart-grid" x1="${margin.left}" y1="${y(100)}" x2="${margin.left + innerWidth}" y2="${y(100)}"></line>
      <line class="chart-grid" x1="${margin.left}" y1="${y(50)}" x2="${margin.left + innerWidth}" y2="${y(50)}"></line>
      <line class="chart-grid" x1="${margin.left}" y1="${y(0)}" x2="${margin.left + innerWidth}" y2="${y(0)}"></line>
      <text class="chart-label" x="8" y="${y(100) + 4}">100%</text>
      <text class="chart-label" x="14" y="${y(50) + 4}">50%</text>
      <text class="chart-label" x="20" y="${y(0) + 4}">0%</text>
      <polygon class="accuracy-area" points="${area}"></polygon>
      <polyline class="accuracy-line" points="${points}"></polyline>
      ${series.map((item, index) => `
        <circle class="accuracy-point" cx="${x(index)}" cy="${y(item.cumulativeAccuracy)}" r="5"></circle>
        <text class="chart-label" x="${x(index)}" y="${height - 12}" text-anchor="middle">${escapeHtml(item.label)}</text>
      `).join("")}
    </svg>
  `;
}

function pieGradient(items = []) {
  const total = items.reduce((sum, item) => sum + Number(item.value || 0), 0);
  if (!total) return "rgba(255,255,255,0.09) 0 360deg";
  let start = 0;
  return items.map((item) => {
    const end = start + (Number(item.value || 0) / total) * 360;
    const part = `${item.color || "var(--home)"} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
    start = end;
    return part;
  }).join(", ");
}

function renderPie(target, items = [], centerLabel = "") {
  const node = $(target);
  if (!node) return;
  const total = items.reduce((sum, item) => sum + Number(item.value || 0), 0);
  node.innerHTML = `
    <div class="signal-pie" style="--pie:${pieGradient(items)}">
      <strong>${escapeHtml(centerLabel || formatNumber(total))}</strong>
      <span>${escapeHtml(total ? "signals" : "pending")}</span>
    </div>
    <div class="signal-legend">
      ${items.map((item) => `
        <span><i style="background:${escapeHtml(item.color || "var(--home)")}"></i>${escapeHtml(item.label)} <b>${escapeHtml(Number(item.value || 0))}</b></span>
      `).join("")}
    </div>
  `;
}

function renderSignalTables(data) {
  const auditRows = $("#signalAuditRows");
  const upcomingRows = $("#signalUpcomingRows");
  if (auditRows) {
    const rows = data?.audit || [];
    auditRows.innerHTML = rows.length ? rows.map((row) => `
      <tr>
        <td class="match-cell">${escapeHtml(row.home)} vs ${escapeHtml(row.away)}<br><small>${escapeHtml(signalTime(row))}</small></td>
        <td>${escapeHtml(row.predictedWinner)}<br><small>${escapeHtml(row.predictedScore)} · ${escapeHtml(row.confidence)} pts</small></td>
        <td>${escapeHtml(row.actualWinner)}<br><small>${escapeHtml(row.result)}</small></td>
        <td><span class="call-pill ${row.correct ? "correct" : "miss"}">${escapeHtml(row.correct ? "Correct" : "Miss")}</span></td>
        <td>${escapeHtml(row.brier)}</td>
      </tr>
    `).join("") : `<tr><td colspan="5" class="empty">No completed result audit is available yet.</td></tr>`;
  }
  if (upcomingRows) {
    const rows = data?.upcoming || [];
    upcomingRows.innerHTML = rows.length ? rows.map((row) => `
      <tr>
        <td>${escapeHtml(signalTime(row))}</td>
        <td class="match-cell">${escapeHtml(row.home)} vs ${escapeHtml(row.away)}<br><small>${escapeHtml(row.group || "")}</small></td>
        <td>${escapeHtml(row.favorite)}<br><small>${escapeHtml(row.probabilities.home)} / ${escapeHtml(row.probabilities.draw)} / ${escapeHtml(row.probabilities.away)}</small></td>
        <td>${escapeHtml(row.predictedScore)}</td>
        <td>${escapeHtml(row.confidence)} pts</td>
      </tr>
    `).join("") : `<tr><td colspan="5" class="empty">No known upcoming fixtures are available after the selected date.</td></tr>`;
  }
}

function renderSignals(data) {
  $("#signalsMethod").textContent = data?.method || "Signal model audit";
  renderSignalKpis(data);
  renderAccuracyLine(data?.charts?.accuracySeries || []);
  renderPie("#resultPieChart", data?.charts?.resultPie || [], `${data?.summary?.hitRate || 0}%`);
  renderPie("#modelBlendChart", data?.charts?.modelWeights || [], "Blend");
  renderSignalTables(data);
}

function clientParseScore(value) {
  const [home, away] = String(value || "0-0").split("-").map((part) => Number(part));
  return [Number.isFinite(home) ? home : 0, Number.isFinite(away) ? away : 0];
}

function sportsIntelligenceSnapshot(data) {
  const audit = state.signals?.audit || [];
  const goals = audit.reduce((sum, row) => {
    const [home, away] = clientParseScore(row.result);
    return sum + home + away;
  }, 0);
  const highGoal = audit.filter((row) => clientParseScore(row.result).reduce((sum, value) => sum + value, 0) >= 4).length;
  const draws = audit.filter((row) => row.actualOutcome === "draw").length;
  const topPlayers = (state.squads?.teams || [])
    .flatMap((team) => (team.players || []).map((player) => ({ ...player, team: team.team })))
    .sort((a, b) => Number(b.goals || 0) - Number(a.goals || 0) || Number(b.caps || 0) - Number(a.caps || 0))
    .slice(0, 5);
  const leaders = (state.upcoming?.poolRankings?.groups || [])
    .flatMap((group) => (group.teams || []).filter((team) => team.crowned).slice(0, 2))
    .filter(Boolean)
    .slice(0, 6);
  const coverage = data?.coverage || [];
  return {
    audited: audit.length,
    goals,
    averageGoals: audit.length ? Number((goals / audit.length).toFixed(2)) : 0,
    highGoalRate: audit.length ? Number((highGoal / audit.length * 100).toFixed(1)) : 0,
    drawRate: audit.length ? Number((draws / audit.length * 100).toFixed(1)) : 0,
    hitRate: state.signals?.summary?.hitRate || 0,
    averageBrier: state.signals?.summary?.averageBrier || 0,
    topPlayers,
    leaders,
    coverageEnabled: coverage.filter((item) => item.enabled).length,
    coverageTotal: coverage.length,
    apiStatus: data?.connected ? "Connected" : "Locked",
    apiDetail: data?.lockedReason || data?.plan || data?.status || "unknown"
  };
}

function renderApiFootball(data) {
  const node = $("#apiFootballVisuals");
  if (!node) return;
  if (!data) {
    node.innerHTML = `<div class="empty">Sports intelligence is loading.</div>`;
    return;
  }
  const intel = sportsIntelligenceSnapshot(data);
  const endpointMax = Math.max(1, ...(data.endpoints || []).map((item) => Number(item.results || 0)));
  const coverage = data.coverage || [];
  const endpoints = data.endpoints || [];
  node.innerHTML = `
    <div class="api-football-summary">
      <article>
        <span>Result Sample</span>
        <strong>${escapeHtml(intel.audited)}</strong>
        <small>${escapeHtml(intel.goals)} goals · ${escapeHtml(intel.averageGoals)} per match</small>
      </article>
      <article>
        <span>Model Accuracy</span>
        <strong>${escapeHtml(intel.hitRate)}%</strong>
        <small>Brier ${escapeHtml(intel.averageBrier)} · draw rate ${escapeHtml(intel.drawRate)}%</small>
      </article>
      <article>
        <span>API-Sports</span>
        <strong>${escapeHtml(intel.apiStatus)}</strong>
        <small>${escapeHtml(intel.coverageEnabled)}/${escapeHtml(intel.coverageTotal)} 2026 coverage flags · ${escapeHtml(intel.apiDetail)}</small>
      </article>
    </div>
    <div class="sports-intel-grid">
      <section>
        <h3>Tournament Tempo</h3>
        <p>${escapeHtml(intel.averageGoals)} goals per completed match with ${escapeHtml(intel.highGoalRate)}% of audited matches reaching four or more goals. That changes scoreline priors more than reputation does.</p>
      </section>
      <section>
        <h3>Pool Pressure</h3>
        <div class="api-standings-mini">
          ${intel.leaders.map((row) => `
            <article>
              <b>${escapeHtml(row.group)} · ${escapeHtml(row.team)} <i class="pool-crown">♛</i></b>
              <span>${escapeHtml(row.points)} pts · GD ${escapeHtml(row.gd >= 0 ? `+${row.gd}` : row.gd)} · ${escapeHtml(row.played)} played</span>
            </article>
          `).join("") || `<div class="empty">Pool leaders will appear after confirmed results.</div>`}
        </div>
      </section>
      <section>
        <h3>Player Leverage</h3>
        <div class="api-scorers">
          ${intel.topPlayers.map((player) => `
            <article>
              ${player.photo ? `<img src="${escapeHtml(player.photo)}" alt="">` : `<span class="player-mini">${escapeHtml(initials(player.shirtName || player.playerName))}</span>`}
              <div>
                <b>${escapeHtml(player.shirtName || player.playerName)}</b>
                <span>${escapeHtml(player.team)} · ${escapeHtml(player.goals)} goals · ${escapeHtml(player.caps)} caps</span>
              </div>
            </article>
          `).join("") || `<div class="empty">No official squad scoring sample available.</div>`}
        </div>
      </section>
      <section>
        <h3>Coverage Map</h3>
        <div class="coverage-pills">
          ${coverage.map((item) => `<span class="${item.enabled ? "on" : "off"}">${escapeHtml(item.label)}</span>`).join("")}
        </div>
      </section>
      <section>
        <h3>Endpoint Pulls</h3>
        <div class="api-endpoint-bars">
          ${endpoints.map((item) => `
            <div class="bar-row ${item.status === "locked" ? "muted" : ""}">
              <span>${escapeHtml(item.label)}</span>
              <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, (Number(item.results || 0) / endpointMax) * 100)}%"></div></div>
              <strong>${escapeHtml(item.status === "locked" ? "locked" : item.results)}</strong>
            </div>
          `).join("")}
        </div>
      </section>
    </div>
    <div class="api-leverage">
      ${(data.predictionLeverage || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
    </div>
  `;
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

function liveScoreMarkup(liveScore, compact = false, context = {}) {
  const score = liveScore || {};
  const mode = score.isLive ? "live" : score.isFinal ? "final" : score.available ? "scheduled" : "empty";
  const label = score.isLive ? "Live Score" : score.isFinal ? "Final Score" : score.available ? "Real-time Score" : "Real-time Score";
  const value = score.available ? `${score.homeScore ?? 0}-${score.awayScore ?? 0}` : "No live fixture";
  const teams = score.available && !compact ? `<small>${escapeHtml(score.home || "")} vs ${escapeHtml(score.away || "")}</small>` : "";
  const detail = scoreStateLabel(score, context);
  return `
    <div class="live-score ${mode}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <em>${escapeHtml(detail)}</em>
      ${teams}
    </div>
  `;
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

function positionCount(profile, code) {
  return Number(profile?.positions?.[code] || 0);
}

function renderPositionPitch(profile = {}, teamName = "Team") {
  const rows = [
    { code: "FW", label: "Attack", y: 18, x: 50 },
    { code: "MF", label: "Midfield", y: 42, x: 50 },
    { code: "DF", label: "Defense", y: 66, x: 50 },
    { code: "GK", label: "Keeper", y: 86, x: 50 }
  ];
  const total = Math.max(1, rows.reduce((sum, row) => sum + positionCount(profile, row.code), 0));
  return `
    <article class="position-pitch-card">
      <div class="position-head">
        <span>${escapeHtml(teamName)}</span>
        <b>${escapeHtml(total)} players mapped</b>
      </div>
      <div class="position-pitch" role="img" aria-label="${escapeHtml(teamName)} squad position map">
        ${rows.map((row) => {
          const count = positionCount(profile, row.code);
          const size = 44 + count * 3;
          return `
            <div class="position-node ${escapeHtml(row.code.toLowerCase())}" style="--x:${row.x}; --y:${row.y}; --size:${size}px">
              <strong>${escapeHtml(row.code)}</strong>
              <span>${escapeHtml(count)}</span>
            </div>
          `;
        }).join("")}
      </div>
      <div class="position-split">
        ${rows.map((row) => {
          const count = positionCount(profile, row.code);
          return `<span>${escapeHtml(row.label)} <b>${escapeHtml(Math.round((count / total) * 100))}%</b></span>`;
        }).join("")}
      </div>
    </article>
  `;
}

function renderPositionVisual(data, target) {
  const node = $(target);
  if (!node) return;
  const match = data.match || {};
  node.innerHTML = `
    <div class="position-map-grid">
      ${renderPositionPitch(data.profiles?.home, match.home || "Home")}
      ${renderPositionPitch(data.profiles?.away, match.away || "Away")}
    </div>
  `;
}

function initials(name = "") {
  const parts = String(name).split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "").concat(parts.at(-1)?.[0] || "").toUpperCase() || "XI";
}

function safeHex(value, fallback = "1fc16b") {
  const raw = String(value || fallback).replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(raw) ? raw : fallback;
}

function fallbackKit(teamName = "") {
  let hash = 0;
  for (const char of teamName) hash = (hash * 31 + char.charCodeAt(0)) % 0xffffff;
  const color = hash.toString(16).padStart(6, "0");
  return { type: "team", color, alternateColor: "0b0d0a" };
}

function kitVars(kit, teamName) {
  const source = kit?.color ? kit : fallbackKit(teamName);
  return `--kit:#${safeHex(source.color)}; --kit-alt:#${safeHex(source.alternateColor, "0b0d0a")}`;
}

function renderKitImage(kit, teamName, size = "large") {
  return `
    <div class="kit-image ${escapeHtml(size)}" style="${kitVars(kit, teamName)}" aria-label="${escapeHtml(teamName)} kit">
      <i></i>
      <span>${escapeHtml(initials(teamName))}</span>
    </div>
  `;
}

function renderKitCard(kit, teamName, detail = "") {
  const label = kit?.type ? `${kit.type} kit` : "team kit";
  return `
    <article class="kit-card">
      ${renderKitImage(kit, teamName)}
      <div>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(teamName)}</strong>
        <p>${escapeHtml(detail || "Kit colorway from the mapped match feed when available.")}</p>
      </div>
    </article>
  `;
}

const FORMATION_COORDINATES = {
  "1": [50, 88],
  "2": [78, 68],
  "3": [22, 68],
  "4": [50, 56],
  "5": [38, 70],
  "6": [62, 70],
  "7": [34, 42],
  "8": [66, 42],
  "9": [50, 19],
  "10": [75, 25],
  "11": [25, 25]
};

function setupCoordinates(player, index) {
  if (FORMATION_COORDINATES[player.formationPlace]) return FORMATION_COORDINATES[player.formationPlace];
  const fallback = [
    [50, 88], [18, 70], [38, 70], [62, 70], [82, 70],
    [25, 46], [50, 48], [75, 46],
    [22, 22], [50, 18], [78, 22]
  ];
  return fallback[index % fallback.length];
}

function playerPhotoMarkup(player, className = "player-photo") {
  const name = player.shirtName || player.name || player.playerName || player.espnName || "";
  const photo = player.photo || player.headshot;
  return `
    <div class="${escapeHtml(className)}">
      ${photo ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(name)}">` : `<span>${escapeHtml(initials(name))}</span>`}
    </div>
  `;
}

function renderFieldSetup(lineup, target) {
  const node = $(target);
  if (!node) return;
  if (!lineup?.current?.length) {
    node.innerHTML = `<div class="empty">No live lineup is mapped for this team yet.</div>`;
    return;
  }

  node.innerHTML = `
    <div class="setup-summary">
      <span>${escapeHtml(lineup.team)}</span>
      <strong>${escapeHtml(lineup.formation || "Formation TBA")}</strong>
      <em>${escapeHtml(lineup.current.length)} currently on field · ${escapeHtml(lineup.substitutions?.length || 0)} substitutions</em>
    </div>
    <div class="setup-pitch" style="${kitVars(lineup.uniform, lineup.team)}">
      ${lineup.current.map((player, index) => {
        const [x, y] = setupCoordinates(player, index);
        return `
          <div class="setup-player ${player.subbedIn ? "subbed-in" : ""}" style="--x:${x}; --y:${y}">
            ${playerPhotoMarkup(player, "setup-photo")}
            <b>${escapeHtml(player.jersey || "")}</b>
            <span>${escapeHtml(player.shortName || player.name)}</span>
          </div>
        `;
      }).join("")}
    </div>
    <div class="sub-list">
      ${(lineup.substitutions || []).length ? lineup.substitutions.map((sub) => `
        <article>
          <span>${escapeHtml(sub.minute || "")}</span>
          <strong>${escapeHtml(sub.in.name || "Player in")}</strong>
          <small>for ${escapeHtml(sub.out.name || "Player out")}</small>
        </article>
      `).join("") : `<div class="empty">No substitutions recorded yet.</div>`}
    </div>
  `;
}

function renderGoalTimeline(summary, target, focusTeam = "") {
  const node = $(target);
  if (!node) return;
  const goals = summary?.goals || [];
  if (!goals.length) {
    node.innerHTML = `<div class="empty">No scorer timeline is mapped for this match yet.</div>`;
    return;
  }
  node.innerHTML = goals.map((goal) => {
    const highlight = focusTeam && goal.team === focusTeam ? "focus" : "";
    const details = [
      goal.assist ? `Assist: ${goal.assist}` : "",
      goal.penalty ? "Penalty" : "",
      goal.ownGoal ? "Own goal" : ""
    ].filter(Boolean).join(" · ");
    return `
      <article class="goal-event ${escapeHtml(goal.side || "")} ${highlight}">
        <span>${escapeHtml(goal.minute || `${goal.minuteValue || ""}'`)}</span>
        <div>
          <strong>${escapeHtml(goal.scorer || "Unknown scorer")}</strong>
          <small>${escapeHtml(goal.team || "")}${details ? ` · ${escapeHtml(details)}` : ""}</small>
        </div>
      </article>
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

function renderExpertNotes(expertMedia, target = "#expertNotes") {
  const node = $(target);
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
      <div class="player-card-head">
        ${playerPhotoMarkup(player)}
        <div>
          <span>${escapeHtml(labelPrefix || player.position)} · #${escapeHtml(player.number || "")}</span>
          <strong>${escapeHtml(player.shirtName || player.playerName || player.espnName)}</strong>
        </div>
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

function renderTeamRoomControls(selection = {}) {
  const select = $("#teamRoomSelect");
  const teams = state.squads?.teams || [];
  if (!select || !teams.length) return;
  const current = selection.teamRoomTeam || state.teamRoom?.team || $("#favoriteTeamSelect")?.value || teams[0]?.team || "";
  select.replaceChildren(...teams.map((team) => {
    const option = document.createElement("option");
    option.value = team.team;
    option.textContent = `${team.team}${team.code ? ` · ${team.code}` : ""}`;
    return option;
  }));
  selectPreferredOption(select, current);
}

function renderTeamRoom(data) {
  const match = data.todayMatch;
  renderTeamRoomControls({ teamRoomTeam: data.team });
  $("#teamHero").innerHTML = `
    <div>
      <p class="eyebrow">Favorite Team Intelligence</p>
      <h2>${escapeHtml(data.team)}</h2>
      <p>${escapeHtml(data.code || "")} · Coach: ${escapeHtml(data.coach?.coachName || "TBA")}</p>
    </div>
    ${renderKitCard(data.liveSetup?.uniform, data.team, match ? `${match.home} vs ${match.away}` : "Squad colorway fallback")}
    <div class="hero-score">
      <span>Today</span>
      <strong>${match ? `${escapeHtml(match.home)} vs ${escapeHtml(match.away)}` : "No match today"}</strong>
      ${match ? liveScoreMarkup(match.liveScore, true, match) : ""}
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

  renderFieldSetup(data.liveSetup, "#teamLiveSetup");
  renderGoalTimeline(match?.summary, "#teamScoringTimeline", data.team);
  $("#teamKitPanel").innerHTML = renderKitCard(data.liveSetup?.uniform, data.team, data.liveSetup?.formation ? `${data.liveSetup.formation} match setup colorway` : "No mapped match kit, generated fallback shown.");

  const positions = Object.entries(profile.positions || {}).map(([label, value]) => ({ label, value }));
  const scorers = (profile.topScorers || []).map((player) => ({ label: player.shirtName || player.playerName, value: player.goals, display: player.goals }));
  const clubs = (profile.clubSpread || []).map((item) => ({ label: item.country, value: item.count, display: item.count }));
  $("#teamCharts").innerHTML = `
    <div class="chart-block">${renderPositionPitch(profile, data.team)}</div>
    <div class="chart-block"><h3>Position Mix</h3>${renderBars(positions)}</div>
    <div class="chart-block"><h3>Goal Sources</h3>${renderBars(scorers, "warm")}</div>
    <div class="chart-block"><h3>Club Country Spread</h3>${renderBars(clubs, "cool")}</div>
  `;

  renderPlayerCards(data.playerInsights, "#teamPlayers");
  renderNews(data.news, "#teamNews");
}

function renderPrediction(prediction, match = {}, target = "#predictionChart", sourceLabels = {}) {
  const node = $(target);
  if (!node) return;
  if (!prediction?.probabilities) {
    node.innerHTML = `<div class="empty">No blended prediction available yet.</div>`;
    return;
  }
  const labels = {
    market: "Market",
    squad: "Squad",
    live: "Live",
    expert: "Expert",
    ...sourceLabels
  };
  const probs = prediction.probabilities;
  const items = [
    { label: match.home || "Home", value: probs.home, display: `${probs.home}%` },
    { label: "Draw", value: probs.draw, display: `${probs.draw}%` },
    { label: match.away || "Away", value: probs.away, display: `${probs.away}%` }
  ];
  node.innerHTML = `
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
      <span>${escapeHtml(labels.market)} ${escapeHtml(Math.round((prediction.components?.weights?.market || 0) * 100))}%</span>
      <span>${escapeHtml(labels.squad)} ${escapeHtml(Math.round((prediction.components?.weights?.historicalSquad || 0) * 100))}%</span>
      <span>${escapeHtml(labels.live)} ${escapeHtml(Math.round((prediction.components?.weights?.liveTournament || 0) * 100))}%</span>
      <span>${escapeHtml(labels.expert)} ${escapeHtml(Math.round((prediction.components?.weights?.expertMedia || 0) * 100))}%</span>
    </div>
    ${prediction.edges?.length ? `<div class="model-edges">${prediction.edges.map((edge) => `<p>${escapeHtml(edge)}</p>`).join("")}</div>` : ""}
  `;
}

function renderComparison(data, target = "#comparisonBars") {
  const node = $(target);
  if (!node) return;
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
  node.innerHTML = rows.map(([label, homeValue, awayValue]) => `
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
  const homeLineup = data.lineups?.home;
  const awayLineup = data.lineups?.away;
  $("#matchRoomHero").innerHTML = `
    <div class="match-side">
      ${summary.home?.logo ? `<img src="${escapeHtml(summary.home.logo)}" alt="">` : ""}
      ${renderKitImage(homeLineup?.uniform, match.home, "small")}
      <h2>${escapeHtml(match.home)}</h2>
      <span>${escapeHtml(summary.home?.abbreviation || "")}</span>
    </div>
    <div class="match-center">
      <p class="eyebrow">Match Deep Dive</p>
      <strong>${escapeHtml(matchGmtLabel(match))}</strong>
      ${liveScoreMarkup(data.liveScore || match.liveScore, true, match)}
      ${score ? `
        <div class="score-prediction">
          <span>Prediction Experiment</span>
          <b>${escapeHtml(score.label)}</b>
        </div>
      ` : ""}
      <span>${escapeHtml(summary.venue || match.githubMatch?.stadium_name || "")}</span>
      <small>${escapeHtml((summary.broadcasts || []).join(" · ") || "Broadcast TBA")}</small>
    </div>
    <div class="match-side away-side">
      ${summary.away?.logo ? `<img src="${escapeHtml(summary.away.logo)}" alt="">` : ""}
      ${renderKitImage(awayLineup?.uniform, match.away, "small")}
      <h2>${escapeHtml(match.away)}</h2>
      <span>${escapeHtml(summary.away?.abbreviation || "")}</span>
    </div>
  `;

  renderPrediction(data.prediction, match);
  renderComparison(data);
  renderGoalTimeline(summary, "#matchScoringTimeline");
  renderPositionVisual(data, "#matchPositionMap");
  $("#uncommonInsights").innerHTML = (data.uncommonInsights || []).length
    ? data.uncommonInsights.map((item) => `<article>${escapeHtml(item)}</article>`).join("")
    : `<div class="empty">No uncommon cross-source signals generated.</div>`;
  renderExpertNotes(data.expertMedia);

  const homePlayers = (data.keyPlayers?.home || []).slice(0, 5).map((player) => ({ ...player, tags: [`${match.home}`, ...(player.tags || [])] }));
  const awayPlayers = (data.keyPlayers?.away || []).slice(0, 5).map((player) => ({ ...player, tags: [`${match.away}`, ...(player.tags || [])] }));
  renderPlayerCards([...homePlayers, ...awayPlayers], "#matchPlayers");
  renderNews(data.news, "#matchNews");
}

function renderMatchupControls(selection = {}) {
  const teams = state.squads?.teams || state.matchupLab?.teams || [];
  const homeSelect = $("#matchupHomeSelect");
  const awaySelect = $("#matchupAwaySelect");
  if (!homeSelect || !awaySelect || !teams.length) return;

  const makeOption = (team) => {
    const option = document.createElement("option");
    option.value = team.team;
    option.textContent = `${team.team}${team.code ? ` · ${team.code}` : ""}`;
    return option;
  };

  homeSelect.replaceChildren(...teams.map(makeOption));
  awaySelect.replaceChildren(...teams.map(makeOption));
  selectPreferredOption(homeSelect, selection.matchupHome || state.matchupLab?.match?.home || "Netherlands");
  selectPreferredOption(awaySelect, selection.matchupAway || state.matchupLab?.match?.away || "Sweden");

  if (homeSelect.value === awaySelect.value) {
    const fallback = [...awaySelect.options].find((option) => option.value !== homeSelect.value);
    if (fallback) awaySelect.value = fallback.value;
  }
}

function renderMatchupLab(data) {
  const match = data.match || {};
  const summary = match.summary || {};
  const score = data.prediction?.scorePrediction;
  const homeLineup = data.lineups?.home;
  const awayLineup = data.lineups?.away;
  $("#matchupHero").innerHTML = `
    <div class="match-side">
      <span>${escapeHtml(summary.home?.abbreviation || "")}</span>
      ${renderKitImage(homeLineup?.uniform, match.home, "small")}
      <h2>${escapeHtml(match.home)}</h2>
      <small>Power ${escapeHtml(summary.environment?.homePower || 0)} · ${escapeHtml(summary.environment?.homeXg || 0)} xG</small>
    </div>
    <div class="match-center">
      <p class="eyebrow">Match Lab</p>
      <strong>${escapeHtml(match.home)} vs ${escapeHtml(match.away)}</strong>
      ${liveScoreMarkup(data.liveScore, true, match)}
      ${score ? `
        <div class="score-prediction">
          <span>Prediction Experiment</span>
          <b>${escapeHtml(score.label)}</b>
        </div>
      ` : ""}
      <span>${escapeHtml(summary.venue || "Neutral scenario")}</span>
      <small>${escapeHtml(score?.basis || "Historical and predicted scoring model")}</small>
    </div>
    <div class="match-side away-side">
      <span>${escapeHtml(summary.away?.abbreviation || "")}</span>
      ${renderKitImage(awayLineup?.uniform, match.away, "small")}
      <h2>${escapeHtml(match.away)}</h2>
      <small>Power ${escapeHtml(summary.environment?.awayPower || 0)} · ${escapeHtml(summary.environment?.awayXg || 0)} xG</small>
    </div>
  `;

  renderPrediction(data.prediction, match, "#matchupPredictionChart", {
    market: "Market",
    squad: "Squad",
    live: "Scoring",
    expert: "Media"
  });
  renderComparison(data, "#matchupComparisonBars");
  renderPositionVisual(data, "#matchupPositionMap");
  $("#matchupAssumptions").innerHTML = (data.assumptions || []).length
    ? data.assumptions.map((item) => `
      <article class="assumption-card">
        <strong>${escapeHtml(item.label)}</strong>
        <b>${escapeHtml(item.value)}</b>
        <p>${escapeHtml(item.detail)}</p>
      </article>
    `).join("")
    : `<div class="empty">No model assumptions returned.</div>`;
  renderExpertNotes(data.expertMedia, "#matchupExpertNotes");

  const homePlayers = (data.keyPlayers?.home || []).slice(0, 5).map((player) => ({ ...player, tags: [`${match.home}`, ...(player.tags || [])] }));
  const awayPlayers = (data.keyPlayers?.away || []).slice(0, 5).map((player) => ({ ...player, tags: [`${match.away}`, ...(player.tags || [])] }));
  renderPlayerCards([...homePlayers, ...awayPlayers], "#matchupPlayers");
  renderNews(data.news, "#matchupNews");
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
  state.signalDay = await getJson(`/api/signal-day?date=${selectedDateKey()}`, options);
  renderControls(options.selection);
  renderTodayMatches();
  renderMetrics();
  renderSourceTicker();
}

async function loadSignals(options = {}) {
  state.signals = await getJson(`/api/signals?date=${selectedDateKey()}`, options);
  renderSignals(state.signals);
  if (state.apiFootball) renderApiFootball(state.apiFootball);
}

async function loadUpcomingMatches(options = {}) {
  state.upcoming = await getJson(`/api/upcoming-matches?date=${selectedDateKey()}`, options);
  renderUpcomingMatches(state.upcoming);
  if (state.apiFootball) renderApiFootball(state.apiFootball);
}

async function loadApiFootball(options = {}) {
  state.apiFootball = await getJson("/api/api-football/worldcup", options);
  renderApiFootball(state.apiFootball);
}

async function loadKnockout(options = {}) {
  const requestId = state.knockoutRequestId + 1;
  state.knockoutRequestId = requestId;
  const mode = state.knockoutMode;
  const dateKey = selectedKnockoutDateKey();
  const result = await getJson(`/api/knockout?date=${dateKey}&mode=${mode}`, options);
  if (requestId !== state.knockoutRequestId || mode !== state.knockoutMode || dateKey !== selectedKnockoutDateKey()) return;
  state.knockout = result;
  renderKnockout(state.knockout);
}

async function loadTeamRoom(options = {}) {
  const team = $("#teamRoomSelect")?.value || $("#favoriteTeamSelect").value || state.signalDay?.teams?.[0] || state.squads?.teams?.[0]?.team;
  if (!team) return;
  state.teamRoom = await getJson(`/api/team-room?date=${selectedDateKey()}&team=${encodeURIComponent(team)}`, options);
  renderTeamRoom(state.teamRoom);
}

async function loadMatchRoom(options = {}) {
  const selected = $("#todayMatchSelect").selectedOptions[0];
  const eventId = selected?.value?.startsWith("index-") || selected?.value?.startsWith("match-") ? "" : selected?.value || "";
  const matchId = selected?.dataset?.matchId || "";
  const params = new URLSearchParams({ date: selectedDateKey() });
  if (eventId) params.set("eventId", eventId);
  if (matchId) params.set("matchId", matchId);
  state.matchRoom = await getJson(`/api/match-room?${params.toString()}`, options);
  renderMatchRoom(state.matchRoom);
}

async function loadSquads(options = {}) {
  state.squads = await getJson("/api/squads", options);
  renderPlayersTable();
  renderTeamRoomControls(options.selection);
  renderMatchupControls(options.selection);
  if (state.apiFootball) renderApiFootball(state.apiFootball);
}

async function loadMatchupLab(options = {}) {
  const homeSelect = $("#matchupHomeSelect");
  const awaySelect = $("#matchupAwaySelect");
  if (!homeSelect?.value || !awaySelect?.value) return;
  if (homeSelect.value === awaySelect.value) {
    const fallback = [...awaySelect.options].find((option) => option.value !== homeSelect.value);
    if (fallback) awaySelect.value = fallback.value;
  }
  const requestId = state.matchupRequestId + 1;
  state.matchupRequestId = requestId;
  const home = homeSelect.value;
  const away = awaySelect.value;
  const result = await getJson(
    `/api/matchup-lab?date=${selectedDateKey()}&home=${encodeURIComponent(home)}&away=${encodeURIComponent(away)}`,
    options
  );
  if (requestId !== state.matchupRequestId) return;
  state.matchupLab = result;
  renderMatchupControls({
    matchupHome: state.matchupLab.match?.home || home,
    matchupAway: state.matchupLab.match?.away || away
  });
  renderMatchupLab(state.matchupLab);
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
    if (options.today) setSelectedDate(todayDateKey());
    const selection = captureSelection();
    const refreshToken = options.force ? String(Date.now()) : "";
    const requestOptions = { refreshToken };
    const refreshButton = $("#refreshButton");
    refreshButton.disabled = true;
    setStatus(options.force ? "Pulling latest" : "Refreshing");
    await Promise.all([
      loadSources(requestOptions),
      loadWorldcup26(requestOptions),
      loadSquads({ ...requestOptions, selection }),
      loadSignalDay({ ...requestOptions, selection }),
      loadSignals(requestOptions),
      loadUpcomingMatches(requestOptions),
      loadApiFootball(requestOptions),
      loadKnockout(requestOptions)
    ]);
    await Promise.all([
      loadTeamRoom(requestOptions),
      loadMatchRoom(requestOptions),
      loadMatchupLab(requestOptions)
    ]);
    setStatus(refreshTimeLabel());
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

function initializeDateControl() {
  setSelectedDate(todayDateKey());
}

function initializeTimeZoneControl() {
  if (!TIME_ZONE_OPTIONS[state.timeZone]) state.timeZone = "gmt2";
  renderTimeZoneSwitch();
}

function tickLiveTime() {
  renderFixtures();
  renderTodayMatches();
  if (state.upcoming) renderUpcomingMatches(state.upcoming);
  if (!$("#refreshButton")?.disabled && $("#refreshStatus")?.dataset.mode !== "error") {
    setStatus(refreshTimeLabel());
  }
}

function bindEvents() {
  $("#mobileMenuButton")?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMobileMenu();
  });
  document.addEventListener("click", (event) => {
    const nav = $(".nav-row");
    if (nav?.classList.contains("open") && !nav.contains(event.target)) closeMobileMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMobileMenu();
  });
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });
  $$("[data-time-zone]").forEach((button) => {
    button.addEventListener("click", () => setTimeZone(button.dataset.timeZone));
  });
  $("#fixtureSearch").addEventListener("input", renderFixtures);
  $("#matchupHomeSelect").addEventListener("change", loadMatchupLab);
  $("#matchupAwaySelect").addEventListener("change", loadMatchupLab);
  $("#runMatchupButton").addEventListener("click", loadMatchupLab);
  $("#teamRoomSelect").addEventListener("change", loadTeamRoom);
  $("#favoriteTeamSelect").addEventListener("change", () => {
    const teamRoomSelect = $("#teamRoomSelect");
    if ([...teamRoomSelect.options].some((option) => option.value === $("#favoriteTeamSelect").value)) {
      teamRoomSelect.value = $("#favoriteTeamSelect").value;
    }
    loadTeamRoom();
  });
  $("#todayMatchSelect").addEventListener("change", loadMatchRoom);
  $("#openTeamButton").addEventListener("click", async () => {
    await loadTeamRoom();
    switchView("team-room");
  });
  $("#openMatchButton").addEventListener("click", async () => {
    await loadMatchRoom();
    switchView("match-room");
  });
  $("#refreshButton").addEventListener("click", () => refreshAll({ force: true, today: true }));
  $("#matchDateInput").addEventListener("change", () => {
    const knockoutInput = $("#knockoutDateInput");
    if (knockoutInput) knockoutInput.value = $("#matchDateInput").value;
    refreshAll({ force: true });
  });
  $("#knockoutDateInput")?.addEventListener("change", () => loadKnockout({ refreshToken: String(Date.now()) }));
  $$("[data-knockout-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.knockoutMode = button.dataset.knockoutMode || "signal";
      $$("[data-knockout-mode]").forEach((item) => item.classList.toggle("active", item === button));
      loadKnockout({ refreshToken: String(Date.now()) });
    });
  });
  $$(".players-table th[data-sort]").forEach((header) => {
    header.addEventListener("click", () => {
      const key = header.dataset.sort;
      state.playerSort = {
        key,
        direction: state.playerSort.key === key && state.playerSort.direction === "desc" ? "asc" : "desc"
      };
      renderPlayersTable();
    });
  });
}

initializeTimeZoneControl();
initializeDateControl();
initializeActiveTabState();
bindEvents();
refreshAll();
setInterval(tickLiveTime, 60000);
