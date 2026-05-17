"use strict";

const STAT_DEFINITIONS = [
  ["hp", "HP"],
  ["attack", "Attack"],
  ["defense", "Defense"],
  ["special_attack", "Special Attack"],
  ["special_defense", "Special Defense"],
  ["speed", "Speed"],
];

const MAX_STAT_VALUE = 255;
const MAX_ROUND_SCORE = 600;
const DAILY_COUNT = 5;

const state = {
  pokemon: [],
  mode: "infinite",
  dailyPool: [],
  dailyIndex: 0,
  currentPokemon: null,
  answered: 0,
  totalScore: 0,
};

const elements = {
  infiniteModeButton: document.querySelector("#infiniteModeButton"),
  dailyModeButton: document.querySelector("#dailyModeButton"),
  modeTitle: document.querySelector("#modeTitle"),
  modeSummary: document.querySelector("#modeSummary"),
  scoreSummary: document.querySelector("#scoreSummary"),
  quizArea: document.querySelector("#quizArea"),
  pokemonName: document.querySelector("#pokemonName"),
  pokemonImage: document.querySelector("#pokemonImage"),
  pokemonMeta: document.querySelector("#pokemonMeta"),
  guessForm: document.querySelector("#guessForm"),
  projectedBst: document.querySelector("#projectedBst"),
  resultArea: document.querySelector("#resultArea"),
  roundScore: document.querySelector("#roundScore"),
  resultRows: document.querySelector("#resultRows"),
  actualBst: document.querySelector("#actualBst"),
  nextButton: document.querySelector("#nextButton"),
  statusMessage: document.querySelector("#statusMessage"),
};

async function start() {
  try {
    const response = await fetch("./fully_evolved_base_stats.json");

    if (!response.ok) {
      throw new Error(`Data request failed with status ${response.status}`);
    }

    state.pokemon = await response.json();

    elements.infiniteModeButton.addEventListener("click", () => setMode("infinite"));
    elements.dailyModeButton.addEventListener("click", () => setMode("daily"));
    elements.guessForm.addEventListener("input", updateProjectedBst);
    elements.guessForm.addEventListener("submit", handleGuessSubmit);
    elements.nextButton.addEventListener("click", showNextPokemon);

    elements.quizArea.hidden = false;
    elements.statusMessage.hidden = true;
    setMode("infinite");
  } catch (error) {
    elements.statusMessage.textContent =
      "Unable to load fully_evolved_base_stats.json. Run this through a local web server instead of opening the HTML file directly.";
    console.error(error);
  }
}

function setMode(mode) {
  state.mode = mode;
  state.answered = 0;
  state.totalScore = 0;
  state.dailyIndex = 0;
  state.dailyPool = mode === "daily" ? buildDailyPool() : [];

  elements.modeTitle.textContent = mode === "daily" ? "Daily mode" : "Infinite mode";
  elements.nextButton.textContent = "Next Pokemon";
  updateSummary();
  showNextPokemon();
}

function buildDailyPool() {
  const rng = mulberry32(xmur3(getUtcDateSeed())());
  const pool = [...state.pokemon];

  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool.slice(0, DAILY_COUNT);
}

function getUtcDateSeed() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");

  return `pokemon-stat-guess-${year}-${month}-${day}`;
}

function getDisplayDateSeed() {
  return `${getUtcDateSeed()}-UTC`;
}

function showNextPokemon() {
  if (state.mode === "daily" && state.dailyIndex >= state.dailyPool.length) {
    finishDaily();
    return;
  }

  state.currentPokemon =
    state.mode === "daily"
      ? state.dailyPool[state.dailyIndex]
      : state.pokemon[Math.floor(Math.random() * state.pokemon.length)];

  if (state.mode === "daily") {
    state.dailyIndex += 1;
  }

  renderPokemon();
  clearGuessForm();
  updateSummary();
}

function renderPokemon() {
  const pokemon = state.currentPokemon;

  elements.pokemonName.textContent = formatPokemonName(pokemon.name);
  elements.pokemonImage.src = getArtworkUrl(pokemon.id);
  elements.pokemonImage.alt = formatPokemonName(pokemon.name);
  elements.pokemonImage.hidden = false;
  elements.pokemonMeta.textContent = `Types: ${pokemon.types.map(formatPokemonName).join(", ")}`;
  elements.guessForm.hidden = false;
  elements.resultArea.hidden = true;
  elements.nextButton.hidden = false;
}

function clearGuessForm() {
  elements.guessForm.reset();
  updateProjectedBst();

  for (const input of elements.guessForm.elements) {
    if (input instanceof HTMLInputElement) {
      input.disabled = false;
    }
  }
}

function updateProjectedBst() {
  const total = STAT_DEFINITIONS.reduce((sum, [statKey]) => {
    const input = elements.guessForm.elements[statKey];
    const value = input.value === "" ? 0 : Number(input.value);

    return Number.isFinite(value) ? sum + value : sum;
  }, 0);

  elements.projectedBst.textContent = `Projected BST: ${total}`;
}

function handleGuessSubmit(event) {
  event.preventDefault();

  const guesses = {};

  for (const [statKey] of STAT_DEFINITIONS) {
    const input = elements.guessForm.elements[statKey];
    const value = Number(input.value);

    if (!Number.isInteger(value) || value < 0 || value > MAX_STAT_VALUE) {
      input.setCustomValidity("Enter a whole number from 0 to 255.");
      input.reportValidity();
      input.setCustomValidity("");
      return;
    }

    guesses[statKey] = value;
  }

  const result = scoreGuess(state.currentPokemon, guesses);
  state.answered += 1;
  state.totalScore += result.total;

  renderResult(result);
  updateSummary();
}

function scoreGuess(pokemon, guesses) {
  const rows = STAT_DEFINITIONS.map(([statKey, label]) => {
    const actual = pokemon.base_stats[statKey];
    const guess = guesses[statKey];
    
    //Can be adjusted later if need be, but for now going with the simple value
    //This will result in every missed stat point losing 1 point
    const maxDeviation = 100;

    const deviation = Math.abs(actual - guess);
    
    //Using a ratio here in case maxDeviation is adjusted in the future
    const score = Math.round((Math.max((maxDeviation - deviation), 0) / maxDeviation) * 100);

    return {
      label,
      guess,
      actual,
      score,
    };
  });

  return {
    rows,
    total: rows.reduce((sum, row) => sum + row.score, 0),
  };
}

function renderResult(result) {
  elements.roundScore.textContent = `${result.total}/${MAX_ROUND_SCORE} points`;
  elements.resultRows.replaceChildren();

  for (const row of result.rows) {
    const tableRow = document.createElement("tr");
    tableRow.append(
      buildCell(row.label),
      buildCell(String(row.guess)),
      buildCell(String(row.actual)),
      buildCell(String(row.score)),
    );
    elements.resultRows.append(tableRow);
  }

  elements.actualBst.textContent = `Base stat total: ${state.currentPokemon.base_stat_total}`;
  elements.guessForm.hidden = true;
  elements.resultArea.hidden = false;

  if (state.mode === "daily" && state.dailyIndex >= DAILY_COUNT) {
    elements.nextButton.textContent = "Finish daily";
  }
}

function buildCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text;
  return cell;
}

function updateSummary() {
  if (state.mode === "daily") {
    elements.modeSummary.textContent = `Daily seed: ${getDisplayDateSeed()}. Pokemon ${state.dailyIndex} of ${DAILY_COUNT}.`;
  } else {
    elements.modeSummary.textContent = "Random Pokemon will continue until you stop.";
  }

  const average = state.answered === 0 ? 0 : Math.round(state.totalScore / state.answered);
  elements.scoreSummary.textContent = `Answered: ${state.answered}. Total score: ${state.totalScore}. Average: ${average}/${MAX_ROUND_SCORE}.`;
}

function finishDaily() {
  elements.pokemonName.textContent = "Daily complete";
  elements.pokemonImage.removeAttribute("src");
  elements.pokemonImage.alt = "";
  elements.pokemonImage.hidden = true;
  elements.pokemonMeta.textContent = "";
  elements.guessForm.hidden = true;
  elements.resultArea.hidden = true;
  elements.nextButton.hidden = true;
  updateSummary();
}

function formatPokemonName(name) {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getArtworkUrl(id) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
}

function xmur3(seed) {
  let h = 1779033703 ^ seed.length;

  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }

  return function nextHash() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

start();
