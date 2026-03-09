"""
D1 Men's Basketball Data Scraper

Sources:
  - ESPN unofficial API (teams, records, stats)
  - https://www.ncaa.com/rankings/basketball-men/d1 (NET rankings)

Usage:
  python scraper.py --target teams
  python scraper.py --target rankings
  python scraper.py --target stats
  python scraper.py --target all

Output: scraper/output/{teams,rankings}.json
        (also optionally uploaded to S3)
"""

import argparse
import json
import time
import os
import re
from pathlib import Path
from datetime import datetime

import requests
from dotenv import load_dotenv

load_dotenv()

OUTPUT_DIR = Path(__file__).parent / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

# Polite delay between requests (seconds)
REQUEST_DELAY = 0.4

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; ScheduleMarketplaceScraper/1.0; "
        "+https://github.com/example/schedule-marketplace)"
    ),
    "Accept": "application/json,text/html,*/*",
    "Accept-Language": "en-US,en;q=0.9",
}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)

# ESPN API — mens college basketball group 50 = D1
ESPN_TEAMS_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/basketball/"
    "mens-college-basketball/teams?limit=500&groups=50"
)
ESPN_TEAM_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/basketball/"
    "mens-college-basketball/teams/{team_id}?enable=roster,projection,stats"
)
ESPN_SCHEDULE_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/basketball/"
    "mens-college-basketball/teams/{team_id}/schedule?season={season_year}"
)

# Maps ESPN season year (the year the season ends) to our season label
SEASON_YEAR_TO_LABEL = {2025: "2024-25", 2026: "2025-26"}

LOCATION_WEIGHTS = {"home": 0.6, "away": 1.4, "neutral": 1.0}
QUADRANT_THRESHOLDS = {
    "away":    {"q1": 30,  "q2": 75,  "q3": 135},
    "neutral": {"q1": 50,  "q2": 100, "q3": 200},
    "home":    {"q1": 75,  "q2": 135, "q3": 240},
}

NCAA_RANKINGS_URL = (
    "https://ncaa-api.henrygd.me/rankings/basketball-men/d1/"
    "ncaa-mens-basketball-net-rankings"
)
NCAA_STANDINGS_URL = "https://ncaa-api.henrygd.me/standings/basketball-men/d1"


# ========================
# UTILITIES
# ========================

def fetch_json(url: str, retries: int = 3) -> dict | None:
    for attempt in range(retries):
        try:
            print(f"  GET {url}")
            resp = SESSION.get(url, timeout=15)
            resp.raise_for_status()
            time.sleep(REQUEST_DELAY)
            return resp.json()
        except (requests.RequestException, ValueError) as e:
            print(f"  Attempt {attempt + 1} failed: {e}")
            if attempt < retries - 1:
                time.sleep(REQUEST_DELAY * (attempt + 2))
    return None



def save_json(data: list | dict, filename: str) -> Path:
    path = OUTPUT_DIR / filename
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    count = len(data) if isinstance(data, list) else len(data) if isinstance(data, dict) else 1
    print(f"  Saved {count} records to {path}")
    return path


def _safe_float(val) -> float | None:
    try:
        return float(str(val).replace(",", ""))
    except (ValueError, TypeError):
        return None


def _safe_int(val) -> int:
    try:
        return int(str(val).replace(",", ""))
    except (ValueError, TypeError):
        return 0


def _make_short_name(name: str) -> str:
    stopwords = {"University", "College", "State", "of", "the", "at", "A&M"}
    parts = [p for p in name.split() if p not in stopwords]
    return parts[-1] if parts else name[:8]


# henrygd uses NCAA-style abbreviated school names. These expansions normalize
# them to full names so they match ESPN display names after mascot stripping.
_ABBR_EXPANSIONS = [
    # Geographic abbreviations used in compound directional names
    (" mich.",      " michigan"),
    (" ky.",        " kentucky"),
    (" caro.",      " carolina"),
    (" ill.",       " illinois"),
    (" ark.",       " arkansas"),
    (" wash.",      " washington"),
    (" conn.",      " connecticut"),
    (" mo.",        " missouri"),
    (" colo.",      " colorado"),
    (" ariz.",      " arizona"),
    (" fla.",       " florida"),
    (" tenn.",      " tennessee"),
    (" ala.",       " alabama"),
    (" miss.",      " mississippi"),
    (" la.",        " louisiana"),
    (" ind.",       " indiana"),
    (" pa.",        " pennsylvania"),
    (" ga.",        " georgia"),
    (" so.",        " southern"),
    (" val.",       " valley state"),   # "Mississippi Val." → "Mississippi Valley State"
    # "St." in the middle/end = State; "St." at start = Saint (space-prefixed check)
    (" st.",        " state"),
    # Institution-type abbreviations
    ("col. of ",    "college of "),
    (" u.",         " university"),
    # Cal State variants
    ("cal st. ",    "cal state "),
    ("csu ",        "cal state "),
    # Hyphenated state abbreviations
    ("ark.-",       "arkansas-"),
    ("se mo.",      "southeast missouri"),
    # Named exceptions
    ("app state",           "appalachian state"),
    ("army west point",     "army"),
    ("southeastern la.",    "southeastern louisiana"),
]

# Acronym → full name expansions applied with word boundaries (\b) so they
# don't corrupt substrings (e.g. "uni" must not match inside "university").
_ACRONYM_EXPANSIONS: dict[str, str] = {
    "niu":   "northern illinois",
    "siue":  "siu edwardsville",
    "uiw":   "incarnate word",
    "fdu":   "fairleigh dickinson",
    "utrgv": "ut rio grande valley",
    "uni":   "northern iowa",
    "liu":   "long island university",
    "etsu":  "east tennessee state",
    "sfa":   "stephen f austin",
    "njit":  "new jersey institute technology",
    "uncw":  "unc wilmington",
    "lmu":   "loyola marymount",
    "csun":  "cal state northridge",
    "usc":   "southern california",
}

# Normalized ESPN names (after mascot strip) that need explicit remapping because
# no abbreviation expansion can bridge the gap.
_CANONICAL_OVERRIDES: dict[str, str] = {
    "southern miss":        "southern mississippi",      # ESPN omits the period
    "se louisiana":         "southeastern louisiana",    # abbreviation mismatch
    "iu indianapolis":      "iu indy",                   # henrygd uses "Indy"
    "pennsylvania":         "penn",                      # Ivy League Penn
    "central connecticut":  "central connecticut state", # ESPN drops "State"
    "charleston":           "college of charleston",     # ESPN omits "College of"
    "lamar":                "lamar university",          # ESPN: "Lamar Cardinals" → "Lamar"
    "ul monroe":            "ulm",                       # henrygd abbreviates as "ULM"
}

# Full ESPN team name overrides (normalized, before stripping) — used when
# stripping the mascot would yield an ambiguous or wrong short name.
_FULL_NAME_OVERRIDES: dict[str, str] = {
    "southern jaguars": "southern university",  # "southern" alone matches too broadly
}


def _normalize_name(name: str) -> str:
    """
    Normalize a school name for cross-source matching.
    Expands common NCAA abbreviations, strips accents, and removes punctuation.
    """
    import re, unicodedata
    s = name.lower().strip()

    # Normalize accented characters (e.g. "José" → "Jose")
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")

    # Remove parenthetical state/region disambiguators: "(CA)", "(MN)", "(OH)", etc.
    s = re.sub(r"\s*\([^)]+\)", "", s)

    # Apply substring abbreviation expansions (suffix-style, inherently word-scoped)
    for abbr, full in _ABBR_EXPANSIONS:
        s = s.replace(abbr, full)

    # Remove punctuation (keep hyphens for compound names like "arkansas-pine bluff")
    s = re.sub(r"[.'&,]", "", s)

    # Apply acronym expansions with word boundaries — must run AFTER punctuation
    # removal so "LIU" becomes "liu" before matching, and "university" is safe
    for acronym, expansion in _ACRONYM_EXPANSIONS.items():
        s = re.sub(r"\b" + re.escape(acronym) + r"\b", expansion, s)

    # Collapse whitespace
    s = " ".join(s.split())
    return s


def _build_lookup(entries: list[dict], name_key: str) -> dict:
    """Build a normalized-name → entry lookup dict."""
    return {_normalize_name(e[name_key]): e for e in entries}


def _lookup_team(espn_name: str, lookup: dict):
    """
    Find a team in a normalized lookup dict given an ESPN display name.

    - Checks _FULL_NAME_OVERRIDES first (full team name, pre-strip)
    - Strips trailing words one at a time to remove the mascot
    - Checks _CANONICAL_OVERRIDES for known ESPN↔NCAA name gaps
    - Falls back to dehyphenating compound words for qualifiers like "-Minnesota"
    """
    full_norm = _normalize_name(espn_name)

    # Full-name override before any stripping
    if full_norm in _FULL_NAME_OVERRIDES:
        target = _FULL_NAME_OVERRIDES[full_norm]
        if target in lookup:
            return lookup[target]

    words = espn_name.split()
    for length in range(len(words), 0, -1):
        candidate = _normalize_name(" ".join(words[:length]))

        if candidate in lookup:
            return lookup[candidate]

        # Canonical override (e.g. "pennsylvania" → "penn")
        override = _CANONICAL_OVERRIDES.get(candidate)
        if override and override in lookup:
            return lookup[override]

        # Dehyphenate compound words and re-strip
        if "-" in candidate:
            sub_words = candidate.replace("-", " ").split()
            for sub_len in range(len(sub_words), 0, -1):
                sub = " ".join(sub_words[:sub_len])
                if sub in lookup:
                    return lookup[sub]
                override = _CANONICAL_OVERRIDES.get(sub)
                if override and override in lookup:
                    return lookup[override]

    return None


# ========================
# ESPN TEAMS SCRAPER
# ========================

def scrape_teams_espn() -> list[dict]:
    """
    Fetch all D1 teams from the ESPN API bulk endpoint.
    Returns a list of team dicts with basic info (no per-team stats).
    """
    print("\n[Teams] Fetching D1 team list from ESPN...")

    data = fetch_json(ESPN_TEAMS_URL)
    if not data:
        print("  Failed to fetch ESPN teams.")
        return []

    raw_teams = data.get("sports", [{}])[0].get("leagues", [{}])[0].get("teams", [])
    if not raw_teams:
        # Alternate structure
        raw_teams = data.get("teams", [])

    teams = []
    for entry in raw_teams:
        t = entry.get("team", entry)  # some responses nest under "team"
        espn_id = str(t.get("id", ""))
        slug = t.get("slug", "")
        name = t.get("displayName", t.get("name", ""))
        short_name = t.get("abbreviation", _make_short_name(name))
        conference = ""
        conf_obj = t.get("groups", {})
        if isinstance(conf_obj, dict):
            conference = conf_obj.get("name", "")

        if not espn_id or not name:
            continue

        teams.append({
            "id": slug or espn_id,
            "espnId": espn_id,
            "name": name,
            "shortName": short_name,
            "conference": conference,
            "division": "D1",
            "netRanking": None,
            "wins": 0,
            "losses": 0,
            "homeWins": 0, "homeLosses": 0,
            "awayWins": 0, "awayLosses": 0,
            "neutralWins": 0, "neutralLosses": 0,
            "confWins": 0, "confLosses": 0,
            "ppg": None,
            "oppPpg": None,
            "netEfficiency": None,
            "updatedAt": int(datetime.now().timestamp() * 1000),
        })

    print(f"  Found {len(teams)} teams.")
    return teams


# ========================
# ESPN PER-TEAM STATS
# ========================

def _parse_record(record_obj: dict) -> tuple[int, int]:
    """Parse an ESPN record object into (wins, losses)."""
    summary = record_obj.get("summary", "0-0")
    parts = summary.split("-")
    if len(parts) >= 2:
        return _safe_int(parts[0]), _safe_int(parts[1])
    return _safe_int(record_obj.get("wins", 0)), _safe_int(record_obj.get("losses", 0))


def fetch_team_stats(team: dict) -> dict:
    """
    Fetch per-team stats from ESPN and enrich the team dict in-place.
    Returns the updated team dict.
    """
    espn_id = team.get("espnId")
    if not espn_id:
        return team

    url = ESPN_TEAM_URL.format(team_id=espn_id)
    data = fetch_json(url)
    if not data:
        return team

    team_obj = data.get("team", {})

    # Records — ESPN returns an array of record objects
    records = team_obj.get("record", {}).get("items", [])
    for rec in records:
        rec_type = rec.get("type", "")
        rec_name = rec.get("name", "")
        label = (rec_type + rec_name).lower()

        w, l = _parse_record(rec)

        if "overall" in label or "total" in label:
            team["wins"] = w
            team["losses"] = l
        elif "home" in label:
            team["homeWins"] = w
            team["homeLosses"] = l
        elif "road" in label or "away" in label:
            team["awayWins"] = w
            team["awayLosses"] = l
        elif "conference" in label or "conf" in label:
            team["confWins"] = w
            team["confLosses"] = l

    # Neutral = total - home - away
    team["neutralWins"] = max(0, team["wins"] - team["homeWins"] - team["awayWins"])
    team["neutralLosses"] = max(0, team["losses"] - team["homeLosses"] - team["awayLosses"])

    # PPG / OppPPG — ESPN embeds these in the overall record's stats array
    for rec in records:
        rec_type = rec.get("type", "")
        if "total" not in rec_type and "overall" not in rec_type.lower():
            continue
        for stat in rec.get("stats", []):
            sname = stat.get("name", "").lower()
            val = stat.get("value")
            if sname in ("avgpointsfor", "pointspergame", "scoringoffense", "ppg"):
                team["ppg"] = _safe_float(val)
            elif sname in ("avgpointsagainst", "opponentpointspergame", "scoringdefense", "opppg"):
                team["oppPpg"] = _safe_float(val)

    # ESPN also exposes ranking directly
    ranking = team_obj.get("ranks", [])
    for r in ranking:
        if r.get("type", "").lower() in ("net", "ncaanet"):
            team["netRanking"] = _safe_int(r.get("current", 0)) or None

    # netEfficiency: point differential per game (best proxy from free public data)
    ppg = team.get("ppg")
    opp = team.get("oppPpg")
    if ppg is not None and opp is not None:
        team["netEfficiency"] = round(ppg - opp, 2)

    team["updatedAt"] = int(datetime.now().timestamp() * 1000)
    return team


def scrape_stats_espn(teams: list[dict]) -> list[dict]:
    """Enrich each team with per-team stats from ESPN (one request per team)."""
    print(f"\n[Stats] Fetching per-team stats for {len(teams)} teams from ESPN...")
    print("  (This makes one API call per team — may take a few minutes)")

    for i, team in enumerate(teams, 1):
        print(f"  [{i}/{len(teams)}] {team['name']}")
        fetch_team_stats(team)

    return teams


# ========================
# NET RANKINGS SCRAPER
# ========================

def scrape_net_rankings() -> list[dict]:
    """
    Fetch NET rankings from ncaa-api.henrygd.me (a JSON wrapper around ncaa.com).
    ncaa.com's rankings page is JS/GraphQL rendered so direct HTML scraping only
    returns ~25 rows. This API returns all ~365 D1 teams in one request.
    Returns list of {rank, teamName, conference, record}.
    """
    print("\n[NET Rankings] Fetching NET rankings from ncaa-api.henrygd.me...")

    data = fetch_json(NCAA_RANKINGS_URL)
    rankings = []

    if data:
        for entry in data.get("data", []):
            rank = entry.get("Rank")
            team = entry.get("School", "")
            if not rank or not team:
                continue
            rankings.append({
                "rank":       int(rank),
                "teamName":   team,
                "conference": entry.get("Conf", ""),
                "record":     entry.get("Record", ""),
                "home":       entry.get("Home", "0-0"),
                "road":       entry.get("Road", "0-0"),
                "neutral":    entry.get("Neutral", "0-0"),
            })

    if not rankings:
        print("  No NET rankings found — may not be published yet (in-season: Nov–Mar).")
    else:
        print(f"  Found {len(rankings)} NET rankings.")

    return rankings


def scrape_standings() -> list[dict]:
    """
    Fetch conference standings from ncaa-api.henrygd.me.
    Returns a flat list of { School, confWins, confLosses } dicts.
    """
    print("\n[Standings] Fetching conference standings from ncaa-api.henrygd.me...")

    data = fetch_json(NCAA_STANDINGS_URL)
    result = []

    if data:
        for conf_block in data.get("data", []):
            for entry in conf_block.get("standings", []):
                school = entry.get("School", "").strip()
                if not school:
                    continue
                result.append({
                    "School":     school,
                    "confWins":   _safe_int(entry.get("Conference W", 0)),
                    "confLosses": _safe_int(entry.get("Conference L", 0)),
                })

    print(f"  Found standings for {len(result)} teams.")
    return result


def merge_standings_into_teams(standings: list[dict], teams: list[dict]) -> list[dict]:
    """Apply conference win/loss records to the teams list."""
    lookup = _build_lookup(standings, "School")
    for team in teams:
        entry = _lookup_team(team["name"], lookup)
        if entry:
            team["confWins"]   = entry["confWins"]
            team["confLosses"] = entry["confLosses"]
    return teams


def _parse_wl(record_str: str) -> tuple[int, int]:
    """Parse a 'W-L' string like '10-1' into (wins, losses)."""
    parts = str(record_str).split("-")
    if len(parts) == 2:
        return _safe_int(parts[0]), _safe_int(parts[1])
    return 0, 0


def merge_rankings_into_teams(rankings: list[dict], teams: list[dict]) -> list[dict]:
    """
    Apply NET rankings data to the teams list.

    Sets from NET rankings (more reliable than ESPN public API):
      - netRanking, conference
      - homeWins/homeLosses, awayWins/awayLosses, neutralWins/neutralLosses
      - wins/losses (overall, if ESPN didn't provide them)

    confWins/confLosses are handled separately via merge_standings_into_teams.
    """
    rank_map = _build_lookup(rankings, "teamName")

    for team in teams:
        entry = _lookup_team(team["name"], rank_map)
        if not entry:
            continue

        if not team.get("netRanking"):
            team["netRanking"] = entry["rank"]
        if not team.get("conference"):
            team["conference"] = entry.get("conference", "")

        # Location records from NET rankings are authoritative
        hw, hl = _parse_wl(entry.get("home", "0-0"))
        rw, rl = _parse_wl(entry.get("road", "0-0"))
        nw, nl = _parse_wl(entry.get("neutral", "0-0"))
        team["homeWins"]      = hw
        team["homeLosses"]    = hl
        team["awayWins"]      = rw
        team["awayLosses"]    = rl
        team["neutralWins"]   = nw
        team["neutralLosses"] = nl

        # Overall wins/losses — use ESPN value if present, else sum location records
        if not team.get("wins") and not team.get("losses"):
            team["wins"]   = hw + rw + nw
            team["losses"] = hl + rl + nl

    return teams


# ========================
# SOS CALCULATION
# ========================

def _compute_sos(games: list[dict]) -> float | None:
    valid = [g for g in games if g.get("opponentNetRanking") and g.get("status") != "cancelled"]
    if not valid:
        return None
    w_sum = sum(g["opponentNetRanking"] * LOCATION_WEIGHTS.get(g["location"], 1.0) for g in valid)
    w_total = sum(LOCATION_WEIGHTS.get(g["location"], 1.0) for g in valid)
    return round(w_sum / w_total * 10) / 10


def _get_quadrant(net: int, location: str) -> int:
    t = QUADRANT_THRESHOLDS.get(location, QUADRANT_THRESHOLDS["neutral"])
    if net <= t["q1"]: return 1
    if net <= t["q2"]: return 2
    if net <= t["q3"]: return 3
    return 4


def _build_quadrant_breakdown(games: list[dict]) -> dict:
    b = {f"q{q}{r}": 0 for q in range(1, 5) for r in ("Wins", "Losses")}
    for g in games:
        if g.get("status") != "completed" or not g.get("opponentNetRanking") or not g.get("result"):
            continue
        q = _get_quadrant(g["opponentNetRanking"], g["location"])
        key = f"q{q}{'Wins' if g['result'] == 'W' else 'Losses'}"
        b[key] += 1
    return b


# ========================
# ESPN SCHEDULE SCRAPER
# ========================

def scrape_schedules_espn(teams: list[dict], season_years: list[int]) -> dict[str, list[dict]]:
    """
    Fetch per-team game schedules from ESPN for each season year.
    season_year=2025 → 2024-25 season, season_year=2026 → 2025-26 season.
    Returns {season_label: [TeamSchedule, ...]}
    """
    # Build lookups to resolve opponent ESPN IDs back to our team slugs/NET rankings
    espn_id_to_team = {str(t["espnId"]): t for t in teams if t.get("espnId")}

    results = {}

    for season_year in season_years:
        season_label = SEASON_YEAR_TO_LABEL.get(season_year, f"{season_year-1}-{str(season_year)[2:]}")
        print(f"\n[Schedules] Fetching {season_label} schedules from ESPN ({len(teams)} teams)...")
        print("  (One request per team — ~2-3 minutes)")

        schedules = []

        for i, team in enumerate(teams, 1):
            espn_id = str(team.get("espnId", ""))
            if not espn_id:
                continue

            print(f"  [{i}/{len(teams)}] {team['name']}")
            url = ESPN_SCHEDULE_URL.format(team_id=espn_id, season_year=season_year)
            time.sleep(1.0)  # slower rate for schedule endpoint to avoid throttling
            data = fetch_json(url)
            if not data:
                continue

            games = []
            game_counter = 0

            for event in data.get("events", []):
                comps = event.get("competitions", [])
                if not comps:
                    continue
                comp = comps[0]
                competitors = comp.get("competitors", [])

                # Split into this team vs opponent
                my_comp = next((c for c in competitors if str(c.get("team", {}).get("id", "")) == espn_id), None)
                opp_comp = next((c for c in competitors if str(c.get("team", {}).get("id", "")) != espn_id), None)
                if not my_comp or not opp_comp:
                    continue

                # Location
                if comp.get("neutralSite", False):
                    location = "neutral"
                elif my_comp.get("homeAway") == "home":
                    location = "home"
                else:
                    location = "away"

                # Status
                status_name = comp.get("status", {}).get("type", {}).get("name", "")
                completed = comp.get("status", {}).get("type", {}).get("completed", False)
                if "CANCEL" in status_name or "POSTPONE" in status_name:
                    status = "cancelled"
                elif completed:
                    status = "completed"
                else:
                    status = "scheduled"

                # Result & scores
                result = None
                home_score = away_score = None
                if status == "completed":
                    result = "W" if my_comp.get("winner") else "L"
                    try:
                        my_score = int(my_comp.get("score") or 0)
                        opp_score = int(opp_comp.get("score") or 0)
                        if location == "home":
                            home_score, away_score = my_score, opp_score
                        elif location == "away":
                            home_score, away_score = opp_score, my_score
                        else:
                            home_score, away_score = my_score, opp_score
                    except (ValueError, TypeError):
                        pass

                # Opponent info
                opp_team_obj = opp_comp.get("team", {})
                opp_espn_id = str(opp_team_obj.get("id", ""))
                opp_data = espn_id_to_team.get(opp_espn_id)
                opp_id = opp_data["id"] if opp_data else f"espn-{opp_espn_id}"
                opp_name = opp_team_obj.get("displayName", opp_team_obj.get("name", "Unknown"))
                opp_net = opp_data.get("netRanking") if opp_data else None

                # Date (YYYY-MM-DD)
                raw_date = event.get("date", "")
                game_date = raw_date[:10] if raw_date else ""

                is_conference = bool(comp.get("conferenceCompetition", False))

                game_counter += 1
                games.append({
                    "id": f"{team['id']}-{season_year}-g{game_counter}",
                    "date": game_date,
                    "opponentId": opp_id,
                    "opponentName": opp_name,
                    "opponentNetRanking": opp_net,
                    "location": location,
                    "isConference": is_conference,
                    "status": status,
                    "result": result,
                    "homeScore": home_score,
                    "awayScore": away_score,
                })

            schedules.append({
                "id": f"{team['id']}-{season_label}",
                "teamId": team["id"],
                "teamName": team["name"],
                "conference": team.get("conference", ""),
                "season": season_label,
                "games": games,
                "openDates": [],
                "strengthOfSchedule": _compute_sos(games),
                "sosQuadrantBreakdown": _build_quadrant_breakdown(games),
                "isPublic": True,
                "owner_id": "system",
                "updatedAt": int(datetime.now().timestamp() * 1000),
            })

        results[season_label] = schedules
        print(f"  Built {len(schedules)} schedules for {season_label}")

    return results


# ========================
# S3 UPLOAD
# ========================

def upload_to_s3(local_path: Path, bucket: str, key: str):
    import boto3
    s3 = boto3.client("s3")
    s3.upload_file(str(local_path), bucket, key)
    print(f"  Uploaded to s3://{bucket}/{key}")


# ========================
# MAIN
# ========================

def main():
    parser = argparse.ArgumentParser(description="Schedule Marketplace Scraper")
    parser.add_argument(
        "--target",
        choices=["teams", "rankings", "stats", "schedules", "all"],
        default="all",
        help="What to scrape (teams=ESPN bulk list, stats=per-team ESPN stats, rankings=ncaa.com NET, schedules=per-team game schedules)",
    )
    parser.add_argument(
        "--upload-s3",
        action="store_true",
        help="Upload output JSON files to S3 (set S3_SCRAPER_BUCKET env var)",
    )
    args = parser.parse_args()

    s3_bucket = os.getenv("S3_SCRAPER_BUCKET")

    if args.target == "all":
        teams = scrape_teams_espn()
        teams = scrape_stats_espn(teams)
        rankings = scrape_net_rankings()
        standings = scrape_standings()
        rankings_path = save_json(rankings, "rankings.json")
        teams = merge_rankings_into_teams(rankings, teams)
        teams = merge_standings_into_teams(standings, teams)
        teams_path = save_json(teams, "teams.json")

        if args.upload_s3 and s3_bucket:
            upload_to_s3(teams_path, s3_bucket, "scraper/teams.json")
            upload_to_s3(rankings_path, s3_bucket, "scraper/rankings.json")

    elif args.target == "teams":
        teams = scrape_teams_espn()
        rankings_file = OUTPUT_DIR / "rankings.json"
        if rankings_file.exists():
            with open(rankings_file) as f:
                rankings = json.load(f)
        else:
            rankings = scrape_net_rankings()
            save_json(rankings, "rankings.json")
        standings = scrape_standings()
        teams = merge_rankings_into_teams(rankings, teams)
        teams = merge_standings_into_teams(standings, teams)
        path = save_json(teams, "teams.json")
        if args.upload_s3 and s3_bucket:
            upload_to_s3(path, s3_bucket, "scraper/teams.json")

    elif args.target == "stats":
        teams_file = OUTPUT_DIR / "teams.json"
        if not teams_file.exists():
            print("Run --target teams first to create teams.json")
            return
        with open(teams_file) as f:
            teams = json.load(f)
        teams = scrape_stats_espn(teams)
        standings = scrape_standings()
        teams = merge_standings_into_teams(standings, teams)
        path = save_json(teams, "teams.json")
        if args.upload_s3 and s3_bucket:
            upload_to_s3(path, s3_bucket, "scraper/teams.json")

    elif args.target == "rankings":
        rankings = scrape_net_rankings()
        standings = scrape_standings()
        path = save_json(rankings, "rankings.json")
        if args.upload_s3 and s3_bucket:
            upload_to_s3(path, s3_bucket, "scraper/rankings.json")

        # Also merge into teams if available
        teams_file = OUTPUT_DIR / "teams.json"
        if teams_file.exists():
            with open(teams_file) as f:
                teams = json.load(f)
            teams = merge_rankings_into_teams(rankings, teams)
            teams = merge_standings_into_teams(standings, teams)
            teams_path = save_json(teams, "teams.json")
            if args.upload_s3 and s3_bucket:
                upload_to_s3(teams_path, s3_bucket, "scraper/teams.json")

    elif args.target == "schedules":
        teams_file = OUTPUT_DIR / "teams.json"
        if not teams_file.exists():
            print("Run --target teams first to create teams.json")
            return
        with open(teams_file) as f:
            teams = json.load(f)
        # Scrape 2024-25 (season=2025) and 2025-26 (season=2026)
        season_results = scrape_schedules_espn(teams, [2025, 2026])
        for season_label, schedules in season_results.items():
            filename = f"schedules-{season_label}.json"
            path = save_json(schedules, filename)
            if args.upload_s3 and s3_bucket:
                upload_to_s3(path, s3_bucket, f"scraper/{filename}")

    print("\nDone!")


if __name__ == "__main__":
    main()
