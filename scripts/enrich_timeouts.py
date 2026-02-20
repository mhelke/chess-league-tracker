#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Timeout Risk Enrichment Script
================================
Reads leagueData.json (produced by fetch_league_data.py) and produces a
separate timeoutData.json file containing per-player timeout statistics and
risk flags.

Does NOT modify leagueData.json.
Overwrites timeoutData.json on every run.

Run from the project root or the scripts/ directory:
    python scripts/enrich_timeouts.py
"""

import json
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Tuple
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError


# ── Paths (always relative to this file, regardless of cwd) ───────────────────

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
DATA_DIR    = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "public", "data"))
INPUT_FILE  = os.path.join(DATA_DIR, "leagueData.json")
OUTPUT_FILE = os.path.join(DATA_DIR, "timeoutData.json")


# ── Configuration ──────────────────────────────────────────────────────────────

# Players whose Chess.com timeout_percent (from open-match registration data)
# exceeds this value are flagged for deep archive analysis.
RISK_THRESHOLD_PERCENT: float = 25.0

# Rolling window used for "total league timeouts" count.
LEAGUE_TIMEOUT_WINDOW_DAYS: int = 90

# User agent for API requests 
# If your script is going to make a lot of requests, 
# it is recommended to add contact info here so chess.com can reach out if there's an issue.
USER_AGENT: str = "ChessLeagueTracker/1.0"

# Map from "1/<seconds>" denominator → friendly output key.
# Only these three time-control values are tracked; all others are ignored.
DAILY_TC_SECONDS: Dict[int, str] = {
    86400:  "1day",
    172800: "2day",
    259200: "3day",
}

# Maximum number of calendar months to look back in the game archive when
# searching for daily timeout games (0 = current month only).
ARCHIVE_MAX_MONTHS_BACK: int = 2


# ── HTTP helper ────────────────────────────────────────────────────────────────

def fetch_json(url: str) -> Optional[Dict]:
    """GET a URL and return parsed JSON, or None on any network / parse error."""
    try:
        req = Request(url, headers={"User-Agent": USER_AGENT})
        with urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        # 404 is normal for a month with no games so safe to suppress.
        if exc.code != 404:
            print(f"  [WARN] HTTP {exc.code} fetching {url}", file=sys.stderr)
    except URLError as exc:
        print(f"  [WARN] Network error fetching {url}: {exc}", file=sys.stderr)
    except json.JSONDecodeError as exc:
        print(f"  [WARN] JSON decode error for {url}: {exc}", file=sys.stderr)
    return None


# ── Chess.com /stats timeout helper ──────────────────────────────────────────

def fetch_player_stats(username_lower: str) -> Dict:
    """
    GET /pub/player/{username}/stats and return a dict with:
        timeoutPercent  – max of chess_daily and chess960_daily timeout_percent
        dailyRating     – chess_daily.last.rating
        rating960       – chess960_daily.last.rating
    All values may be None if the field is absent or the endpoint fails.
    """
    result: Dict = {"timeoutPercent": None, "dailyRating": None, "rating960": None}

    url = f"https://api.chess.com/pub/player/{username_lower}/stats"
    data = fetch_json(url)
    if not data:
        return result

    pcts = []
    for variant_key, rating_key in (("chess_daily", "dailyRating"), ("chess960_daily", "rating960")):
        variant = data.get(variant_key) or {}
        if not isinstance(variant, dict):
            continue
        record = variant.get("record") or {}
        pct = record.get("timeout_percent") if isinstance(record, dict) else None
        if pct is not None:
            pcts.append(float(pct))
        last = variant.get("last") or {}
        rating = last.get("rating") if isinstance(last, dict) else None
        if rating is not None:
            result[rating_key] = int(rating)

    # Note that Chess.com tracks timeout_percent for each variant separately, 
    # but this can be misleading. So take the max between the variants to be conservative in flagging potential risk.
    result["timeoutPercent"] = max(pcts) if pcts else None
    return result


# ── Date / time helpers ────────────────────────────────────────────────────────

def month_shift(dt: datetime, months_back: int) -> Tuple[int, int]:
    """
    Return (year, month) for the calendar month that is `months_back` months
    before `dt`.  Uses pure arithmetic so it is always exact.
    """
    total = dt.year * 12 + (dt.month - 1) - months_back
    return total // 12, total % 12 + 1


def ts_to_date(ts: int) -> str:
    """Convert a Unix timestamp to a UTC 'YYYY-MM-DD' string."""
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")


# ── League data iterators ──────────────────────────────────────────────────────

def iter_rounds(leagues: Dict):
    """Yield (league_name, sub_league_name, round_data) for every round."""
    for league_name, league_data in leagues.items():
        for sl_name, sl_data in league_data.get("subLeagues", {}).items():
            for round_data in sl_data.get("rounds", []):
                yield league_name, sl_name, round_data


# ── Step 1: collect players from open matches ──────────────────────────────────

def collect_open_players(leagues: Dict) -> Dict[str, List[Dict]]:
    """
    Scan every round with status == 'open' (registered, not yet started) and
    collect the unique players on our roster.

    Players are read from registrationData.ourRoster, which is the only
    populated source before a match begins.

    Returns:
        lowercase_username → list of open-match descriptors:
            {"league": str, "subLeague": str}
    """
    players: Dict[str, List[Dict]] = defaultdict(list)

    for league_name, sl_name, round_data in iter_rounds(leagues):
        if round_data.get("status") != "open":
            continue

        reg = round_data.get("registrationData") or {}
        our_roster = reg.get("ourRoster") or []
        for entry in our_roster:
            username = entry.get("username") or ""
            if username:
                players[username.lower()].append({
                    "league":    league_name,
                    "subLeague": sl_name,
                })

    return dict(players)


# ── Step 2: league-wide timeout count (rolling 90-day window) ─────────────────

def league_timeouts_90d(username: str, leagues: Dict, cutoff_ts: float) -> int:
    """
    Sum timeouts logged in playerStats across ALL finished/in_progress rounds
    whose startTime falls within the last LEAGUE_TIMEOUT_WINDOW_DAYS days.
    """
    total = 0
    for _, _, round_data in iter_rounds(leagues):
        if round_data.get("status") not in ("finished", "in_progress"):
            continue
        start_time = round_data.get("startTime") or 0
        if start_time < cutoff_ts:
            continue
        stats = round_data.get("playerStats", {}).get(username, {})
        total += stats.get("timeouts", 0)
    return total


# ── Step 3: per-sub-league timeout tally (all time) ───────────────────────────

def subleague_timeouts(username: str, leagues: Dict, sl_cutoff_ts: float) -> Dict[str, Dict[str, int]]:
    """
    For each (league, sub-league) pair that has at least one round with
    startTime >= sl_cutoff_ts (default: last 2 months), accumulate the
    player's timeout count across all finished/in_progress rounds.

    Only sub-leagues that have been active within the cutoff window are
    included. This avoids surfacing timeouts from long-finished seasons.

    Returns:
        {
            "<leagueName>": {
                "<subLeagueName>": <int>
            }
        }
    Only entries with count > 0 are included.
    """
    # Step 1: identify sub-leagues with at least one round in the window.
    recent_sl: set = set()
    for league_name, league_data in leagues.items():
        for sl_name, sl_data in league_data.get("subLeagues", {}).items():
            for round_data in sl_data.get("rounds", []):
                if (round_data.get("startTime") or 0) >= sl_cutoff_ts:
                    recent_sl.add((league_name, sl_name))
                    break  # one qualifying round is enough

    # Step 2: tally timeouts only within those sub-leagues.
    tally: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for league_name, sl_name, round_data in iter_rounds(leagues):
        if (league_name, sl_name) not in recent_sl:
            continue
        if round_data.get("status") not in ("finished", "in_progress"):
            continue
        stats = round_data.get("playerStats", {}).get(username, {})
        t = stats.get("timeouts", 0)
        if t > 0:
            tally[league_name][sl_name] += t

    return {
        lg: dict(sls)
        for lg, sls in tally.items()
        if sls
    }


# ── Step 4: daily game archive analysis ───────────────────────────────────────

def _empty_buckets() -> Dict[str, Dict]:
    """Return a fresh set of empty timeout buckets for all tracked TCs."""
    return {label: {"count": 0, "dates": []} for label in DAILY_TC_SECONDS.values()}


def analyse_month(username_lower: str, year: int, month: int) -> Dict[str, Dict]:
    """
    Fetch one calendar month of a player's game archive and extract daily
    timeout games whose time-control is in DAILY_TC_SECONDS.

    Returns raw buckets:
        {
            "1day":  {"count": int, "dates": ["YYYY-MM-DD", ...]},
            "2day":  ...,
            "3day":  ...,
        }
    """
    buckets = _empty_buckets()

    url = (
        f"https://api.chess.com/pub/player/{username_lower}"
        f"/games/{year:04d}/{month:02d}"
    )
    data = fetch_json(url)
    if not data:
        return buckets

    for game in data.get("games", []):
        # Only daily chess
        if game.get("time_class") != "daily":
            continue

        # Identify which side the player is on
        white_info = game.get("white", {})
        black_info = game.get("black", {})
        if white_info.get("username", "").lower() == username_lower:
            result = white_info.get("result", "")
        elif black_info.get("username", "").lower() == username_lower:
            result = black_info.get("result", "")
        else:
            # Player not present in this game (shouldn't happen in their own
            # archive, but guard defensively).
            continue

        if result != "timeout":
            continue

        # Parse time control: must be "1/<seconds>"
        tc_str = game.get("time_control", "")
        if not tc_str.startswith("1/"):
            continue
        try:
            seconds = int(tc_str.split("/", 1)[1])
        except (ValueError, IndexError):
            continue

        label = DAILY_TC_SECONDS.get(seconds)
        if label is None:
            continue  # Not a tracked time control (e.g. 7-day)

        end_ts = game.get("end_time")
        date_str = ts_to_date(end_ts) if end_ts else None

        buckets[label]["count"] += 1
        if date_str:
            buckets[label]["dates"].append(date_str)

    return buckets


def merge_buckets(a: Dict, b: Dict) -> Dict:
    """Add bucket counts and date lists from b into a (non-destructively)."""
    merged = {}
    for label in DAILY_TC_SECONDS.values():
        merged[label] = {
            "count": a[label]["count"] + b[label]["count"],
            "dates": a[label]["dates"] + b[label]["dates"],
        }
    return merged


def finalise_buckets(raw: Dict) -> Dict:
    """
    Convert raw buckets (with full date lists) to the output format:
        {
            "1day": {"count": int, "lastTimeoutDate": "YYYY-MM-DD" | null},
            ...
        }
    """
    return {
        label: {
            "count":           raw[label]["count"],
            "lastTimeoutDate": max(raw[label]["dates"]) if raw[label]["dates"] else None,
        }
        for label in DAILY_TC_SECONDS.values()
    }


def fetch_archive_timeouts(username_lower: str) -> Dict:
    """
    Walk up to ARCHIVE_MAX_MONTHS_BACK + 1 calendar months (current month
    first, going backwards) and accumulate daily timeout data.

    Stops as soon as at least one timeout game is found in a month so as to
    minimize unnecessary API calls.  All months up to and including the month
    where timeouts are first found are included in the totals.

    Returns a finalised bucket dict ready for the output JSON.
    """
    now = datetime.now(tz=timezone.utc)
    accumulated = _empty_buckets()

    for months_back in range(ARCHIVE_MAX_MONTHS_BACK + 1):
        year, month = month_shift(now, months_back)
        print(f"    Checking archive {year}/{month:02d} …")

        monthly = analyse_month(username_lower, year, month)
        accumulated = merge_buckets(accumulated, monthly)

        # Stop going further back once we find timeouts in this month
        if any(b["count"] > 0 for b in monthly.values()):
            break

        if months_back < ARCHIVE_MAX_MONTHS_BACK:
            time.sleep(0.3)  # polite pacing between requests

    return finalise_buckets(accumulated)


# ── Risk level computation ────────────────────────────────────────────────────
# If your definition of HIGH/MEDIUM/LOW risk differs, modify this function.
def compute_risk_level(
    timeout_percent: Optional[float],
    total_daily_timeouts: int,
    total_sl_timeouts: int,
    daily_buckets: Dict,
) -> Tuple[str, str]:
    """
    Compute (riskLevel, riskReason) for a player whose riskFlag is True.

    HIGH   - at least 2 of: timeout_percent > 50 | total_daily_timeouts >= 10
             | total_sl_timeouts >= 2
    LOW    - (pct < 30 AND sl == 0 AND total_daily < 10) OR
             (pct < 40 AND sl == 0 AND last_timeout > 2 months ago)
    MEDIUM - riskFlag==True but meets neither HIGH nor LOW criteria
    """
    pct = timeout_percent or 0.0

    # ── HIGH ─────────────────────────────────────────────────────────────────
    high_factors = [
        pct > 50,
        total_daily_timeouts >= 10,
        total_sl_timeouts >= 2,
    ]
    if sum(high_factors) >= 2:
        parts = []
        if pct > 50:
            parts.append(f"timeout ratio {pct:.0f}%")
        if total_daily_timeouts >= 10:
            parts.append(f"{total_daily_timeouts} recent daily timeouts")
        if total_sl_timeouts >= 2:
            parts.append(f"{total_sl_timeouts} sub-league timeouts")
        return "HIGH", "High risk: " + ", ".join(parts) + "."

    # ── LOW ──────────────────────────────────────────────────────────────────
    recent_dates = [
        v["lastTimeoutDate"]
        for v in daily_buckets.values()
        if v.get("lastTimeoutDate")
    ]
    last_timeout_date = max(recent_dates) if recent_dates else None
    two_months_ago = (
        datetime.now(tz=timezone.utc) - timedelta(days=60)
    ).strftime("%Y-%m-%d")

    low_a = pct < 30 and total_sl_timeouts == 0 and total_daily_timeouts < 10
    low_b = (
        pct < 40
        and total_sl_timeouts == 0
        and (last_timeout_date is None or last_timeout_date < two_months_ago)
    )
    if low_a or low_b:
        parts = [f"timeout ratio {pct:.0f}%", "no recent sub-league timeouts"]
        if low_a:
            parts.append(f"only {total_daily_timeouts} recent daily timeout(s)")
        elif last_timeout_date is None:
            parts.append("no recent daily timeouts found")
        else:
            parts.append(f"last timeout on {last_timeout_date}")
        return "LOW", "Low risk: " + ", ".join(parts) + "."

    # ── MEDIUM ────────────────────────────────────────────────────────────────
    parts = [f"timeout ratio {pct:.0f}%"]
    if total_sl_timeouts > 0:
        parts.append(f"{total_sl_timeouts} sub-league timeout(s)")
    if total_daily_timeouts > 0:
        parts.append(f"{total_daily_timeouts} recent daily timeout(s)")
    return "MEDIUM", "Medium risk: " + ", ".join(parts) + "."


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    # ── Load input ─────────────────────────────────────────────────────────────
    print(f"Loading {INPUT_FILE} …")
    if not os.path.exists(INPUT_FILE):
        print(f"ERROR: Input file not found: {INPUT_FILE}", file=sys.stderr)
        sys.exit(1)

    with open(INPUT_FILE, "r", encoding="utf-8") as fh:
        league_data = json.load(fh)

    leagues    = league_data.get("leagues", {})
    now_ts     = time.time()
    cutoff_90d = now_ts - LEAGUE_TIMEOUT_WINDOW_DAYS * 86400
    cutoff_60d = now_ts - 60 * 86400

    # ── Collect players from open matches ──────────────────────────────────────
    print("Scanning open matches for registered players …")
    open_players = collect_open_players(leagues)
    print(f"  {len(open_players)} unique player(s) found in open matches.")

    if not open_players:
        print("Nothing to process - writing empty output.")
        _write_output({})
        return

    # ── Per-player enrichment ─────────────────────────────────────────────────
    # Caches keyed by lowercase username so players in multiple open matches
    # are only fetched once.
    stats_cache:   Dict[str, Dict]            = {}
    archive_cache: Dict[str, Dict]            = {}
    output_players: Dict[str, Dict]           = {}

    empty_daily = {
        label: {"count": 0, "lastTimeoutDate": None}
        for label in DAILY_TC_SECONDS.values()
    }

    for username in sorted(open_players):
        print(f"\n[{username}]")

        # 3a. League-wide timeouts in the last 90 days (from leagueData) ───────
        total_90d = league_timeouts_90d(username, leagues, cutoff_90d)
        print(f"  League timeouts (90 d): {total_90d}")

        # 3b. Sub-league timeouts - active sub-leagues only (2-month window) ───
        sl_touts  = subleague_timeouts(username, leagues, cutoff_60d)
        total_sl  = sum(
            count
            for sl_dict in sl_touts.values()
            for count in sl_dict.values()
        )
        print(f"  Sub-league timeouts:    {sl_touts if sl_touts else 'none'}")

        # 3c. Fetch /stats from Chess.com  (timeout%, daily rating, 960 rating) ─
        if username in stats_cache:
            pstats = stats_cache[username]
        else:
            print(f"  Fetching /stats …")
            pstats = fetch_player_stats(username)
            stats_cache[username] = pstats
            time.sleep(0.3)
        timeout_pct   = pstats["timeoutPercent"]
        daily_rating  = pstats["dailyRating"]
        rating_960    = pstats["rating960"]
        print(f"  Timeout %: {timeout_pct}  Daily: {daily_rating}  960: {rating_960}")

        risk_flag = timeout_pct is not None and timeout_pct > RISK_THRESHOLD_PERCENT

        # 3d. Archive analysis (at-risk players only) ──────────────────────────
        if risk_flag:
            if username in archive_cache:
                print(f"  Using cached archive for {username}.")
                daily = archive_cache[username]
            else:
                print(f"  Fetching game archive …")
                daily = fetch_archive_timeouts(username)
                archive_cache[username] = daily
                time.sleep(0.5)
        else:
            daily = {
                label: {"count": 0, "lastTimeoutDate": None}
                for label in DAILY_TC_SECONDS.values()
            }

        # 3e. Risk level ────────────────────────────────────────────────────────
        total_daily = sum(v["count"] for v in daily.values())
        if risk_flag:
            risk_level, risk_reason = compute_risk_level(
                timeout_pct, total_daily, total_sl, daily
            )
        else:
            risk_level  = None
            risk_reason = None

        print(f"  Risk: flag={risk_flag}  level={risk_level}")

        # 3f. Assemble record ───────────────────────────────────────────────────
        output_players[username] = {
            "timeoutPercent":            timeout_pct,
            "dailyRating":               daily_rating,
            "rating960":                 rating_960,
            "totalLeagueTimeouts90Days": total_90d,
            "subLeagueTimeouts":         sl_touts,
            "dailyTimeouts":             daily,
            "riskFlag":                  risk_flag,
            "riskLevel":                 risk_level,
            "riskReason":                risk_reason,
        }

    # ── Write output ───────────────────────────────────────────────────────────
    _write_output(output_players)


def _write_output(players: Dict) -> None:
    """Serialise and overwrite timeoutData.json."""
    output = {
        "generatedAt":          datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "riskThresholdPercent": RISK_THRESHOLD_PERCENT,
        "players":              players,
    }

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(output, fh, indent=2, ensure_ascii=False)

    at_risk = sum(1 for p in players.values() if p.get("riskFlag"))
    high    = sum(1 for p in players.values() if p.get("riskLevel") == "HIGH")
    medium  = sum(1 for p in players.values() if p.get("riskLevel") == "MEDIUM")
    low     = sum(1 for p in players.values() if p.get("riskLevel") == "LOW")
    print(f"\n{'='*60}")
    print(f"✓  Written: {OUTPUT_FILE}")
    print(f"   Players processed : {len(players)}")
    print(f"   At-risk players   : {at_risk}  (HIGH={high}  MEDIUM={medium}  LOW={low})")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
