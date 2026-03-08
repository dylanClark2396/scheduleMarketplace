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

NCAA_RANKINGS_URL = (
    "https://ncaa-api.henrygd.me/rankings/basketball-men/d1/"
    "ncaa-mens-basketball-net-rankings"
)


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

    # Conference
    conf = team_obj.get("groups", {})
    if isinstance(conf, dict) and conf.get("name"):
        team["conference"] = conf["name"]

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

    # Stats — ESPN returns statistics categories
    statistics = team_obj.get("teamStats", team_obj.get("statistics", {}))
    if isinstance(statistics, dict):
        stat_items = statistics.get("splits", {}).get("categories", [])
    elif isinstance(statistics, list):
        stat_items = statistics
    else:
        stat_items = []

    for category in stat_items:
        stats = category.get("stats", [])
        for stat in stats:
            name = stat.get("name", "").lower()
            val = stat.get("value")
            if name in ("pointspergame", "scoringoffense", "ppg"):
                team["ppg"] = _safe_float(val)
            elif name in ("opponentpointspergame", "scoringdefense", "opppg"):
                team["oppPpg"] = _safe_float(val)

    # ESPN also exposes ranking directly
    ranking = team_obj.get("ranks", [])
    for r in ranking:
        if r.get("type", "").lower() in ("net", "ncaanet"):
            team["netRanking"] = _safe_int(r.get("current", 0)) or None

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
                "rank": int(rank),
                "teamName": team,
                "conference": entry.get("Conf", ""),
                "record": entry.get("Record", ""),
            })

    if not rankings:
        print("  No NET rankings found — may not be published yet (in-season: Nov–Mar).")
    else:
        print(f"  Found {len(rankings)} NET rankings.")

    return rankings


def merge_rankings_into_teams(rankings: list[dict], teams: list[dict]) -> list[dict]:
    """Apply NET rankings to the teams list. Matches by name (exact then partial)."""
    rank_map = {r["teamName"].lower(): r["rank"] for r in rankings}

    for team in teams:
        # Skip if ESPN already gave us a NET ranking
        if team.get("netRanking"):
            continue

        name_lower = team["name"].lower()
        net = rank_map.get(name_lower)

        if not net:
            # Partial match fallback
            for rname, rank in rank_map.items():
                if rname in name_lower or name_lower in rname:
                    net = rank
                    break

        if net:
            team["netRanking"] = net

    return teams


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
        choices=["teams", "rankings", "stats", "all"],
        default="all",
        help="What to scrape (teams=ESPN bulk list, stats=per-team ESPN stats, rankings=ncaa.com NET)",
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
        rankings_path = save_json(rankings, "rankings.json")
        teams = merge_rankings_into_teams(rankings, teams)
        teams_path = save_json(teams, "teams.json")

        if args.upload_s3 and s3_bucket:
            upload_to_s3(teams_path, s3_bucket, "scraper/teams.json")
            upload_to_s3(rankings_path, s3_bucket, "scraper/rankings.json")

    elif args.target == "teams":
        teams = scrape_teams_espn()
        # Load existing rankings if available to merge
        rankings_file = OUTPUT_DIR / "rankings.json"
        if rankings_file.exists():
            with open(rankings_file) as f:
                rankings = json.load(f)
            teams = merge_rankings_into_teams(rankings, teams)
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
        path = save_json(teams, "teams.json")
        if args.upload_s3 and s3_bucket:
            upload_to_s3(path, s3_bucket, "scraper/teams.json")

    elif args.target == "rankings":
        rankings = scrape_net_rankings()
        path = save_json(rankings, "rankings.json")
        if args.upload_s3 and s3_bucket:
            upload_to_s3(path, s3_bucket, "scraper/rankings.json")

        # Also merge into teams if available
        teams_file = OUTPUT_DIR / "teams.json"
        if teams_file.exists():
            with open(teams_file) as f:
                teams = json.load(f)
            teams = merge_rankings_into_teams(rankings, teams)
            teams_path = save_json(teams, "teams.json")
            if args.upload_s3 and s3_bucket:
                upload_to_s3(teams_path, s3_bucket, "scraper/teams.json")

    print("\nDone!")


if __name__ == "__main__":
    main()
