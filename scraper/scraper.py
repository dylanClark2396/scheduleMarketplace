"""
D1 Men's Basketball Data Scraper

Sources:
  - https://www.ncaa.com/stats/basketball-men  (team stats)
  - NET rankings page (when available)

Usage:
  python scraper.py --target teams
  python scraper.py --target rankings
  python scraper.py --target stats
  python scraper.py --target all

Output: scraper/output/{teams,rankings,stats}.json
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
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()

OUTPUT_DIR = Path(__file__).parent / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

BASE_URL = "https://www.ncaa.com"
STATS_BASE = f"{BASE_URL}/stats/basketball-men"

# Polite scraping delay (seconds between requests)
REQUEST_DELAY = 1.5

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; ScheduleMarketplaceScraper/1.0; "
        "+https://github.com/example/schedule-marketplace)"
    ),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)


# ========================
# UTILITIES
# ========================

def fetch_page(url: str, retries: int = 3) -> BeautifulSoup | None:
    """Fetch a page and return a BeautifulSoup object. Retries on failure."""
    for attempt in range(retries):
        try:
            print(f"  Fetching: {url}")
            resp = SESSION.get(url, timeout=15)
            resp.raise_for_status()
            time.sleep(REQUEST_DELAY)
            return BeautifulSoup(resp.text, "lxml")
        except requests.RequestException as e:
            print(f"  Attempt {attempt + 1} failed: {e}")
            if attempt < retries - 1:
                time.sleep(REQUEST_DELAY * (attempt + 2))
    return None


def save_json(data: list | dict, filename: str) -> Path:
    path = OUTPUT_DIR / filename
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"  Saved {len(data) if isinstance(data, list) else 1} records to {path}")
    return path


# ========================
# TEAMS SCRAPER
# ========================

def scrape_teams() -> list[dict]:
    """
    Scrape D1 team list from the stats site.
    Returns list of {id, name, shortName, conference, division}.
    """
    print("\n[Teams] Scraping D1 team list...")

    # Stats team list page — the dropdown on the stats site
    url = f"{STATS_BASE}/d1/p1"
    soup = fetch_page(url)
    if not soup:
        print("  Could not fetch teams page.")
        return []

    teams = []

    # The stats site uses a select/dropdown or team links on the page
    # Try to find team links in the nav or team list sections
    team_links = soup.select("a[href*='/schools/']")
    seen = set()

    for link in team_links:
        href = link.get("href", "")
        name = link.get_text(strip=True)
        if not name or href in seen:
            continue
        seen.add(href)

        # Extract slug from URL as a stable ID
        slug_match = re.search(r"/schools/([^/]+)", href)
        slug = slug_match.group(1) if slug_match else name.lower().replace(" ", "-")

        teams.append({
            "id": slug,
            "name": name,
            "shortName": _make_short_name(name),
            "conference": "",          # populated in scrape_stats
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


def _make_short_name(name: str) -> str:
    """Derive a short name: last word or abbreviation."""
    stopwords = {"University", "College", "State", "of", "the", "at"}
    parts = [p for p in name.split() if p not in stopwords]
    return parts[-1] if parts else name[:8]


# ========================
# STATS SCRAPER
# ========================

# D1 stats category pages (from https://www.ncaa.com/stats/basketball-men)
STAT_CATEGORIES = {
    "scoring_offense":   "/d1/current/p1/c110",
    "scoring_defense":   "/d1/current/p1/c111",
    "field_goal_pct":    "/d1/current/p1/c113",
    "rebound_margin":    "/d1/current/p1/c154",
    "assist_turnover":   "/d1/current/p1/c129",
    "won_lost":          "/d1/current/p1/c152",
}

def scrape_stats(teams_by_id: dict) -> dict:
    """
    Scrape team stats from stats pages.
    Updates teams_by_id in-place and returns it.
    """
    print("\n[Stats] Scraping team stats...")

    for stat_key, path in STAT_CATEGORIES.items():
        url = f"{STATS_BASE}{path}"
        soup = fetch_page(url)
        if not soup:
            continue

        print(f"  Processing {stat_key}...")
        _parse_stats_table(soup, stat_key, teams_by_id)

    return teams_by_id


def _parse_stats_table(soup: BeautifulSoup, stat_key: str, teams_by_id: dict):
    """Parse a single stats table and update the teams dict."""
    table = soup.find("table")
    if not table:
        return

    headers = [th.get_text(strip=True).lower() for th in table.select("thead th")]

    for row in table.select("tbody tr"):
        cols = [td.get_text(strip=True) for td in row.select("td")]
        if len(cols) < 2:
            continue

        # First meaningful column is usually team name
        name_col = next((i for i, h in enumerate(headers) if "team" in h or "school" in h), 1)
        team_name = cols[name_col] if name_col < len(cols) else cols[1]

        # Match to our team dict (fuzzy)
        team = _find_team(team_name, teams_by_id)
        if not team:
            continue

        # Apply stats based on category
        if stat_key == "scoring_offense":
            ppg_idx = next((i for i, h in enumerate(headers) if "avg" in h or "ppg" in h or "pts/g" in h), -1)
            if ppg_idx >= 0 and ppg_idx < len(cols):
                team["ppg"] = _safe_float(cols[ppg_idx])

        elif stat_key == "scoring_defense":
            ppg_idx = next((i for i, h in enumerate(headers) if "avg" in h), -1)
            if ppg_idx >= 0 and ppg_idx < len(cols):
                team["oppPpg"] = _safe_float(cols[ppg_idx])

        elif stat_key == "won_lost":
            w_idx = next((i for i, h in enumerate(headers) if h == "w"), -1)
            l_idx = next((i for i, h in enumerate(headers) if h == "l"), -1)
            conf_idx = next((i for i, h in enumerate(headers) if "conf" in h), -1)
            if w_idx >= 0: team["wins"] = _safe_int(cols[w_idx])
            if l_idx >= 0: team["losses"] = _safe_int(cols[l_idx])
            if conf_idx >= 0: team["conference"] = cols[conf_idx]

        team["updatedAt"] = int(datetime.now().timestamp() * 1000)


def _find_team(name: str, teams_by_id: dict) -> dict | None:
    """Find a team by name (case-insensitive, partial match)."""
    name_lower = name.lower()
    for team in teams_by_id.values():
        if team["name"].lower() == name_lower:
            return team
        if name_lower in team["name"].lower() or team["name"].lower() in name_lower:
            return team
    return None


def _safe_float(val: str) -> float | None:
    try:
        return float(val.replace(",", ""))
    except (ValueError, AttributeError):
        return None


def _safe_int(val: str) -> int:
    try:
        return int(val.replace(",", ""))
    except (ValueError, AttributeError):
        return 0


# ========================
# NET RANKINGS SCRAPER
# ========================

def scrape_net_rankings() -> list[dict]:
    """
    Scrape NET rankings.
    The official NET rankings are published at ncaa.com during the season.
    This function tries the official page; falls back to a known public data
    page if unavailable.

    Returns list of {rank, teamName, conference, record}.
    """
    print("\n[NET Rankings] Scraping NET rankings...")

    rankings = []

    # Attempt 1: official NET page (published in-season)
    url = f"{BASE_URL}/rankings/basketball-men/d1"
    soup = fetch_page(url)

    if soup:
        rows = soup.select("table tbody tr")
        for row in rows:
            cols = [td.get_text(strip=True) for td in row.select("td")]
            if len(cols) >= 2:
                rank_text = cols[0].strip().lstrip("#")
                if not rank_text.isdigit():
                    continue
                rankings.append({
                    "rank": int(rank_text),
                    "teamName": cols[1] if len(cols) > 1 else "",
                    "conference": cols[2] if len(cols) > 2 else "",
                    "record": cols[3] if len(cols) > 3 else "",
                })

    if not rankings:
        print("  Could not parse rankings. Rankings may not be published yet.")
        print("  During the season (Nov-Mar) try running again.")

    print(f"  Found {len(rankings)} NET rankings.")
    return rankings


def merge_rankings_into_teams(rankings: list[dict], teams_by_id: dict) -> dict:
    """Apply NET rankings to the teams dict."""
    rank_map = {r["teamName"].lower(): r["rank"] for r in rankings}

    for team in teams_by_id.values():
        net = rank_map.get(team["name"].lower())
        if not net:
            # Try partial match
            for rname, rank in rank_map.items():
                if rname in team["name"].lower() or team["name"].lower() in rname:
                    net = rank
                    break
        if net:
            team["netRanking"] = net

    return teams_by_id


# ========================
# S3 UPLOAD (optional)
# ========================

def upload_to_s3(local_path: Path, bucket: str, key: str):
    """Upload a file to S3. Requires boto3 and AWS credentials."""
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
        help="What to scrape",
    )
    parser.add_argument(
        "--upload-s3",
        action="store_true",
        help="Upload output JSON files to S3 (set S3_SCRAPER_BUCKET env var)",
    )
    args = parser.parse_args()

    s3_bucket = os.getenv("S3_SCRAPER_BUCKET")

    if args.target in ("teams", "all"):
        teams = scrape_teams()
        teams_by_id = {t["id"]: t for t in teams}

        if args.target in ("stats", "all") or args.target == "teams":
            scrape_stats(teams_by_id)

        if args.target in ("rankings", "all"):
            rankings = scrape_net_rankings()
            save_json(rankings, "rankings.json")
            merge_rankings_into_teams(rankings, teams_by_id)
            if args.upload_s3 and s3_bucket:
                upload_to_s3(OUTPUT_DIR / "rankings.json", s3_bucket, "scraper/rankings.json")

        path = save_json(list(teams_by_id.values()), "teams.json")
        if args.upload_s3 and s3_bucket:
            upload_to_s3(path, s3_bucket, "scraper/teams.json")

    elif args.target == "rankings":
        rankings = scrape_net_rankings()
        path = save_json(rankings, "rankings.json")
        if args.upload_s3 and s3_bucket:
            upload_to_s3(path, s3_bucket, "scraper/rankings.json")

    elif args.target == "stats":
        # Load existing teams to enrich
        teams_file = OUTPUT_DIR / "teams.json"
        if teams_file.exists():
            with open(teams_file) as f:
                teams = json.load(f)
            teams_by_id = {t["id"]: t for t in teams}
        else:
            print("Run --target teams first to create teams.json")
            return
        scrape_stats(teams_by_id)
        path = save_json(list(teams_by_id.values()), "teams.json")
        if args.upload_s3 and s3_bucket:
            upload_to_s3(path, s3_bucket, "scraper/teams.json")

    print("\nDone!")


if __name__ == "__main__":
    main()
