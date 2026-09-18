#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Chess League Data Fetcher
Fetches, parses, and aggregates chess league data from chess.com club matches.
Outputs a JSON file for consumption by the static React website.
"""

import argparse
from datetime import datetime, timezone
import json
import os
import re
import sys
import time
import unicodedata
from collections import defaultdict
from difflib import SequenceMatcher
from functools import lru_cache
from math import exp
from statistics import median
from typing import Dict, List, Any, Optional
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

# Ensure stdout uses UTF-8 encoding
if sys.stdout.encoding != 'utf-8':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')

# ── Paths (always relative to this file, regardless of cwd) ───────────────────

SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))


# ── Module-level configuration ─────────────────────────────────────────────────
# These globals are populated by load_config() in main() before any
# processing functions are called.  They must not be used at import time.

CLUB_ID: str           = ""
CLUB_MATCHES_URL: str  = ""
OUTPUT_FILE: str       = ""
REG_HISTORY_CACHE_FILE: str = ""
LEAGUE_CONFIG: list          = []
VARIANT_PATTERNS: list       = []
SUBLEAGUE_NORMALIZATION: list = []
SUBLEAGUE_RULES: list         = []
USER_AGENT: str              = "ChessLeagueTracker/1.0"
_TITLE_ROUND_CACHE: Dict[str, Optional[str]] = {}


def load_config(site_key: str) -> None:
    """Load per-site and shared config files from `config/` and set globals."""
    global CLUB_ID, CLUB_MATCHES_URL, OUTPUT_FILE, REG_HISTORY_CACHE_FILE, LEAGUE_CONFIG, VARIANT_PATTERNS, SUBLEAGUE_NORMALIZATION, SUBLEAGUE_RULES, USER_AGENT

    config_dir = os.path.join(PROJECT_ROOT, "config", site_key)

    # ── league_config.json (per-site, required)
    league_config_path = os.path.join(config_dir, "league_config.json")
    if not os.path.exists(league_config_path):
        print(f"ERROR: Config file not found: {league_config_path}", file=sys.stderr)
        sys.exit(1)
    with open(league_config_path, "r", encoding="utf-8") as f:
        league_cfg = json.load(f)

    CLUB_ID                 = league_cfg["clubId"]
    LEAGUE_CONFIG           = league_cfg.get("leagues", [])
    SUBLEAGUE_NORMALIZATION = league_cfg.get("subleague_normalization", [])
    # Optional site-specific rules supplement the rating bounds that can be
    # read from labels such as ``U1800``.  Each entry is a mapping with a
    # regular-expression ``pattern`` and any of max_rating, min_rating,
    # rules, time_control, and boards.  Keeping this data in configuration
    # avoids hard-coding a tournament's non-rating rules in the parser.
    SUBLEAGUE_RULES          = league_cfg.get("subleague_rules", [])
    _TITLE_ROUND_CACHE.clear()
    # Identity profiles are configuration-dependent, so clear their bounded
    # cache whenever a test or CLI invocation switches site configuration.
    for cache_name in (
        "_identity_profile", "_structural_score", "_trailing_letter_alias",
        "_legacy_alias_structural_score", "_group_alias_parts", "_group_alias_structural_score",
    ):
        cached = globals().get(cache_name)
        if cached is not None and hasattr(cached, "cache_clear"):
            cached.cache_clear()
    CLUB_MATCHES_URL        = f"https://api.chess.com/pub/club/{CLUB_ID}/matches"

    # ── variant_patterns.json (shared, optional)
    # Prefer config/shared to keep all inputs together; fall back to
    # scripts/shared for backward compatibility.
    variant_path = os.path.join(PROJECT_ROOT, "config", "shared", "variant_patterns.json")
    if not os.path.exists(variant_path):
        variant_path = os.path.join(SCRIPT_DIR, "shared", "variant_patterns.json")

    if os.path.exists(variant_path):
        with open(variant_path, "r", encoding="utf-8") as f:
            VARIANT_PATTERNS = json.load(f)
    else:
        VARIANT_PATTERNS = []

    # ── Output file
    OUTPUT_FILE = os.path.join(PROJECT_ROOT, "public", "data", site_key, "leagueData.json")
    REG_HISTORY_CACHE_FILE = os.path.join(PROJECT_ROOT, "public", "data", site_key, "registration_history_cache.json")

    # ── User agent (env override > script_params.json > default)
    params_path = os.path.join(config_dir, "script_params.json")
    if os.path.exists(params_path):
        with open(params_path, "r", encoding="utf-8") as f:
            params = json.load(f)
        USER_AGENT = params.get("userAgent", USER_AGENT)
    USER_AGENT = os.environ.get("USER_AGENT", USER_AGENT)

def fetch_json(url: str) -> Optional[Dict]:
    """Fetch JSON data from a URL with error handling."""
    try:
        req = Request(url, headers={'User-Agent': USER_AGENT})
        with urlopen(req, timeout=30) as response:
            return json.loads(response.read().decode('utf-8'))
    except (URLError, HTTPError) as e:
        print(f"Error fetching {url}: {e}", file=sys.stderr)
        return None
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON from {url}: {e}", file=sys.stderr)
        return None


def _normalise_spaces(value: str) -> str:
    """Collapse whitespace and trim punctuation used only as separators."""
    value = unicodedata.normalize("NFKC", value or "")
    value = re.sub(r"\s+", " ", value).strip()
    return value.strip(" -:|/,\\")


_SEASON_SPAN_RE = re.compile(
    r"(?<!\d)(?P<start>20\d{2})\s*(?:[/\\\-\u2013\u2014])\s*"
    r"(?P<end>20\d{2}|\d{2})(?!\d)",
    re.IGNORECASE,
)


def _normalise_season_spans(value: str) -> str:
    """Make equivalent season spellings use one semantic token."""
    def replace(match: re.Match) -> str:
        start = match.group("start")
        end = match.group("end")
        if len(end) == 2:
            end = f"{start[:2]}{end}"
        return f" season{start}{end} "

    return _SEASON_SPAN_RE.sub(replace, value or "")


def _normalise_playoff_label(value: str) -> str:
    """Treat harmless playoff spelling and hyphenation changes alike."""
    return re.sub(
        r"\bplay\s*[-\u2013\u2014]?\s*offs?\b",
        "playoffs",
        value or "",
        flags=re.IGNORECASE,
    )


def _collapse_adjacent_duplicate_tokens(value: str) -> str:
    """Remove accidental adjacent duplicate words from a competition label."""
    previous = None
    while previous != value:
        previous = value
        value = re.sub(
            r"\b([A-Za-z][A-Za-z0-9+]*)\s+\1\b",
            r"\1",
            value,
            flags=re.IGNORECASE,
        )
    return value


def canonical_subleague_key(name: str) -> str:
    """Return a conservative, punctuation-insensitive grouping key.

    Meaningful tokens, including years and stage/group identifiers, are kept.
    This intentionally does not use fuzzy matching: similar-looking seasons or
    tournament stages must remain separate unless their structural tokens agree.
    """
    value = unicodedata.normalize("NFKC", name or "")
    for pattern, canonical in VARIANT_PATTERNS:
        value = re.sub(pattern, canonical, value, flags=re.IGNORECASE)
    for norm_pattern, norm_replacement in SUBLEAGUE_NORMALIZATION:
        value = re.sub(norm_pattern, norm_replacement, value, flags=re.IGNORECASE)
    value = _normalise_season_spans(value)
    value = _normalise_playoff_label(value)
    value = _collapse_adjacent_duplicate_tokens(value)
    value = value.casefold()
    value = re.sub(r"[^\w+]+", " ", value, flags=re.UNICODE)
    return " ".join(value.split())


def _remove_team_names(title: str, team_names: Optional[List[str]]) -> str:
    """Remove exact team-name phrases from a title, longest names first."""
    working = title or ""
    names = sorted(
        {name.strip() for name in (team_names or []) if isinstance(name, str) and name.strip()},
        key=len,
        reverse=True,
    )
    for name in names:
        tokens = [token for token in re.split(r"\s+", name) if token]
        if not tokens:
            continue
        # Allow the title to vary only in whitespace while preserving the
        # punctuation and accents that distinguish a real team name.
        pattern = r"\s+".join(re.escape(token) for token in tokens)
        working = re.sub(pattern, " ", working, flags=re.IGNORECASE)
    return working


def _clean_competition_text(title: str, team_names: Optional[List[str]]) -> str:
    """Remove team names and match separators before parsing structure."""
    working = _remove_team_names(title, team_names)
    working = re.sub(r"\b(?:vs?\.?|v\.?s?\.?|versus)\b", " ", working, flags=re.IGNORECASE)
    # Team names normally leave these separators behind. Keep commas inside
    # season labels for the later normalisation step, but remove empty syntax.
    working = re.sub(r"\s*\|\s*", " ", working)
    working = re.sub(r"\s*:\s*", " : ", working)
    return _normalise_spaces(working)


def parse_match_title(title: str, team_names: Optional[List[str]] = None) -> Optional[Dict[str, str]]:
    """
    Parse a match title to extract league, sub-league, and round.

    Sub-leagues are discovered automatically so you never need to enumerate
    them. Joining a new sub-league (e.g. "WL2026 U1500 R3") will automatically be picked up.

    Team-name boundary detection (in priority order):
      1. Colon:   "WL2026 SubLeague R1: TeamA vs TeamB"
                   Everything before ':' is structural; team names ignored.
      2. Round token: "WL2026 SubLeague R1 TeamA vs TeamB"
                   Text LEFT  of the round token → sub-league qualifier.
                   Text RIGHT of the round token (before ' vs ') → teamName,
                   discarded automatically.
      3. ' vs ' only (no colon, no round): "WL2026 SubLeague TeamA vs TeamB"
                   Everything before ' vs ' is taken; team1 name unavoidably
                   bleeds into the sub-league string.  Add a colon or round
                   number to the match title to avoid this.
                   These cases are resolved from the match endpoint's team names.

    Round tokens recognized (case-insensitive, anywhere in title):
        R1, R2 …       ("R" + digits)
        Round 1 …      ("Round" + digits)
        Rd 1 …         ("Rd" + digits)
        G1, Game 1 …   ("G" / "Game" + digits)

    Examples (all produce identical output for the same sub-league):
      "WL2026 Open R1"                      -> league=WL, subLeague=2026 Open,         round=R1
      "WL2026 Open R1: TeamA vs TeamB"      -> league=WL, subLeague=2026 Open,         round=R1
      "WL2026 Open R1 TeamA vs TeamB"       -> league=WL, subLeague=2026 Open,         round=R1
      "WL2026 Open TeamA vs TeamB"          -> league=WL, subLeague=2026 Open TeamA,   round=None  (ambiguous - add colon or round)
      "WL2026 R1"                           -> league=WL, subLeague=2026,              round=R1
      "Chess960 WL2026 R1"                  -> league=WL, subLeague=Chess960 2026,     round=R1
      "WL2026 Chess960 Round 3"             -> league=WL, subLeague=Chess960 2026,     round=R3
      "WL2026 U1500 Rd 4: TeamA vs TeamB"   -> league=WL, subLeague=2026 U1500,        round=R4
    """
    original_title = title or ""
    working = _clean_competition_text(original_title, team_names)

    # ── 1. Find which league config matches ────────────────────────────────────
    league_name: Optional[str] = None
    year: Optional[str] = None
    league_m = None

    for cfg in LEAGUE_CONFIG:
        m = re.search(cfg["root_pattern"], working, re.IGNORECASE)
        if m:
            league_name = cfg["name"]
            year = m.groupdict().get("year")  # None if no year capture group
            league_m = m
            break

    # Team names can contain or surround the league marker. If stripping team
    # names removed the only usable occurrence, fall back to the raw title.
    if not league_name:
        working = _normalise_spaces(original_title)
        for cfg in LEAGUE_CONFIG:
            m = re.search(cfg["root_pattern"], working, re.IGNORECASE)
            if m:
                league_name = cfg["name"]
                year = m.groupdict().get("year")
                league_m = m
                break

    if not league_name:
        return None

    # Remove the matched league identifier from the working string.
    working = (working[:league_m.start()] + working[league_m.end():]).strip()

    # ── 2. Isolate the structural portion (strip team names) ───────────────────
    # Priority: colon > round token (acts as boundary in step 3) > bare " vs ".
    # Track if we fell back to a bare " vs " split. That is the only case where
    # team1's name may bleed into the sub-league text (ambiguous).
    split_on_vs_only = False
    has_structural_colon = ":" in working
    if has_structural_colon:
        working = working.split(":", 1)[0].strip()

    # ── 3. Extract round token ─────────────────────────────────────────────────
    # Patterns tried in priority order; first match wins.
    # Canonical form: R<n> for round-style, G<n> for game-style.
    ROUND_PATTERNS = [
        (r"\b(?:Round|Rd)\.?\s*(\d+)\b", "R"),   # Round 1 / Rd 1 / Rd.1
        (r"\bR(\d+)\b",                   "R"),   # R1
        # Bare G1/G2 identifiers are sub-league group markers in the live
        # data.  Only an explicit "Game 1" form is a game-style round.
        (r"\bGame\.?\s*(\d+)\b",         "G"),   # Game 1
    ]
    round_str: Optional[str] = None
    round_variant: Optional[str] = None
    for rp, prefix in ROUND_PATTERNS:
        round_m = re.search(rp, working, re.IGNORECASE)
        if round_m:
            round_str = f"{prefix}{round_m.group(1)}"
            # Some competitions schedule several matches for one team
            # pairing and round, distinguished by a label after the round
            # token (for example R1 Classic, R1 Thematic, and R1 960).  This
            # is a match variant, not part of the sub-league name.
            variant_text = working[round_m.end():].strip()
            if (has_structural_colon or team_names) and variant_text:
                for variant_pattern, variant_canonical in VARIANT_PATTERNS:
                    variant_text = re.sub(
                        variant_pattern,
                        variant_canonical,
                        variant_text,
                        flags=re.IGNORECASE,
                    )
                round_variant = _normalise_spaces(variant_text) or None
            # Keep only the text LEFT of the round token as the sub-league
            # qualifier; text to the right was team1's name (no colon present).
            working = working[:round_m.start()].strip()
            split_on_vs_only = False  # round token fully disambiguates
            break

    if team_names is None and ":" not in original_title:
        vs_match = re.search(r"\b(?:vs|v\.?s?\.?|versus)\b", original_title, re.IGNORECASE)
        raw_round_match = re.search(
            r"\b(?:Round|Rd)\.?\s*\d+\b|\bR\d+\b|\b(?:Game|G)\.?\s*\d+\b",
            original_title,
            re.IGNORECASE,
        )
        if vs_match and (not raw_round_match or raw_round_match.start() > vs_match.start()):
            split_on_vs_only = True
            round_str = None

    # ── 4. Extract variant keywords (in any order) ─────────────────────────────
    variants: list = []
    for pattern, canonical in VARIANT_PATTERNS:
        vm = re.search(pattern, working, re.IGNORECASE)
        if vm:
            if canonical not in variants:
                variants.append(canonical)
            working = (working[:vm.start()] + working[vm.end():]).strip()

    # ── 5. Assemble canonical sub-league name ──────────────────────────────────
    # Format: "<variant(s)> <year> <any-remaining-qualifier>"
    remaining = _normalise_spaces(working)
    parts = variants + ([year] if year else []) + ([remaining] if remaining else [])
    sub_league = " ".join(parts) if parts else "main"

    # ── 6. Apply site-specific sub-league normalization ────────────────────────
    # Patterns from league_config.json "subleague_normalization" field.
    # Each entry is [regex_pattern, replacement] applied in order.
    for norm_pattern, norm_replacement in SUBLEAGUE_NORMALIZATION:
        sub_league = re.sub(norm_pattern, norm_replacement, sub_league, flags=re.IGNORECASE).strip()

    # ── Ambiguous case ─────────────────────────────────────────────────────────
    # No colon and no round token → team1's name has bled into sub_league.
    # Return a sentinel when no match context was supplied and team text may
    # still be mixed into the structural label.
    if split_on_vs_only and not team_names:
        return {
            "league":       league_name,
            "subLeague":    "__unresolved__",
            "round":        None,
            "rawRemainder": sub_league,  # contaminated text, used for fuzzy match
        }

    return {
        "league":    league_name,
        "subLeague": sub_league,
        "canonicalSubLeague": canonical_subleague_key(sub_league),
        "round":     round_str,
        "matchVariant": round_variant,
        "confidence": "high" if team_names else "medium",
    }


def get_player_result_from_game(username: str, game: Dict) -> Optional[Dict[str, Any]]:
    """
    Determine the result for a specific player in a game.
    Returns dict with result type and colors played, or None.
    """
    username = username.lower()
    
    white = game.get("white", {})
    black = game.get("black", {})
    
    white_username = white.get("username", "").lower()
    black_username = black.get("username", "").lower()
    
    white_result = white.get("result", "")
    black_result = black.get("result", "")
    
    result_type = None
    color = None
    
    # Check if player was white
    if username == white_username:
        color = "white"
        if white_result == "win":
            result_type = "win"
        elif white_result in ["checkmated", "resigned", "timeout", "abandoned"]:
            result_type = "loss"
        elif white_result in ["stalemate", "repetition", "insufficient", "50move", "agreed", "timevsinsufficient"]:
            result_type = "draw"
    
    # Check if player was black
    elif username == black_username:
        color = "black"
        if black_result == "win":
            result_type = "win"
        elif black_result in ["checkmated", "resigned", "timeout", "abandoned"]:
            result_type = "loss"
        elif black_result in ["stalemate", "repetition", "insufficient", "50move", "agreed", "timevsinsufficient"]:
            result_type = "draw"
    
    if result_type and color:
        return {"result": result_type, "color": color}
    
    return None


def get_match_web_url(match_url: str) -> str:
    """Convert API URL to web URL."""
    # API URL: https://api.chess.com/pub/match/<ID>
    # Web URL: https://www.chess.com/club/matches/<ID>
    match_id = match_url.split("/")[-1]
    return f"https://www.chess.com/club/matches/{match_id}"


def process_result(result_str: str) -> str:
    """
    Convert a chess.com result string to win/draw/loss.
    """
    result_str = str(result_str).lower()
    if result_str == "win":
        return "win"
    elif result_str in ["checkmated", "resigned", "timeout", "abandoned"]:
        return "loss"
    elif result_str in ["stalemate", "repetition", "insufficient", "50move", "agreed", "timevsinsufficient"]:
        return "draw"
    return "unknown"


def _club_id_from_api_url(value: Any) -> Optional[str]:
    """Extract a stable Chess.com club identifier from an API URL."""
    if not isinstance(value, str) or "/club/" not in value:
        return None
    club_id = value.rstrip("/").split("/club/")[-1].strip()
    return club_id or None


def _api_metadata_from_match_payload(match_data: Dict) -> Dict[str, Any]:
    """Keep the API fields that can prove a sub-league assignment is wrong.

    A missing field means the API did not make a claim and must *not* reject a
    textual grouping.  Present values, including zero, are retained verbatim
    so the decision audit can distinguish missing evidence from a conflict.
    """
    settings = match_data.get("settings")
    settings = settings if isinstance(settings, dict) else {}
    return {
        "maxRating": settings.get("max_rating"),
        "minRating": settings.get("min_rating"),
        "rules": settings.get("rules"),
        "timeControl": settings.get("time_control"),
        "boards": match_data.get("boards"),
    }


def _teams_from_match_payload(teams: Dict) -> List[Dict[str, str]]:
    """Return the authoritative participating teams needed by merge guards."""
    result = []
    if not isinstance(teams, dict):
        return result
    for team_data in teams.values():
        if not isinstance(team_data, dict):
            continue
        name = team_data.get("name")
        club_id = _club_id_from_api_url(team_data.get("@id"))
        if not name and not club_id:
            continue
        result.append({
            "name": str(name or club_id),
            "clubId": club_id or "",
        })
    return result


def process_match(match_url: str, parsed_title: Dict, status: str) -> Optional[Dict]:
    """
    Fetch and process a single match.
    Returns match data with player statistics (only from our club).
    Each player plays 2 games: one as white, one as black.
    """
    print(f"Processing match: {match_url}")
    
    match_data = fetch_json(match_url)
    if not match_data:
        return None
    
    # Use the status from Chess.com API (passed as parameter)
    boards_count = match_data.get("boards", 0)
    
    # Identify which team is our club by matching @id field
    our_team_key = None
    our_team_data = None
    opponent_team_data = None
    teams = match_data.get("teams", {})
    team_names = [
        team_data.get("name", "")
        for team_data in teams.values()
        if isinstance(team_data, dict) and team_data.get("name")
    ]
    contextual_title = parse_match_title(match_data.get("name", ""), team_names)
    if contextual_title and contextual_title.get("subLeague") != "__unresolved__":
        parsed_title = contextual_title
    
    for team_key, team_data in teams.items():
        if isinstance(team_data, dict):
            # Match by @id field containing CLUB_ID
            team_id = team_data.get("@id", "")
            if CLUB_ID in team_id:
                our_team_key = team_key
                our_team_data = team_data
                print(f"  Found our team: {team_data.get('name')} (key: {team_key})")
            else:
                opponent_team_data = team_data
    
    if not our_team_key or not our_team_data:
        print(f"  Warning: Could not identify our club's team in this match")
        return None

    # Extract player statistics from our team
    # Each player plays 2 games: played_as_white and played_as_black
    player_stats = defaultdict(lambda: {"games": 0, "wins": 0, "draws": 0, "losses": 0, "timeouts": 0})
    
    players = our_team_data.get("players", [])
    print(f"  Processing {len(players)} players...")
    
    for player in players:
        if not isinstance(player, dict):
            continue
            
        username = player.get("username", "").lower()
        if not username:
            continue
        
        # For in_progress and finished matches, count timeouts and process results
        if status in ["in_progress", "finished"]:
            # Process white game
            white_result = player.get("played_as_white")
            if white_result:
                player_stats[username]["games"] += 1
                if white_result == "timeout":
                    player_stats[username]["timeouts"] += 1
                    player_stats[username]["losses"] += 1
                else:
                    result_type = process_result(white_result)
                    if result_type == "win":
                        player_stats[username]["wins"] += 1
                    elif result_type == "draw":
                        player_stats[username]["draws"] += 1
                    elif result_type == "loss":
                        player_stats[username]["losses"] += 1
            
            # Process black game
            black_result = player.get("played_as_black")
            if black_result:
                player_stats[username]["games"] += 1
                if black_result == "timeout":
                    player_stats[username]["timeouts"] += 1
                    player_stats[username]["losses"] += 1
                else:
                    result_type = process_result(black_result)
                    if result_type == "win":
                        player_stats[username]["wins"] += 1
                    elif result_type == "draw":
                        player_stats[username]["draws"] += 1
                    elif result_type == "loss":
                        player_stats[username]["losses"] += 1
    
    # Determine match result
    our_score = our_team_data.get("score", 0)
    opponent_score = opponent_team_data.get("score", 0) if opponent_team_data else 0
    our_result = our_team_data.get("result", "unknown")
    
    # Get minimum/maximum required players from match settings (for all matches)
    settings = match_data.get("settings", {})
    min_team_players = settings.get("min_team_players") if isinstance(settings, dict) else None
    max_team_players = settings.get("max_team_players") if isinstance(settings, dict) else None
    
    # Get player lists for both teams (for all matches)
    opponent_players = opponent_team_data.get("players", []) if opponent_team_data else []
    our_player_count = len(players)
    opponent_player_count = len(opponent_players)
    
    # Detect forfeit scenarios for finished matches with 0-0 score
    # Chess.com counts matches that never started as a draw. This is how they show up on a team's "official" list, 
    # but leagues track these as forfeits in their standings.
    if status == "finished" and our_score == 0 and opponent_score == 0 and min_team_players is not None:
        our_below_min = our_player_count < min_team_players
        opp_below_min = opponent_player_count < min_team_players
        
        if our_below_min and opp_below_min:
            # Double forfeit - we lose
            our_result = "double forfeit"
            print(f"  Detected double forfeit: our={our_player_count}, opp={opponent_player_count}, min={min_team_players}")
        elif our_below_min:
            # We forfeited
            our_result = "forfeit"
            print(f"  Detected our forfeit: our={our_player_count}, min={min_team_players}")
        elif opp_below_min:
            # Opponent forfeited - we win
            our_result = "win by forfeit"
            print(f"  Detected opponent forfeit: opp={opponent_player_count}, min={min_team_players}")
    
    match_result = {
        "ourScore": our_score,
        "opponentScore": opponent_score,
        "result": our_result  # "win", "lose", "draw", "forfeit", "double forfeit", "win by forfeit"
    }
    
    # Extract board-level rating data for registration matches only
    boards_data = []
    our_boards = {}
    opponent_boards = {}
    
    if status == "open":  # Only for registration status
        print(f"  Extracting board ratings for registration match...")
        
        # Check if players have board assignments (for matches in registration,
        # boards may not be assigned yet)
        has_board_assignments = any(p.get("board") for p in players if isinstance(p, dict))
        
        if has_board_assignments:
            # Create dictionaries mapping board number to player data
            for player in players:
                if isinstance(player, dict):
                    board = player.get("board")
                    if board:
                        our_boards[board] = {
                            "username": player.get("username"),
                            "rating": player.get("rating"),
                            "timeoutPercent": player.get("timeout_percent"),
                        }
            
            for player in opponent_players:
                if isinstance(player, dict):
                    board = player.get("board")
                    if board:
                        opponent_boards[board] = {
                            "username": player.get("username"),
                            "rating": player.get("rating"),
                            "timeoutPercent": player.get("timeout_percent"),
                        }
            
            # Calculate rating differential for each board
            for board_num in range(1, boards_count + 1):
                our_player = our_boards.get(board_num)
                opp_player = opponent_boards.get(board_num)
                
                if our_player and opp_player:
                    our_rating = our_player.get("rating")
                    opp_rating = opp_player.get("rating")
                    
                    board_data = {
                        "boardNumber": board_num,
                        "ourPlayer": our_player.get("username"),
                        "ourRating": our_rating,
                        "ourTimeoutPercent": our_player.get("timeoutPercent"),
                        "oppPlayer": opp_player.get("username"),
                        "oppRating": opp_rating,
                        "oppTimeoutPercent": opp_player.get("timeoutPercent"),
                        "ratingDiff": None
                    }
                    
                    # Calculate rating differential (positive = our player is higher rated)
                    if our_rating and opp_rating:
                        board_data["ratingDiff"] = our_rating - opp_rating
                    
                    boards_data.append(board_data)
        else:
            # No board assignments yet, so collect all registered players
            # Sort by rating descending.
            our_roster = sorted(
                [{"username": p.get("username"), "rating": p.get("rating"),
                  "timeoutPercent": p.get("timeout_percent")}
                 for p in players if isinstance(p, dict) and p.get("username")],
                key=lambda x: x.get("rating") or 0,
                reverse=True
            )
            
            opp_roster = sorted(
                [{"username": p.get("username"), "rating": p.get("rating"),
                  "timeoutPercent": p.get("timeout_percent")}
                 for p in opponent_players if isinstance(p, dict) and p.get("username")],
                key=lambda x: x.get("rating") or 0,
                reverse=True
            )
            
            # Store roster data
            boards_data = {
                "type": "roster",
                "ourRoster": our_roster,
                "oppRoster": opp_roster
            }
    
    # Use parsed round if available, otherwise let it be auto-assigned later
    round_str = parsed_title["round"] if parsed_title["round"] else None
    
    # Build cleaned player stats (timeouts only included when > 0)
    cleaned_player_stats = {}
    for username, stats in player_stats.items():
        cleaned_stats = {
            "games":  stats["games"],
            "wins":   stats["wins"],
            "draws":  stats["draws"],
            "losses": stats["losses"],
        }
        if stats.get("timeouts", 0) > 0:
            cleaned_stats["timeouts"] = stats["timeouts"]
        cleaned_player_stats[username] = cleaned_stats
    
    # Extract opponent club ID from the opponent team's @id URL
    # e.g. "https://api.chess.com/pub/club/team-usa" → "team-usa"
    opponent_club_id = None
    if opponent_team_data:
        opponent_club_id = _club_id_from_api_url(opponent_team_data.get("@id", ""))

    result = {
        "round": round_str,
        "status": status,
        "matchId": match_data.get("@id", match_url),
        "matchUrl": match_url,
        "matchWebUrl": get_match_web_url(match_url),
        "name": match_data.get("name", ""),
        "startTime": match_data.get("start_time"),
        "endTime": match_data.get("end_time"),
        "boards": boards_count,
        # Persist the metadata and teams used by guarded future repairs.  The
        # public data remains self-explanatory and historical rows without
        # these fields are treated as unknown, never as contradictory.
        "apiMetadata": _api_metadata_from_match_payload(match_data),
        "teams": _teams_from_match_payload(teams),
        "matchResult": match_result,
        "playerStats": cleaned_player_stats
    }
    if parsed_title.get("matchVariant"):
        result["matchVariant"] = parsed_title["matchVariant"]

    # Internal metadata consumed by the caller for grouping. It is removed
    # before the round is written to leagueData.json.
    result["_parsedTitle"] = parsed_title

    if opponent_club_id:
        result["opponentClubId"] = opponent_club_id
    
    # Add minTeamPlayers for all matches
    # This can be used to detect possible forfeits in open matches 
    # and track projected winners in in-progress matches based on current player counts.
    if min_team_players is not None:
        result["minTeamPlayers"] = min_team_players
    if max_team_players is not None:
        result["maxTeamPlayers"] = max_team_players

    # Add registration data if available for open matches
    if boards_data:
        if isinstance(boards_data, dict) and boards_data.get("type") == "roster":
            # Roster format
            result["registrationData"] = boards_data
            result["registeredPlayers"] = {
                "our": len(boards_data.get("ourRoster", [])),
                "opponent": len(boards_data.get("oppRoster", []))
            }
        elif isinstance(boards_data, list) and len(boards_data) > 0:
            # Board-specific format
            result["boardsData"] = boards_data
            result["registeredPlayers"] = {
                "our": len(our_boards),
                "opponent": len(opponent_boards)
            }
    
    return result


def is_our_club_from_url(team_url: str) -> bool:
    """Check if a team URL belongs to our club."""
    if not team_url:
        return False
    # URL format: https://api.chess.com/pub/club/<CLUB_ID>
    return CLUB_ID in team_url.lower()


def aggregate_player_stats(rounds: List[Dict]) -> List[Dict]:
    """
    Aggregate player statistics across all rounds in a sub-league.
    Returns a sorted leaderboard.
    """
    player_totals = defaultdict(lambda: {"games": 0, "wins": 0, "draws": 0, "losses": 0, "points": 0.0})
    
    for round_data in rounds:
        for username, stats in round_data.get("playerStats", {}).items():
            player_totals[username]["games"] += stats["games"]
            player_totals[username]["wins"] += stats["wins"]
            player_totals[username]["draws"] += stats["draws"]
            player_totals[username]["losses"] += stats["losses"]
            player_totals[username]["points"] += stats["wins"] + (stats["draws"] * 0.5)
    
    # Convert to list and sort by points descending, then by games ascending
    leaderboard = []
    for username, stats in player_totals.items():
        leaderboard.append({
            "username": username,
            "games": stats["games"],
            "wins": stats["wins"],
            "draws": stats["draws"],
            "losses": stats["losses"],
            "points": stats["points"]
        })
    
    leaderboard.sort(key=lambda x: (-x["points"], x["games"]))
    
    return leaderboard


def calculate_subleague_record(rounds: List[Dict]) -> Dict:
    """
    Calculate the Win-Loss-Draw record for a sub-league based on match results.
    Returns dict with wins, losses, draws counts.

    Forfeit results are counted as wins or losses (not draws):
      "win by forfeit"  → win
      "forfeit"         → loss (our team forfeited)
      "double forfeit"  → loss
    """
    record = {"wins": 0, "losses": 0, "draws": 0}
    
    for round_data in rounds:
        match_result = round_data.get("matchResult", {})
        result = match_result.get("result", "unknown")
        
        if result in ["win", "win by forfeit"]:
            record["wins"] += 1
        elif result in ["lose", "forfeit", "double forfeit"]:
            record["losses"] += 1
        elif result in ["draw", "agreed"]:
            record["draws"] += 1
    
    return record


def create_global_leaderboard(leagues_data: Dict) -> List[Dict]:
    """
    Create a global leaderboard across all leagues and sub-leagues.
    """
    global_stats = defaultdict(lambda: {"games": 0, "wins": 0, "draws": 0, "losses": 0, "points": 0.0})
    
    for league_name, league_data in leagues_data.items():
        for sub_league_name, sub_league_data in league_data.get("subLeagues", {}).items():
            for player in sub_league_data.get("leaderboard", []):
                username = player["username"]
                global_stats[username]["games"] += player["games"]
                global_stats[username]["wins"] += player["wins"]
                global_stats[username]["draws"] += player["draws"]
                global_stats[username]["losses"] += player["losses"]
                global_stats[username]["points"] += player["points"]
    
    # Convert to list and sort
    global_leaderboard = []
    for username, stats in global_stats.items():
        global_leaderboard.append({
            "username": username,
            "games": stats["games"],
            "wins": stats["wins"],
            "draws": stats["draws"],
            "losses": stats["losses"],
            "points": stats["points"]
        })
    
    global_leaderboard.sort(key=lambda x: (-x["points"], x["games"]))
    
    return global_leaderboard


# ── Registration history helpers ──────────────────────────────────────────────

def load_registration_history_cache() -> Dict:
    """Load the registration history cache, returning an empty structure if missing."""
    if not os.path.exists(REG_HISTORY_CACHE_FILE):
        return {"matches": {}}
    try:
        with open(REG_HISTORY_CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"Warning: Could not load registration history cache: {e}")
        return {"matches": {}}


def save_registration_history_cache(cache: Dict) -> None:
    """Persist the registration history cache to disk."""
    try:
        os.makedirs(os.path.dirname(REG_HISTORY_CACHE_FILE), exist_ok=True)
        with open(REG_HISTORY_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Warning: Could not save registration history cache: {e}", file=sys.stderr)


def _diff_roster(old_ratings: Dict[str, Optional[int]], new_ratings: Dict[str, Optional[int]]):
    """Return (added, removed) sorted lists of {"username", "rating"} dicts.

    Ratings are taken from the roster the username belongs to at the time of
    the event (new roster for adds, old roster for removes) so a player's
    rating remains visible in the history even after they leave the roster.
    """
    added = sorted(set(new_ratings) - set(old_ratings))
    removed = sorted(set(old_ratings) - set(new_ratings))
    return (
        [{"username": u, "rating": new_ratings.get(u)} for u in added],
        [{"username": u, "rating": old_ratings.get(u)} for u in removed],
    )


def _ratings_by_username(roster: List[Dict]) -> Dict[str, Optional[int]]:
    return {p["username"].lower(): p.get("rating") for p in roster if p.get("username")}


def update_registration_history(
    cache: Dict,
    match_url: str,
    our_roster: List[Dict],
    opp_roster: List[Dict],
    run_ts: str,
) -> List[Dict]:
    """
    Compute roster diff for an open match, update the cache in-place, and return
    the full history list for that match.

    On the first run for a match, all current players are recorded as 'added'.
    Subsequent runs only append an entry if at least one player joined or left.
    Each added/removed entry carries the player's rating at the time of the event.
    """
    our_ratings = _ratings_by_username(our_roster)
    opp_ratings = _ratings_by_username(opp_roster)

    entry = cache["matches"].get(match_url)

    if entry is None:
        # First time seeing this match — initialise snapshot and record all as added.
        cache["matches"][match_url] = {
            "snapshot": {
                "our": our_ratings,
                "opp": opp_ratings,
            },
            "history": [
                {
                    "ts": run_ts,
                    "our": {"added": [{"username": u, "rating": r} for u, r in sorted(our_ratings.items())], "removed": []},
                    "opp": {"added": [{"username": u, "rating": r} for u, r in sorted(opp_ratings.items())], "removed": []},
                }
            ],
        }
    else:
        # Backward compat: older cache entries stored snapshots as plain username lists.
        old_our = entry["snapshot"]["our"]
        old_opp = entry["snapshot"]["opp"]
        if isinstance(old_our, list):
            old_our = {u: None for u in old_our}
        if isinstance(old_opp, list):
            old_opp = {u: None for u in old_opp}

        our_added, our_removed = _diff_roster(old_our, our_ratings)
        opp_added, opp_removed = _diff_roster(old_opp, opp_ratings)

        if our_added or our_removed or opp_added or opp_removed:
            entry["history"].append(
                {
                    "ts": run_ts,
                    "our": {"added": our_added, "removed": our_removed},
                    "opp": {"added": opp_added, "removed": opp_removed},
                }
            )
            # Update snapshot to reflect current state.
            entry["snapshot"]["our"] = our_ratings
            entry["snapshot"]["opp"] = opp_ratings

    return cache["matches"][match_url]["history"]


def load_existing_match_ids() -> set:
    """Load finished match IDs from existing data file to avoid re-processing.
    In-progress and open matches are always re-fetched for updated data."""
    if not os.path.exists(OUTPUT_FILE):
        return set()
    
    try:
        with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        match_ids = set()
        for league_data in data.get("leagues", {}).values():
            for sub_league_data in league_data.get("subLeagues", {}).values():
                for round_data in sub_league_data.get("rounds", []):
                    # Only skip finished matches
                    if round_data.get("status") == "finished":
                        match_id = round_data.get("matchId")
                        if match_id:
                            match_ids.add(match_id)
        
        return match_ids
    except Exception as e:
        print(f"Warning: Could not load existing data: {e}")
        return set()


def _title_has_round_before_teams(title: str) -> bool:
    """Whether a title has a usable round marker before the match teams."""
    vs_match = re.search(r"\b(?:vs|v\.?s?\.?|versus)\b", title or "", re.IGNORECASE)
    round_match = re.search(
        r"\b(?:Round|Rd)\.?\s*\d+\b|\bR\d+\b|\b(?:Game|G)\.?\s*\d+\b",
        title or "",
        re.IGNORECASE,
    )
    return not vs_match or not round_match or round_match.start() < vs_match.start()


def _parse_existing_round(league_name: str, old_subleague: str, round_data: Dict) -> Dict[str, str]:
    """Recover a stable identity from stored data without making API calls."""
    title = round_data.get("name", "")
    parsed = parse_match_title(title)
    if (
        parsed
        and parsed.get("subLeague") != "__unresolved__"
        and parsed.get("league") == league_name
        and _title_has_round_before_teams(title)
    ):
        return parsed

    return {
        "league": league_name,
        "subLeague": old_subleague,
        "canonicalSubLeague": canonical_subleague_key(old_subleague),
        "round": round_data.get("round"),
        "confidence": "low",
    }


def _parse_round_with_api_context(league_name: str, old_subleague: str, round_data: Dict) -> Dict[str, str]:
    """Repair an ambiguous stored round by fetching its team names once."""
    match_url = round_data.get("matchUrl") or round_data.get("matchId")
    if not match_url:
        return _parse_existing_round(league_name, old_subleague, round_data)

    match_json = fetch_json(match_url)
    if not match_json:
        return _parse_existing_round(league_name, old_subleague, round_data)

    teams = match_json.get("teams", {})
    team_names = [
        team_data.get("name", "")
        for team_data in teams.values()
        if isinstance(team_data, dict) and team_data.get("name")
    ]
    parsed = parse_match_title(match_json.get("name") or round_data.get("name", ""), team_names)
    if parsed and parsed.get("subLeague") != "__unresolved__":
        return parsed
    return _parse_existing_round(league_name, old_subleague, round_data)


def _display_name_sort_key(name: str) -> tuple:
    """Prefer clean, human-readable aliases when canonical keys are merged."""
    punctuation = sum(1 for char in name if not (char.isalnum() or char.isspace() or char == "+"))
    uppercase_penalty = sum(1 for word in name.split() if word.isalpha() and word.isupper())
    return punctuation, uppercase_penalty, len(name), name.casefold()


def _round_quality(round_data: Dict, source_priority: int = 0) -> tuple:
    """Rank duplicate snapshots, preferring refreshed data and final status."""
    status_rank = {"open": 1, "in_progress": 2, "finished": 3}.get(round_data.get("status"), 0)
    return (
        source_priority,
        status_rank,
        round_data.get("endTime") or 0,
        round_data.get("startTime") or 0,
        round_data.get("matchId") or round_data.get("matchUrl") or "",
    )


def _start_calendar_day(round_data: Dict) -> Optional[str]:
    """Return a stable UTC calendar day for simultaneous-start detection."""
    value = round_data.get("startTime", round_data.get("start_time"))
    try:
        return datetime.fromtimestamp(float(value), tz=timezone.utc).date().isoformat()
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _finalize_rounds(rounds: List[Dict]) -> List[Dict]:
    """Deduplicate, sort, and assign deterministic NA-style round IDs."""
    for round_data in rounds:
        title = round_data.get("name", "")
        stored_round = str(round_data.get("round") or "")
        if not title or not re.fullmatch(r"G\d+", stored_round, re.IGNORECASE):
            continue
        if title not in _TITLE_ROUND_CACHE:
            parsed = parse_match_title(title)
            _TITLE_ROUND_CACHE[title] = parsed.get("round") if parsed else None
        if _TITLE_ROUND_CACHE[title] is None:
            round_data["round"] = None
    by_match = {}
    for round_data in rounds:
        match_key = round_data.get("matchId") or round_data.get("matchUrl") or round_data.get("name")
        current = by_match.get(match_key)
        if current is None or _round_quality(round_data) >= _round_quality(current):
            by_match[match_key] = round_data
    all_rounds = list(by_match.values())

    def get_round_sort_key(round_data):
        rs = (round_data.get("round") or "").strip()
        if not rs:
            return (3, 0, round_data.get("startTime") or 0, round_data.get("matchId") or "")
        m_r = re.match(r"^R(\d+)$", rs, re.IGNORECASE)
        if m_r:
            return (1, int(m_r.group(1)), 0, round_data.get("matchId") or "")
        m_g = re.match(r"^G(\d+)$", rs, re.IGNORECASE)
        if m_g:
            return (2, int(m_g.group(1)), 0, round_data.get("matchId") or "")
        return (3, 0, round_data.get("startTime") or 0, round_data.get("matchId") or "")

    all_rounds.sort(key=get_round_sort_key)
    explicit_round_re = re.compile(r"^(?:[RG]\d+)$", re.IGNORECASE)
    rounds_needing_na = []

    for round_data in all_rounds:
        rs = (round_data.get("round") or "").strip()
        if explicit_round_re.match(rs):
            continue
        else:
            rounds_needing_na.append(round_data)

    # Some tournaments intentionally start every match at once and do not
    # have rounds.  Do not describe those as missing/unknown rounds.  M<n> is
    # a deterministic simultaneous-match ordinal, sorted by start time then
    # match ID; it is not treated as a numbered R/G round in diagnostics.
    start_days = {_start_calendar_day(round_data) for round_data in all_rounds}
    simultaneous_batch = (
        len(all_rounds) >= 2
        and not any(explicit_round_re.match((round_data.get("round") or "").strip()) for round_data in all_rounds)
        and len(start_days) == 1
        and None not in start_days
    )
    if simultaneous_batch:
        all_rounds.sort(
            key=lambda round_data: (
                round_data.get("startTime") or 0,
                round_data.get("matchId") or round_data.get("matchUrl") or "",
            )
        )
        for index, round_data in enumerate(all_rounds, start=1):
            round_data["round"] = f"M{index}"
        return all_rounds

    # Reassign every non-numbered round, including previously assigned NA IDs.
    # This matters when two old sub-leagues are merged: each may already have
    # an "NA" round, and preserving those labels would create duplicates.
    for index, round_data in enumerate(rounds_needing_na, start=1):
        round_data["round"] = "NA" if index == 1 else f"NA-{index}"

    return all_rounds


def _normalise_team_identity(value: Any) -> str:
    value = unicodedata.normalize("NFKC", str(value or "")).casefold()
    return " ".join(re.findall(r"[\w]+", value, flags=re.UNICODE))


def _round_team_records(round_data: Dict) -> List[Dict[str, str]]:
    """Return team identities, with legacy club IDs as a safe fallback.

    New rows carry an authoritative ``teams`` array from the match endpoint.
    Old datasets predate that field but always represent our configured club,
    so the fallback still detects an impossible duplicate round for our team.
    """
    records = []
    raw_teams = round_data.get("teams")
    if isinstance(raw_teams, list):
        for team in raw_teams:
            if not isinstance(team, dict):
                continue
            club_id = _normalise_team_identity(team.get("clubId"))
            name = str(team.get("name") or team.get("clubId") or "").strip()
            identity = f"club:{club_id}" if club_id else f"name:{_normalise_team_identity(name)}"
            if identity not in {record["identity"] for record in records} and identity not in {"club:", "name:"}:
                records.append({"identity": identity, "name": name or identity})
        if records:
            return records

    # Legacy rows can still establish that this club cannot play twice in an
    # exact round.  Opponent club IDs, when present, add another stable check.
    if CLUB_ID:
        records.append({"identity": f"club:{_normalise_team_identity(CLUB_ID)}", "name": CLUB_ID})
    opponent = round_data.get("opponentClubId")
    if opponent:
        records.append({
            "identity": f"club:{_normalise_team_identity(opponent)}",
            "name": str(opponent),
        })
    return records


def _has_authoritative_team_pair(round_data: Dict) -> bool:
    """Whether a row contains the two API-sourced teams required by G repairs."""
    raw_teams = round_data.get("teams")
    return isinstance(raw_teams, list) and len(_round_team_records(round_data)) >= 2


def _normalised_round_label(round_data: Dict) -> Optional[str]:
    # Stored data from early versions occasionally retained a generic R1 even
    # when a reliable title said R2/R3.  Use a title marker when available so
    # the invariant is applied to the match's real round, not a stale cache
    # label.  Fresh API rows already agree with this value.
    value = round_data.get("round")
    title = round_data.get("name", "")
    if title and _title_has_round_before_teams(title):
        if title not in _TITLE_ROUND_CACHE:
            parsed = parse_match_title(title)
            _TITLE_ROUND_CACHE[title] = parsed.get("round") if parsed else None
        if _TITLE_ROUND_CACHE[title]:
            value = _TITLE_ROUND_CACHE[title]
        elif re.fullmatch(r"G\d+", str(value or ""), re.IGNORECASE):
            # A legacy parser wrote bare group markers as game rounds.  They
            # are not a real Round and must not trigger a collision.
            value = None
    value = str(value or "").strip().upper()
    # NA-style values are deterministic display placeholders, not a declared
    # competition round, and therefore cannot create a team-round collision.
    if re.fullmatch(r"NA(?:-\d+)?", value):
        return None
    return value or None


def _normalised_match_variant(round_data: Dict) -> Optional[str]:
    """Return the same-round match variant, when the title supplies one.

    Older output did not persist this field, so derive it from the original
    title as a backwards-compatible fallback.  An absent variant is kept
    distinct from a named variant: two unlabelled matches in one round are
    still a collision, while ``Classic``, ``Thematic``, and ``Chess960`` can
    legitimately coexist.
    """
    value = round_data.get("matchVariant")
    if not value:
        title = round_data.get("name", "")
        if title:
            parsed = parse_match_title(title)
            value = parsed.get("matchVariant") if parsed else None
    if not value:
        return None
    value = unicodedata.normalize("NFKC", str(value)).casefold()
    return " ".join(value.split()) or None


def _team_round_collisions(left_rounds: List[Dict], right_rounds: List[Dict]) -> List[Dict[str, str]]:
    """Find hard team/round conflicts that make combining two buckets invalid."""
    collisions = []
    right_by_round = defaultdict(list)
    for right in right_rounds:
        right_round = _normalised_round_label(right)
        if right_round:
            right_by_round[right_round].append(right)
    for left in left_rounds:
        left_round = _normalised_round_label(left)
        if not left_round:
            continue
        left_match = left.get("matchId") or left.get("matchUrl")
        left_teams = {record["identity"]: record["name"] for record in _round_team_records(left)}
        if not left_teams:
            continue
        for right in right_by_round.get(left_round, []):
            right_match = right.get("matchId") or right.get("matchUrl")
            if left_match and right_match and left_match == right_match:
                continue
            right_teams = {record["identity"]: record["name"] for record in _round_team_records(right)}
            left_variant = _normalised_match_variant(left)
            right_variant = _normalised_match_variant(right)
            # A named variant represents a separate match in formats such as
            # Fire and Ashes, which has Classic, Thematic, and 960 matches for
            # each round.  Only identical variant slots collide; unlabelled
            # duplicate matches remain guarded by the old invariant.
            if left_variant and right_variant and left_variant != right_variant:
                continue
            for identity in sorted(set(left_teams) & set(right_teams)):
                collisions.append({
                    "team": left_teams.get(identity) or right_teams.get(identity) or identity,
                    "round": left_round,
                    "leftMatchId": str(left_match or ""),
                    "rightMatchId": str(right_match or ""),
                })
    return collisions


def _orphan_pairing_rejection(orphan_rounds: List[Dict], destination_rounds: List[Dict]) -> Optional[str]:
    """Validate a G1/G2 orphan repair using API-sourced team pairings.

    Historical rows without API team data are intentionally left as unknown so
    that a data migration does not reinterpret old title-only fixtures.  Once
    both sides contain endpoint data, lack of enrolment is a hard rejection.
    """
    if len(orphan_rounds) != 1:
        return None
    orphan = orphan_rounds[0]
    if not _has_authoritative_team_pair(orphan) or not any(
        _has_authoritative_team_pair(round_data) for round_data in destination_rounds
    ):
        return None

    orphan_records = _round_team_records(orphan)
    orphan_ids = {record["identity"] for record in orphan_records}
    destination_records = [
        record for round_data in destination_rounds for record in _round_team_records(round_data)
    ]
    destination_ids = {record["identity"] for record in destination_records}
    missing = [record["name"] for record in orphan_records if record["identity"] not in destination_ids]
    if missing:
        return "REJECTED: G1/G2 team not enrolled in destination group [" + ", ".join(sorted(missing)) + "]"

    orphan_pair = frozenset(orphan_ids)
    for round_data in destination_rounds:
        if not _has_authoritative_team_pair(round_data):
            continue
        if frozenset(record["identity"] for record in _round_team_records(round_data)) == orphan_pair:
            return "REJECTED: G1/G2 team pairing already scheduled in destination group"
    return None


def _match_id_integer(round_data: Dict) -> Optional[int]:
    """Extract the integer portion of a Chess.com match ID or endpoint URL."""
    value = round_data.get("matchId") or round_data.get("matchUrl")
    match = re.search(r"(?:^|/)(\d+)(?:/?$)", str(value or ""))
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def _match_id_distance_score(candidate_rounds: List[Dict], new_round: Dict) -> float:
    """Score Match-ID proximity; same launch batches receive the highest score."""
    new_id = _match_id_integer(new_round)
    candidate_ids = [
        match_id for match_id in (_match_id_integer(round_data) for round_data in candidate_rounds)
        if match_id is not None
    ]
    if new_id is None or not candidate_ids:
        return 0.0
    distance = min(abs(new_id - candidate_id) for candidate_id in candidate_ids)
    # Chess.com allocates adjacent IDs to matches launched together.  The
    # exponential falloff keeps a very old numeric neighbour from outweighing
    # title structure or an actual schedule cadence.
    return exp(-distance / 750.0)


def _group_match_id_distance_score(left_rounds: List[Dict], right_rounds: List[Dict]) -> float:
    scores = [
        _match_id_distance_score(right_rounds, round_data) for round_data in left_rounds
    ] + [
        _match_id_distance_score(left_rounds, round_data) for round_data in right_rounds
    ]
    meaningful = [score for score in scores if score > 0]
    return sum(meaningful) / len(meaningful) if meaningful else 0.0


def _normalise_metadata_value(value: Any) -> Any:
    """Make API comparisons stable across equivalent JSON scalar forms."""
    if isinstance(value, str):
        return " ".join(value.casefold().split())
    if isinstance(value, list):
        return [_normalise_metadata_value(item) for item in value]
    if isinstance(value, dict):
        return {
            str(key).casefold(): _normalise_metadata_value(item)
            for key, item in sorted(value.items(), key=lambda item: str(item[0]).casefold())
        }
    return value


def _round_api_metadata(round_data: Dict) -> Dict[str, Any]:
    metadata = round_data.get("apiMetadata")
    metadata = metadata if isinstance(metadata, dict) else {}
    return {
        "max_rating": metadata.get("maxRating", round_data.get("maxRating")),
        "min_rating": metadata.get("minRating", round_data.get("minRating")),
        "rules": metadata.get("rules"),
        "time_control": metadata.get("timeControl", round_data.get("timeControl")),
        "boards": metadata.get("boards", round_data.get("boards")),
    }


def _subleague_requirements(names: List[str]) -> Dict[str, Any]:
    """Resolve configured and label-derived API requirements for a candidate."""
    requirements: Dict[str, Any] = {}
    for name in names:
        text = unicodedata.normalize("NFKC", name or "")
        for rule in SUBLEAGUE_RULES:
            if not isinstance(rule, dict) or not rule.get("pattern"):
                continue
            try:
                matches = re.search(str(rule["pattern"]), text, re.IGNORECASE)
            except re.error:
                continue
            if matches:
                for key in ("max_rating", "min_rating", "rules", "time_control", "boards"):
                    if key in rule and rule[key] is not None:
                        requirements[key] = rule[key]

        # Rating labels are themselves an explicit sub-league rule.  This
        # handles U1800 and 1400-1600 across sites even before a site adds a
        # more specialised configuration entry.
        cap = re.search(r"\bU\s*(\d{3,4})\b", text, re.IGNORECASE)
        if cap:
            requirements["max_rating"] = int(cap.group(1))
        rating_range = re.search(r"\b(\d{3,4})\s*[-\u2013\u2014]\s*(\d{3,4})\b", text)
        if rating_range:
            requirements["min_rating"] = int(rating_range.group(1))
            requirements["max_rating"] = int(rating_range.group(2))
        rating_floor = re.search(r"\b(\d{3,4})\s*\+(?!\d)", text)
        if rating_floor:
            requirements["min_rating"] = int(rating_floor.group(1))
    return requirements


def _metadata_values_match(actual: Any, required: Any) -> bool:
    if isinstance(required, (int, float)) and not isinstance(required, bool):
        try:
            return float(actual) == float(required)
        except (TypeError, ValueError):
            return False
    return _normalise_metadata_value(actual) == _normalise_metadata_value(required)


def _api_metadata_validation(rounds: List[Dict], candidate_names: List[str]) -> tuple:
    """Return ``(valid, reasons, requirements)`` for an API metadata prefilter."""
    requirements = _subleague_requirements(candidate_names)
    if not requirements:
        return True, [], requirements

    labels = {
        "max_rating": ("Rating cap", "max_rating"),
        "min_rating": ("Rating floor", "min_rating"),
        "rules": ("Rules", "rules"),
        "time_control": ("Time control", "time_control"),
        "boards": ("Board count", "boards"),
    }
    reasons = []
    for round_data in rounds:
        metadata = _round_api_metadata(round_data)
        for field, required in requirements.items():
            actual = metadata.get(field)
            # An absent endpoint value is not evidence of a contradiction.
            if actual is None:
                continue
            if not _metadata_values_match(actual, required):
                label, api_field = labels[field]
                reasons.append(
                    f"REJECTED: {label} mismatch (API {api_field}={actual!r}, required={required!r})"
                )
    return not reasons, sorted(set(reasons)), requirements


def _combined_score(structural: float, schedule: float, match_id_distance: float) -> float:
    """Keep structural identity dominant while including both schedule signals."""
    return structural * 0.72 + schedule * 0.20 + match_id_distance * 0.08


def _collision_isolation_key(group_key, rounds: List[Dict]) -> tuple:
    """Keep a rejected exact-key match visible without collapsing its evidence."""
    identifiers = [
        str(round_data.get("matchId") or round_data.get("matchUrl") or "match")
        for round_data in rounds
    ]
    suffix = re.sub(r"[^a-z0-9]+", "-", min(identifiers).casefold()).strip("-") or "match"
    return group_key[0], f"{group_key[1]} collision {suffix}"


@lru_cache(maxsize=4096)
def _identity_profile(name: str) -> Dict[str, Any]:
    """Return semantic and non-season tokens used by guarded matching."""
    canonical = canonical_subleague_key(name)
    season_spans = {
        (match.group(1), match.group(2))
        for match in re.finditer(r"\bseason(20\d{2})(20\d{2})\b", canonical)
    }
    without_spans = re.sub(r"\bseason20\d{2}20\d{2}\b", " ", canonical)
    standalone_years = set(re.findall(r"\b(?:19|20)\d{2}\b", without_spans))
    without_years = re.sub(r"\b(?:19|20)\d{2}\b", " ", without_spans)
    token_list = re.findall(r"[a-z0-9+]+", without_years)
    tokens = set(token_list)
    markers = set()
    for index, token in enumerate(token_list):
        next_token = token_list[index + 1] if index + 1 < len(token_list) else None
        if re.fullmatch(r"g\d+", token):
            markers.add(f"group:{token[1:]}")
        elif re.fullmatch(r"(?:u|d|div|division)\d+", token):
            markers.add(f"division:{token}")
        elif token in {"div", "division", "d", "u"} and next_token and re.fullmatch(r"\d+", next_token):
            markers.add(f"division:{token}:{next_token}")
        elif re.fullmatch(r"[a-z]", token):
            markers.add(f"letter:{token}")
        elif token in {"chess960", "rapid", "blitz", "playoff", "playoffs", "final", "semifinal", "quarterfinal", "qualifier"}:
            markers.add(f"stage:{token}")
    explicit_seasons = set(season_spans) | {(year, year) for year in standalone_years}
    return {
        "canonical": canonical,
        "seasons": explicit_seasons,
        "tokens": tokens,
        "markers": markers,
    }


def _seasons_compatible(left: Dict[str, Any], right: Dict[str, Any]) -> bool:
    """Reject an explicit season conflict before any fuzzy/date comparison."""
    return not left["seasons"] or not right["seasons"] or left["seasons"] == right["seasons"]


@lru_cache(maxsize=16384)
def _structural_score(left_name: str, right_name: str) -> float:
    """Compare non-season identity tokens conservatively."""
    left = _identity_profile(left_name)
    right = _identity_profile(right_name)
    if not _seasons_compatible(left, right):
        return 0.0
    if not left["tokens"] or not right["tokens"]:
        return 0.0

    if left["markers"] and right["markers"] and left["markers"] != right["markers"]:
        return 0.0

    # These token families are identity-bearing, so a fuzzy string similarity
    # must never bridge an explicit group, division/rating, variant, or stage
    # conflict.  If one side omitted the token, the date layer may still help;
    # if both supplied it, they must agree exactly.
    meaningful_patterns = (
        r"(?:g|p|s)\d+",
        r"(?:u|d|div|division)\d+",
        r"\d{3,4}",
        r"chess960|rapid|blitz|playoffs?|final|semifinal|quarterfinal|qualifier",
    )
    for pattern in meaningful_patterns:
        left_meaningful = {token for token in left["tokens"] if re.fullmatch(pattern, token)}
        right_meaningful = {token for token in right["tokens"] if re.fullmatch(pattern, token)}
        if left_meaningful and right_meaningful and left_meaningful != right_meaningful:
            return 0.0

    intersection = len(left["tokens"] & right["tokens"])
    union = len(left["tokens"] | right["tokens"])
    jaccard = intersection / union if union else 0.0
    left_text = " ".join(sorted(left["tokens"]))
    right_text = " ".join(sorted(right["tokens"]))
    sequence = SequenceMatcher(None, left_text, right_text).ratio()
    return max(jaccard, sequence * 0.92)


def _timestamp(round_data: Dict) -> Optional[float]:
    value = round_data.get("startTime", round_data.get("start_time"))
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _cadence_tolerance(typical_gap: float) -> float:
    if typical_gap <= 2:
        return 2.0
    if typical_gap <= 10:
        return max(4.0, typical_gap * 0.5)
    if typical_gap <= 21:
        return max(7.0, typical_gap * 0.5)
    if typical_gap <= 45:
        return max(14.0, typical_gap * 0.5)
    return max(30.0, typical_gap)


def _schedule_score(candidate_rounds: List[Dict], new_round: Dict) -> float:
    """Score how naturally a match fits an existing sub-league schedule.

    This is evidence only.  It never gets a chance to merge labels whose
    meaningful structural tokens disagree.
    """
    new_time = _timestamp(new_round)
    existing_times = sorted(
        timestamp for timestamp in (_timestamp(round_data) for round_data in candidate_rounds)
        if timestamp is not None
    )
    if new_time is None or not existing_times:
        return 0.0

    if len(existing_times) == 1:
        distance_days = abs(new_time - existing_times[0]) / 86400.0
        return max(0.0, 1.0 - min(distance_days, 365.0) / 365.0) * 0.65

    gaps = [
        (right - left) / 86400.0
        for left, right in zip(existing_times, existing_times[1:])
        if right >= left
    ]
    typical_gap = median(gaps) if gaps else 0.0
    tolerance = _cadence_tolerance(typical_gap)

    insertion = 0
    while insertion < len(existing_times) and existing_times[insertion] < new_time:
        insertion += 1
    neighbor_gaps = []
    if insertion:
        neighbor_gaps.append((new_time - existing_times[insertion - 1]) / 86400.0)
    if insertion < len(existing_times):
        neighbor_gaps.append((existing_times[insertion] - new_time) / 86400.0)

    local_scores = [
        max(0.0, 1.0 - abs(gap - typical_gap) / max(tolerance, 1.0))
        for gap in neighbor_gaps
    ]
    cadence = max(local_scores) if local_scores else 0.0

    window_start = existing_times[0]
    window_end = existing_times[-1]
    if window_start <= new_time <= window_end:
        return min(1.0, 0.55 + 0.45 * cadence)

    boundary_gap = min(abs(new_time - window_start), abs(new_time - window_end)) / 86400.0
    boundary_score = max(0.0, 1.0 - max(0.0, boundary_gap - typical_gap) / max(tolerance * 2.0, 1.0))
    return min(1.0, 0.45 * cadence + 0.55 * boundary_score)


@lru_cache(maxsize=4096)
def _trailing_letter_alias(name: str):
    """Return the base label and suffix for a possible legacy A/B alias."""
    canonical = canonical_subleague_key(name)
    match = re.match(r"^(?P<base>.+)\s+(?P<suffix>[a-z])$", canonical, re.IGNORECASE)
    if not match:
        return canonical, None
    return match.group("base"), match.group("suffix").casefold()


@lru_cache(maxsize=16384)
def _legacy_alias_structural_score(left_name: str, right_name: str) -> float:
    """Allow a trailing letter alias only when exactly one side has it."""
    left_base, left_suffix = _trailing_letter_alias(left_name)
    right_base, right_suffix = _trailing_letter_alias(right_name)
    if (left_suffix is None) == (right_suffix is None):
        return 0.0
    if left_suffix is not None and right_suffix is not None:
        return 0.0
    return _structural_score(left_base, right_base) if left_base == right_base else 0.0


@lru_cache(maxsize=4096)
def _group_alias_parts(name: str):
    """Return the identity without one explicit G<n> group marker."""
    canonical = canonical_subleague_key(name)
    tokens = canonical.split()
    group_tokens = [token for token in tokens if re.fullmatch(r"g\d+", token, re.IGNORECASE)]
    if len(group_tokens) != 1:
        return None
    base = " ".join(token for token in tokens if token.casefold() != group_tokens[0].casefold()).strip()
    return base, group_tokens[0].casefold()


@lru_cache(maxsize=16384)
def _group_alias_structural_score(left_name: str, right_name: str) -> float:
    """Compare labels that differ only by an explicit G<n> marker."""
    left = _group_alias_parts(left_name)
    right = _group_alias_parts(right_name)
    if not left or not right or left[1] == right[1] or left[0] != right[0]:
        return 0.0
    return _structural_score(left[0], right[0])


def _explicit_round_numbers(rounds: List[Dict]) -> set:
    return {
        int(match.group(1))
        for round_data in rounds
        for match in [re.match(r"^R(\d+)$", str(round_data.get("round") or ""), re.IGNORECASE)]
        if match
    }


def _orphan_group_merge_score(left_rounds: List[Dict], right_rounds: List[Dict]) -> float:
    """Score a one-round group filling an internal numbered-round gap."""
    if len(left_rounds) == 1 and len(right_rounds) >= 3:
        orphan, larger = left_rounds, right_rounds
    elif len(right_rounds) == 1 and len(left_rounds) >= 3:
        orphan, larger = right_rounds, left_rounds
    else:
        return 0.0

    orphan_numbers = _explicit_round_numbers(orphan)
    larger_numbers = _explicit_round_numbers(larger)
    if len(orphan_numbers) != 1 or not larger_numbers:
        return 0.0

    orphan_number = next(iter(orphan_numbers))
    if orphan_number in larger_numbers or not min(larger_numbers) < orphan_number < max(larger_numbers):
        return 0.0

    score = _schedule_score(larger, orphan[0])
    return score if score >= 0.55 else 0.0


def _group_schedule_merge_score(left_rounds: List[Dict], right_rounds: List[Dict]) -> float:
    """Score whether two legacy buckets form one continuous dated schedule."""
    left_times = sorted(timestamp for timestamp in (_timestamp(r) for r in left_rounds) if timestamp is not None)
    right_times = sorted(timestamp for timestamp in (_timestamp(r) for r in right_rounds) if timestamp is not None)
    if not left_times or not right_times:
        return 0.0

    left_round_numbers = {
        int(match.group(1))
        for round_data in left_rounds
        for match in [re.match(r"^R(\d+)$", str(round_data.get("round") or ""), re.IGNORECASE)]
        if match
    }
    right_round_numbers = {
        int(match.group(1))
        for round_data in right_rounds
        for match in [re.match(r"^R(\d+)$", str(round_data.get("round") or ""), re.IGNORECASE)]
        if match
    }
    if left_round_numbers & right_round_numbers:
        return 0.0

    left_window = (left_times[0], left_times[-1])
    right_window = (right_times[0], right_times[-1])
    windows_overlap = max(left_window[0], right_window[0]) <= min(left_window[1], right_window[1])

    # When both legacy buckets contain only one match, there is no internal
    # cadence to learn.  An exact base-label alias plus consecutive, ordered
    # round numbers and a plausible inter-round date is still meaningful
    # evidence (for example base R1 followed by ``B`` R2 four weeks later).
    # Same-day/overlapping buckets are deliberately excluded because those are
    # more likely to be genuine parallel groups.
    if len(left_times) + len(right_times) < 3:
        if not left_round_numbers or not right_round_numbers or windows_overlap:
            return 0.0
        if left_times[-1] < right_times[0]:
            earlier_times, later_times = left_times, right_times
            earlier_numbers, later_numbers = left_round_numbers, right_round_numbers
        else:
            earlier_times, later_times = right_times, left_times
            earlier_numbers, later_numbers = right_round_numbers, left_round_numbers
        if max(earlier_numbers) >= min(later_numbers):
            return 0.0
        gap_days = (later_times[0] - earlier_times[-1]) / 86400.0
        if not 7.0 <= gap_days <= 60.0:
            return 0.0
        return 0.45 + 0.45 * max(0.0, 1.0 - abs(gap_days - 28.0) / 28.0)

    internal_gaps = []
    for times in (left_times, right_times):
        internal_gaps.extend(
            (right - left) / 86400.0
            for left, right in zip(times, times[1:])
            if right > left
        )
    if not internal_gaps:
        return 0.0

    typical_gap = median(internal_gaps)
    tolerance = _cadence_tolerance(typical_gap)

    # A bucket can sit inside another bucket's date window when it fills a
    # later numbered round (for example R8 between R6 and R9).  Score each
    # side as an insertion into the other schedule rather than requiring the
    # two date windows to be disjoint.
    left_fit = sum(_schedule_score(right_rounds, round_data) for round_data in left_rounds) / len(left_rounds)
    right_fit = sum(_schedule_score(left_rounds, round_data) for round_data in right_rounds) / len(right_rounds)
    insertion_fit = max(left_fit, right_fit)

    if windows_overlap:
        # Overlap is acceptable only when explicit round numbers show that the
        # buckets occupy different positions in one sequence.
        if not left_round_numbers or not right_round_numbers:
            return 0.0
        return insertion_fit

    if left_times[-1] < right_times[0]:
        boundary_gap = (right_times[0] - left_times[-1]) / 86400.0
    else:
        boundary_gap = (left_times[0] - right_times[-1]) / 86400.0
    boundary_fit = max(0.0, 1.0 - abs(boundary_gap - typical_gap) / max(tolerance, 1.0))
    return max(boundary_fit, insertion_fit)


def _candidate_names(group_key, display_names, source_names) -> List[str]:
    names = set(display_names.get(group_key, set()))
    names.update(source_names.get(group_key, set()))
    names.add(group_key[1])
    return sorted(name for name in names if name)


def _candidate_score_details(candidate_rounds: List[Dict], incoming_rounds: List[Dict]) -> Dict[str, Any]:
    """Calculate schedule and Match-ID proximity used for guarded grouping."""
    schedule_scores = [_schedule_score(candidate_rounds, round_data) for round_data in incoming_rounds]
    match_id_scores = [
        _match_id_distance_score(candidate_rounds, round_data) for round_data in incoming_rounds
    ]
    return {
        "scheduleScore": round(sum(schedule_scores) / len(schedule_scores), 4) if schedule_scores else 0.0,
        "matchIdDistanceScore": round(sum(match_id_scores) / len(match_id_scores), 4) if match_id_scores else 0.0,
        "scheduleScores": [round(score, 4) for score in schedule_scores],
    }


def _resolve_organized_group(
    group_key,
    rounds: List[Dict],
    organized_names,
    existing_groups,
    existing_display_names,
    existing_sources,
):
    """Resolve a non-exact new group against old groups with guarded evidence."""
    incoming_names = sorted(organized_names.get(group_key, set()) or {group_key[1]})
    if group_key in existing_groups:
        destination_names = _candidate_names(group_key, existing_display_names, existing_sources)
        metadata_valid, metadata_reasons, _ = _api_metadata_validation(rounds, destination_names)
        collisions = _team_round_collisions(rounds, existing_groups[group_key])
        if metadata_valid and not collisions:
            return group_key, [], [], None

        if metadata_reasons:
            rejection_reason = metadata_reasons[0]
        else:
            collision = collisions[0]
            rejection_reason = f"REJECTED: Team round collision [{collision['team']}] in {collision['round']}"
        isolation_key = _collision_isolation_key(group_key, rounds)
        preferred_name = f"{incoming_names[0]} [unassigned {str(rounds[0].get('matchId') or 'collision')}]"
        return isolation_key, [], [{
            "name": round_data.get("name", ""),
            "matchId": round_data.get("matchId"),
            "reason": rejection_reason,
        } for round_data in rounds], preferred_name

    candidates = []
    for candidate_key, candidate_rounds in existing_groups.items():
        if candidate_key[0] != group_key[0]:
            continue
        candidate_names = _candidate_names(candidate_key, existing_display_names, existing_sources)
        # Explicit API metadata is a hard prefilter.  Do not spend time on
        # fuzzy title or schedule comparisons for a contradictory league.
        metadata_valid, _, _ = _api_metadata_validation(rounds, candidate_names)
        if not metadata_valid:
            continue
        structural = max(
            (_structural_score(incoming_name, candidate_name)
             for incoming_name in incoming_names
             for candidate_name in candidate_names),
            default=0.0,
        )
        alias_type = None
        if structural < 0.98:
            group_structural = max(
                (_group_alias_structural_score(incoming_name, candidate_name)
                 for incoming_name in incoming_names
                 for candidate_name in candidate_names),
                default=0.0,
            )
            if group_structural >= 0.98 and _orphan_group_merge_score(rounds, candidate_rounds) > 0:
                structural = group_structural
                alias_type = "orphan-group"
        if alias_type == "orphan-group":
            pairing_rejection = _orphan_pairing_rejection(rounds, candidate_rounds)
        else:
            pairing_rejection = None
        collisions = _team_round_collisions(rounds, candidate_rounds)
        if collisions or pairing_rejection or structural < 0.86:
            continue
        score_details = _candidate_score_details(candidate_rounds, rounds)
        schedule = score_details["scheduleScore"]
        if alias_type == "orphan-group":
            schedule = _orphan_group_merge_score(rounds, candidate_rounds)
            score_details = dict(score_details, scheduleScore=round(schedule, 4))
        candidates.append({
            "key": candidate_key,
            "subLeague": candidate_names[0] if candidate_names else candidate_key[1],
            "structuralScore": round(structural, 4),
            "scoreDetails": score_details,
            "totalScore": round(_combined_score(structural, schedule, score_details["matchIdDistanceScore"]), 4),
            "aliasType": alias_type,
            "candidateNames": candidate_names,
        })

    if not candidates:
        # A cohesive new title is a valid standalone sub-league.  The absence
        # of a historical merge target is not an ambiguity or a data gap.
        return group_key, [], [], None

    candidates.sort(key=lambda candidate: (candidate["totalScore"], candidate["structuralScore"], candidate["subLeague"].casefold()), reverse=True)
    top = candidates[0]
    second = candidates[1] if len(candidates) > 1 else None
    margin = top["totalScore"] - second["totalScore"] if second else 1.0
    incoming_has_explicit_season = any(_identity_profile(name)["seasons"] for name in incoming_names)
    date_evidence_used = len(candidates) > 1 or not incoming_has_explicit_season or top.get("aliasType") == "orphan-group"

    # A date may break a close structural tie, but cannot rescue weak structure.
    # A single exact structural candidate is safe when it is the only plausible
    # destination; title season conflicts were already filtered above.
    if top["structuralScore"] >= 0.98 and (second is None or margin >= 0.12):
        date_resolved = []
        if date_evidence_used and top["scoreDetails"]["scheduleScore"] > 0:
            for round_data, score in zip(rounds, top["scoreDetails"]["scheduleScores"]):
                if score > 0:
                    date_resolved.append({
                        "matchId": round_data.get("matchId"),
                        "name": round_data.get("name", ""),
                        "reason": (
                            "schedule evidence assigned a one-round group alias to the larger sub-league"
                            if top.get("aliasType") == "orphan-group"
                            else "schedule evidence selected the structurally compatible sub-league"
                        ),
                    })
        preferred_name = top["subLeague"] if top.get("aliasType") == "orphan-group" else None
        return top["key"], date_resolved, [], preferred_name

    return group_key, [], [{
        "name": round_data.get("name", ""),
        "matchId": round_data.get("matchId"),
        "reason": "multiple structurally compatible sub-leagues lacked a clear score margin",
    } for round_data in rounds], None


def _consolidate_existing_groups(groups, display_names, source_names, ambiguous):
    """Merge legacy alias buckets when their schedules clearly form one league."""
    date_resolved = defaultdict(list)

    while True:
        pair_candidates = []
        keys = list(groups.keys())
        for index, left_key in enumerate(keys):
            for right_key in keys[index + 1:]:
                if left_key[0] != right_key[0]:
                    continue
                left_names = _candidate_names(left_key, display_names, source_names)
                right_names = _candidate_names(right_key, display_names, source_names)
                structural = max(
                    (_legacy_alias_structural_score(left_name, right_name)
                     for left_name in left_names
                     for right_name in right_names),
                    default=0.0,
                )
                alias_type = "trailing-letter" if structural >= 0.98 else None
                if alias_type is None:
                    structural = max(
                        (_group_alias_structural_score(left_name, right_name)
                         for left_name in left_names
                         for right_name in right_names),
                        default=0.0,
                    )
                    if structural >= 0.98:
                        alias_type = "orphan-group"
                if structural < 0.98:
                    continue
                score_details = {
                    "scheduleScore": 0.0,
                    "matchIdDistanceScore": round(
                        _group_match_id_distance_score(groups[left_key], groups[right_key]), 4
                    ),
                }
                left_metadata_valid, _, _ = _api_metadata_validation(
                    groups[left_key], right_names
                )
                right_metadata_valid, _, _ = _api_metadata_validation(
                    groups[right_key], left_names
                )
                collisions = _team_round_collisions(groups[left_key], groups[right_key])
                if alias_type == "orphan-group":
                    if len(groups[left_key]) == 1:
                        pairing_rejection = _orphan_pairing_rejection(groups[left_key], groups[right_key])
                    else:
                        pairing_rejection = _orphan_pairing_rejection(groups[right_key], groups[left_key])
                else:
                    pairing_rejection = None
                if not left_metadata_valid or not right_metadata_valid:
                    continue
                if collisions:
                    collision = collisions[0]
                    reason = f"REJECTED: Team round collision [{collision['team']}] in {collision['round']}"
                    for key in (left_key, right_key):
                        for round_data in groups[key]:
                            ambiguous[key].append({
                                "matchId": round_data.get("matchId"),
                                "name": round_data.get("name", ""),
                                "reason": reason,
                            })
                    continue
                if pairing_rejection:
                    continue
                if alias_type == "orphan-group":
                    schedule = _orphan_group_merge_score(groups[left_key], groups[right_key])
                else:
                    schedule = _group_schedule_merge_score(groups[left_key], groups[right_key])
                score_details["scheduleScore"] = round(schedule, 4)
                # Monthly schedules commonly vary by a week around a 28-day
                # cadence, so a boundary gap of 35 days still qualifies when
                # the structural alias is exact.
                if schedule < 0.45:
                    continue
                pair_candidates.append({
                    "left": left_key,
                    "right": right_key,
                    "structural": structural,
                    "schedule": schedule,
                    "total": _combined_score(
                        structural, schedule, score_details["matchIdDistanceScore"]
                    ),
                    "aliasType": alias_type,
                    "scoreDetails": score_details,
                    "leftNames": left_names,
                    "rightNames": right_names,
                })

        if not pair_candidates:
            break
        pair_candidates.sort(key=lambda candidate: candidate["total"], reverse=True)
        top = None
        for candidate in pair_candidates:
            candidate_keys = {candidate["left"], candidate["right"]}
            related = [
                other for other in pair_candidates
                if other is not candidate
                and candidate_keys & {other["left"], other["right"]}
            ]
            best_related = max((other["total"] for other in related), default=None)
            left_rounds = groups[candidate["left"]]
            right_rounds = groups[candidate["right"]]
            left_numbers = {
                round_data.get("round")
                for round_data in left_rounds
                if re.match(r"^R\d+$", str(round_data.get("round") or ""), re.IGNORECASE)
            }
            right_numbers = {
                round_data.get("round")
                for round_data in right_rounds
                if re.match(r"^R\d+$", str(round_data.get("round") or ""), re.IGNORECASE)
            }
            numbered_sequence_evidence = bool(left_numbers and right_numbers and not left_numbers & right_numbers)
            if (
                best_related is None
                or candidate["total"] - best_related >= 0.12
                or (candidate["aliasType"] == "trailing-letter" and numbered_sequence_evidence)
            ):
                top = candidate
                break

        if top is None:
            # Equal schedule evidence for multiple aliases of the same group
            # is not enough to decide which one a legacy bucket belongs to.
            for candidate in pair_candidates:
                for key in (candidate["left"], candidate["right"]):
                    for round_data in groups[key]:
                        ambiguous[key].append({
                            "matchId": round_data.get("matchId"),
                            "name": round_data.get("name", ""),
                            "reason": "multiple compatible sub-league aliases lacked a clear score margin",
                        })
            break

        left_key = top["left"]
        right_key = top["right"]
        left_names = _candidate_names(left_key, display_names, source_names)
        right_names = _candidate_names(right_key, display_names, source_names)
        if top["aliasType"] == "orphan-group":
            if len(groups[left_key]) >= len(groups[right_key]):
                destination, source = left_key, right_key
            else:
                destination, source = right_key, left_key
        else:
            left_has_base_name = any(_trailing_letter_alias(name)[1] is None for name in left_names)
            right_has_base_name = any(_trailing_letter_alias(name)[1] is None for name in right_names)
            if left_has_base_name and not right_has_base_name:
                destination, source = left_key, right_key
            elif right_has_base_name and not left_has_base_name:
                destination, source = right_key, left_key
            else:
                destination, source = sorted((left_key, right_key), key=lambda key: key[1])[0], sorted((left_key, right_key), key=lambda key: key[1])[1]

        source_rounds = list(groups.pop(source))
        groups[destination].extend(source_rounds)
        source_display_names = display_names.pop(source, set())
        if top["aliasType"] != "orphan-group":
            display_names[destination].update(source_display_names)
        source_names[destination].update(source_names.pop(source, set()))
        # A parsed title can expose the historical alias even when the outer
        # stored bucket already used the destination name. Preserve that alias
        # for mergedFrom diagnostics and for stable future repairs.
        source_names[destination].update(source_display_names)
        ambiguous[destination].extend(ambiguous.pop(source, []))
        merge_reason = (
            "schedule evidence merged a one-round group alias into the larger sub-league"
            if top["aliasType"] == "orphan-group"
            else "schedule evidence merged a legacy trailing-letter sub-league alias"
        )
        for round_data in source_rounds:
            date_resolved[destination].append({
                "matchId": round_data.get("matchId"),
                "name": round_data.get("name", ""),
                "reason": merge_reason,
            })

    return date_resolved


def _build_subleague_diagnostics(
    rounds: List[Dict],
    merged_from: List[str],
    ambiguous: List[Dict],
    date_resolved: Optional[List[Dict]] = None,
) -> Dict[str, Any]:
    observed = sorted(
        {
            int(match.group(1))
            for round_data in rounds
            for match in [re.match(r"^R(\d+)$", str(round_data.get("round") or ""), re.IGNORECASE)]
            if match
        }
    )
    missing = [f"R{number}" for number in range(observed[0], observed[-1] + 1) if number not in observed] if len(observed) >= 2 else []
    return {
        "mergedFrom": sorted(set(merged_from), key=str.casefold),
        "ambiguousMatches": ambiguous,
        "dateResolvedMatches": date_resolved or [],
        "observedRounds": [f"R{number}" for number in observed],
        "missingRounds": missing,
    }


def collect_existing_groups(existing_data: Dict, repair: bool = False):
    """Re-key stored rounds by canonical identity before adding new matches."""
    groups = defaultdict(list)
    display_names = defaultdict(set)
    ambiguous = defaultdict(list)
    source_names = defaultdict(set)

    for league_name, league_data in existing_data.items():
        for old_subleague, subleague_data in league_data.get("subLeagues", {}).items():
            for round_data in subleague_data.get("rounds", []):
                parsed = _parse_existing_round(league_name, old_subleague, round_data)
                if repair and parsed.get("confidence") == "low":
                    parsed = _parse_round_with_api_context(league_name, old_subleague, round_data)
                    time.sleep(0.3)

                canonical = parsed.get("canonicalSubLeague") or canonical_subleague_key(old_subleague)
                key = (parsed.get("league") or league_name, canonical)
                display_name = parsed.get("subLeague") or old_subleague
                if groups[key]:
                    candidate_names = _candidate_names(key, display_names, source_names)
                    metadata_valid, metadata_reasons, _ = _api_metadata_validation(
                        [round_data], candidate_names
                    )
                    collisions = _team_round_collisions([round_data], groups[key])
                    if not metadata_valid or collisions:
                        reason = (
                            metadata_reasons[0]
                            if metadata_reasons
                            else f"REJECTED: Team round collision [{collisions[0]['team']}] in {collisions[0]['round']}"
                        )
                        isolation_key = _collision_isolation_key(key, [round_data])
                        key = isolation_key
                        display_name = f"{display_name} [unassigned {str(round_data.get('matchId') or 'collision')}]"
                        ambiguous[key].append({
                            "matchId": round_data.get("matchId"),
                            "name": round_data.get("name", ""),
                            "reason": reason,
                        })
                groups[key].append(round_data)
                display_names[key].add(display_name)
                source_names[key].add(old_subleague)
                if parsed.get("confidence") == "low":
                    ambiguous[key].append({
                        "matchId": round_data.get("matchId"),
                        "name": round_data.get("name", ""),
                        "reason": "team context unavailable; retained existing sub-league key",
                    })

    date_resolved = _consolidate_existing_groups(
        groups,
        display_names,
        source_names,
        ambiguous,
    )
    return groups, display_names, source_names, ambiguous, date_resolved


def rebuild_leagues_output(
    existing_data: Dict,
    organized_data: Dict,
    organized_display_names: Dict,
    organized_ambiguous: Dict,
    repair: bool = False,
    organized_date_resolved: Optional[Dict] = None,
) -> Dict:
    """Merge refreshed matches and re-key existing rounds by canonical identity."""
    (
        existing_groups,
        existing_display_names,
        existing_sources,
        existing_ambiguous,
        existing_date_resolved,
    ) = collect_existing_groups(existing_data, repair=repair)

    # Semantic canonicalization normally gives an exact key.  This guarded
    # pass handles the remaining legacy cases (for example a title with no
    # season) without allowing a date cadence to merge unrelated labels.
    resolved_data = defaultdict(list)
    resolved_display_names = defaultdict(set)
    resolved_ambiguous = defaultdict(list)
    resolved_date_matches = defaultdict(list)
    supplied_date_matches = organized_date_resolved or {}
    for group_key, rounds in organized_data.items():
        destination, date_matches, resolver_ambiguous, preferred_display_name = _resolve_organized_group(
            group_key,
            rounds,
            organized_display_names,
            existing_groups,
            existing_display_names,
            existing_sources,
        )
        resolved_data[destination].extend(rounds)
        if preferred_display_name:
            resolved_display_names[destination].add(preferred_display_name)
        else:
            resolved_display_names[destination].update(organized_display_names.get(group_key, set()))
        resolved_ambiguous[destination].extend(organized_ambiguous.get(group_key, []))
        resolved_ambiguous[destination].extend(resolver_ambiguous)
        resolved_date_matches[destination].extend(supplied_date_matches.get(group_key, []))
        resolved_date_matches[destination].extend(date_matches)

    # A batch of fresh API rows can share a canonical title before it has an
    # existing bucket to compare against.  Partition any internal collision
    # here so the invariant applies equally to fresh-only, exact-key, and
    # schedule/alias repairs.  The rejected row remains visible under an
    # explicit unassigned key rather than being silently discarded.
    collision_checked_data = defaultdict(list)
    collision_checked_names = defaultdict(set)
    collision_checked_ambiguous = defaultdict(list)
    collision_checked_dates = defaultdict(list)
    for group_key, rounds in resolved_data.items():
        base_names = set(resolved_display_names.get(group_key, set())) or {group_key[1]}
        for round_data in rounds:
            collisions = _team_round_collisions([round_data], collision_checked_data[group_key])
            if not collisions:
                collision_checked_data[group_key].append(round_data)
                collision_checked_names[group_key].update(base_names)
                continue
            collision = collisions[0]
            reason = f"REJECTED: Team round collision [{collision['team']}] in {collision['round']}"
            isolation_key = _collision_isolation_key(group_key, [round_data])
            display_name = f"{sorted(base_names, key=_display_name_sort_key)[0]} [unassigned {str(round_data.get('matchId') or 'collision')}]"
            collision_checked_data[isolation_key].append(round_data)
            collision_checked_names[isolation_key].add(display_name)
            collision_checked_ambiguous[isolation_key].append({
                "matchId": round_data.get("matchId"),
                "name": round_data.get("name", ""),
                "reason": reason,
            })

        collision_checked_ambiguous[group_key].extend(resolved_ambiguous.get(group_key, []))
        collision_checked_dates[group_key].extend(resolved_date_matches.get(group_key, []))
    resolved_data = collision_checked_data
    resolved_display_names = collision_checked_names
    resolved_ambiguous = collision_checked_ambiguous
    resolved_date_matches = collision_checked_dates

    # Deduplicate globally, not just within a sub-league. A stale open match
    # can otherwise survive under its old key while the refreshed contextual
    # parse adds the same match under a new key.
    candidates_by_match = defaultdict(list)
    for group_key, rounds in existing_groups.items():
        for round_data in rounds:
            match_key = round_data.get("matchId") or round_data.get("matchUrl") or round_data.get("name")
            candidates_by_match[match_key].append((0, group_key, round_data))
    for group_key, rounds in resolved_data.items():
        for round_data in rounds:
            match_key = round_data.get("matchId") or round_data.get("matchUrl") or round_data.get("name")
            candidates_by_match[match_key].append((1, group_key, round_data))

    selected_groups = defaultdict(list)
    for candidates in candidates_by_match.values():
        source_priority, group_key, round_data = max(
            candidates,
            key=lambda candidate: _round_quality(candidate[2], candidate[0]),
        )
        selected_groups[group_key].append((source_priority, round_data))

    all_keys = set(selected_groups)
    leagues_output = defaultdict(lambda: {"subLeagues": {}})

    for league_name, canonical in sorted(all_keys, key=lambda item: (item[0], item[1])):
        selected_rounds = selected_groups[(league_name, canonical)]
        existing_rounds = [round_data for source, round_data in selected_rounds if source == 0]
        new_rounds = [round_data for source, round_data in selected_rounds if source == 1]
        if new_rounds:
            rounds = [r for r in existing_rounds if r.get("status") == "finished"] + new_rounds
        else:
            rounds = existing_rounds
        rounds = _finalize_rounds(rounds)

        names = set(existing_display_names.get((league_name, canonical), set()))
        names.update(resolved_display_names.get((league_name, canonical), set()))
        display_name = sorted(names or {canonical}, key=_display_name_sort_key)[0]
        merged_from = sorted(
            (existing_sources.get((league_name, canonical), set()) | names) - {display_name},
            key=str.casefold,
        )
        ambiguous_matches = list(existing_ambiguous.get((league_name, canonical), []))
        ambiguous_matches.extend(resolved_ambiguous.get((league_name, canonical), []))
        date_resolved_matches = list(existing_date_resolved.get((league_name, canonical), []))
        date_resolved_matches.extend(resolved_date_matches.get((league_name, canonical), []))

        leagues_output[league_name]["subLeagues"][display_name] = {
            "rounds": rounds,
            "leaderboard": aggregate_player_stats(rounds),
            "record": calculate_subleague_record(rounds),
            "diagnostics": _build_subleague_diagnostics(
                rounds,
                merged_from,
                ambiguous_matches,
                date_resolved_matches,
            ),
        }

    return dict(leagues_output)


def repair_existing_subleagues(site_key: str) -> None:
    """One-time migration for historical titles that need API team context."""
    if not os.path.exists(OUTPUT_FILE):
        print(f"No existing league data found at {OUTPUT_FILE}")
        return
    with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
        existing = json.load(f)

    leagues_output = rebuild_leagues_output(existing.get("leagues", {}), {}, {}, {}, repair=True)
    output = {
        "lastUpdated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "clubId": CLUB_ID,
        "leagues": leagues_output,
        "globalLeaderboard": create_global_leaderboard(leagues_output),
    }
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"✓ Repaired and re-keyed historical sub-leagues in {OUTPUT_FILE}")
def backfill_opponent_club_ids(site_key: str) -> None:
    """Scan leagueData.json for rounds missing opponentClubId, fetch those match
    endpoints to fill the gap, then update leagueData.json and clubIcons.json."""
    league_data_file = os.path.join(PROJECT_ROOT, "public", "data", site_key, "leagueData.json")
    club_icons_file  = os.path.join(PROJECT_ROOT, "public", "data", site_key, "clubIcons.json")

    if not os.path.exists(league_data_file):
        print(f"ERROR: leagueData.json not found at {league_data_file}", file=sys.stderr)
        sys.exit(1)

    with open(league_data_file, "r", encoding="utf-8") as f:
        league_data = json.load(f)

    existing_icons: dict = {}
    if os.path.exists(club_icons_file):
        with open(club_icons_file, "r", encoding="utf-8") as f:
            existing_icons = json.load(f)

    # Collect rounds that are missing opponentClubId
    rounds_to_patch = []  # list of (round_dict reference, matchUrl)
    for league in league_data.get("leagues", {}).values():
        for sub in league.get("subLeagues", {}).values():
            for round_data in sub.get("rounds", []):
                if not round_data.get("opponentClubId"):
                    match_url = round_data.get("matchUrl") or round_data.get("matchId")
                    if match_url:
                        rounds_to_patch.append((round_data, match_url))

    if not rounds_to_patch:
        print("All rounds already have opponentClubId — nothing to backfill.")
        return

    print(f"Backfilling opponentClubId for {len(rounds_to_patch)} round(s)...")
    new_icons = dict(existing_icons)
    patched = 0
    failed  = 0

    for i, (round_data, match_url) in enumerate(rounds_to_patch, 1):
        print(f"  [{i}/{len(rounds_to_patch)}] {match_url}")
        match_json = fetch_json(match_url)
        if not match_json:
            print(f"    ✗ Could not fetch match")
            failed += 1
            time.sleep(0.3)
            continue

        teams = match_json.get("teams", {})
        opponent_club_id = None
        for team_data in teams.values():
            if isinstance(team_data, dict):
                team_id_url = team_data.get("@id", "")
                if "/club/" in team_id_url and CLUB_ID not in team_id_url:
                    opponent_club_id = team_id_url.rstrip("/").split("/club/")[-1]
                    break

        if opponent_club_id:
            round_data["opponentClubId"] = opponent_club_id
            patched += 1
            print(f"    ✓ opponentClubId = {opponent_club_id}")

            # Fetch icon if not already known
            if opponent_club_id not in new_icons:
                club_info = fetch_json(f"https://api.chess.com/pub/club/{opponent_club_id}")
                if club_info:
                    new_icons[opponent_club_id] = {
                        "name": club_info.get("name", opponent_club_id),
                        "icon": club_info.get("icon", "")
                    }
                    print(f"    ✓ icon fetched for {opponent_club_id}")
                else:
                    new_icons[opponent_club_id] = {"name": opponent_club_id, "icon": ""}
                    print(f"    ✗ could not fetch icon for {opponent_club_id}")
                time.sleep(0.3)
        else:
            print(f"    ✗ Could not determine opponent club from match data")
            failed += 1

        time.sleep(0.3)

    # Write patched leagueData.json
    with open(league_data_file, "w", encoding="utf-8") as f:
        json.dump(league_data, f, indent=2, ensure_ascii=False)
    print(f"\n✓ leagueData.json updated ({patched} round(s) patched, {failed} failed)")

    # Write updated clubIcons.json
    with open(club_icons_file, "w", encoding="utf-8") as f:
        json.dump(new_icons, f, indent=2, ensure_ascii=False)
    print(f"✓ clubIcons.json updated ({len(new_icons)} clubs total)")


def main():
    """Main execution function."""
    parser = argparse.ArgumentParser(
        description="Fetch chess league data from Chess.com"
    )
    parser.add_argument(
        "--site-key", required=True,
        help="Site key matching a directory under config/ (e.g. '1dpmc', 'teamusa')",
    )

    # ── Developer / maintenance tools ─────────────────────────────────────────
    # These flags are NOT used by the nightly CI/CD pipeline.
    # Run them locally when needed to fix or backfill data.
    dev_group = parser.add_argument_group(
        "developer / maintenance tools (local use only, not for nightly builds)"
    )
    dev_group.add_argument(
        "--backfill-icons",
        action="store_true",
        help=(
            "Scan existing leagueData.json for rounds that are missing "
            "'opponentClubId', fetch each match endpoint to fill the gap, "
            "and update clubIcons.json. Run once after upgrading from a version "
            "that did not record opponent club IDs. Do NOT include in nightly jobs."
        ),
    )
    dev_group.add_argument(
        "--repair-subleagues",
        action="store_true",
        help=(
            "Re-key historical rounds using Chess.com team names, merge safe "
            "season/case/punctuation variants, and write the repaired league data."
        ),
    )
    args = parser.parse_args()

    load_config(args.site_key)

    if args.backfill_icons:
        print(f"=== Backfill mode: {args.site_key} ===")
        backfill_opponent_club_ids(args.site_key)
        return

    if args.repair_subleagues:
        print(f"=== Sub-league repair mode: {args.site_key} ===")
        repair_existing_subleagues(args.site_key)
        return

    print(f"Fetching matches for club: {CLUB_ID} (site: {args.site_key})")

    # Load registration history cache once before processing.
    reg_history_cache = load_registration_history_cache()
    run_timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    # Load existing match IDs to skip
    existing_match_ids = load_existing_match_ids()
    print(f"Loaded {len(existing_match_ids)} existing match IDs to skip")
    
    # Fetch all club matches
    club_data = fetch_json(CLUB_MATCHES_URL)
    if not club_data:
        print("Failed to fetch club matches", file=sys.stderr)
        sys.exit(1)
    
    # Collect match objects from all categories, tracking their status
    all_match_objects = []
    
    if "finished" in club_data:
        for match in club_data["finished"]:
            match["_api_status"] = "finished"
            all_match_objects.append(match)
    
    if "in_progress" in club_data:
        for match in club_data["in_progress"]:
            match["_api_status"] = "in_progress"
            all_match_objects.append(match)
    
    if "registered" in club_data:
        for match in club_data["registered"]:
            match["_api_status"] = "open"  # Map 'registered' to 'open' for our system
            all_match_objects.append(match)
    
    print(f"Found {len(all_match_objects)} total matches")
    
    # Filter and parse league matches
    league_matches = []
    skipped_existing = 0
    for match_obj in all_match_objects:
        # Extract match ID/URL from the object
        # The "@id" field contains the API URL
        match_url = match_obj.get("@id")
        if not match_url:
            continue
        
        # Skip finished matches that we already have
        if match_url in existing_match_ids:
            skipped_existing += 1
            continue
        
        # The "name" field contains the match title
        title = match_obj.get("name", "")
        parsed = parse_match_title(title)
        
        if parsed:
            league_matches.append({
                "url": match_url,
                "parsed": parsed,
                "title": title,
                "status": match_obj.get("_api_status", "open")
            })
            try:
                print(f"  Found league match: {title}")
            except UnicodeEncodeError:
                print(f"  Found league match: [encoding issue in title]")
    
    print(f"\nSkipped {skipped_existing} already-processed finished matches")
    print(f"Note: In-progress and open matches are always re-fetched for updates")
    league_names = [cfg["name"] for cfg in LEAGUE_CONFIG]
    print(f"Found {len(league_matches)} new league matches for leagues {league_names}")

    if len(league_matches) == 0:
        print("\nWARNING: No league matches found!")
        print("This could mean:")
        print("  1. The club has no matches with the specified prefixes")
        print("  2. Match titles don't contain known league identifiers: " + ", ".join(cfg["name"] for cfg in LEAGUE_CONFIG))
        print("\nPlease check the club's match titles on chess.com")
    
    # Organize matches by league and sub-league
    organized_data = defaultdict(list)
    organized_display_names = defaultdict(set)
    organized_ambiguous = defaultdict(list)
    
    print(f"\nProcessing {len(league_matches)} matches...")
    for i, match_info in enumerate(league_matches, 1):
        try:
            print(f"\n[{i}/{len(league_matches)}] Processing: {match_info['title']}")
        except UnicodeEncodeError:
            print(f"\n[{i}/{len(league_matches)}] Processing: [encoding issue in title]")
        # Process the match
        try:
            match_data = process_match(match_info["url"], match_info["parsed"], match_info["status"])
            if match_data:
                parsed = match_data.pop("_parsedTitle", None) or match_info["parsed"]
                league = parsed.get("league") or match_info["parsed"].get("league")
                sub_league = parsed.get("subLeague") or "Unresolved Subleague"
                canonical = parsed.get("canonicalSubLeague") or canonical_subleague_key(sub_league)
                group_key = (league, canonical)

                # ── Registration history ───────────────────────────────────────
                if match_info["status"] == "open":
                    reg_data = match_data.get("registrationData")
                    if reg_data and reg_data.get("type") == "roster":
                        history = update_registration_history(
                            reg_history_cache,
                            match_info["url"],
                            reg_data.get("ourRoster", []),
                            reg_data.get("oppRoster", []),
                            run_timestamp,
                        )
                        match_data["registrationHistory"] = history
                elif match_info["status"] == "in_progress":
                    # Attach existing history read-only; no new diffs once boards are set.
                    cached_entry = reg_history_cache["matches"].get(match_info["url"])
                    if cached_entry:
                        match_data["registrationHistory"] = cached_entry["history"]
                # ──────────────────────────────────────────────────────────────
                organized_data[group_key].append(match_data)
                organized_display_names[group_key].add(sub_league)
                if parsed.get("confidence") != "high" or sub_league == "__unresolved__":
                    organized_ambiguous[group_key].append({
                        "matchId": match_data.get("matchId"),
                        "name": match_data.get("name", ""),
                        "reason": "team context did not produce a high-confidence competition label",
                    })
                print(f"  ✓ Collected stats for {len(match_data['playerStats'])} players")
            else:
                print(f"  ✗ Failed to process match")
        except Exception as e:
            print(f"  ✗ Error processing match: {e}")
        
        # Be nice to the API
        time.sleep(0.5)
    
    # ── Prune stale registration history cache entries ────────────────────────
    # Keep only matches that are still open or in_progress this run.
    active_match_urls = {
        m["url"] for m in league_matches if m["status"] in ("open", "in_progress")
    }
    stale_keys = [k for k in reg_history_cache["matches"] if k not in active_match_urls]
    for k in stale_keys:
        del reg_history_cache["matches"][k]
    if stale_keys:
        print(f"Pruned {len(stale_keys)} stale registration history cache entry(ies)")
    save_registration_history_cache(reg_history_cache)
    # ───────────────────────────────────────────────────────────────────────────

    # Build final data structure
    print("\nBuilding final data structure...")

    # Load existing data to merge with new data
    existing_data = {}
    if os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
                existing_data = json.load(f).get("leagues", {})
        except Exception as e:
            print(f"Warning: Could not load existing data for merging: {e}")
    
    leagues_output = rebuild_leagues_output(
        existing_data,
        organized_data,
        organized_display_names,
        organized_ambiguous,
        repair=False,
    )
    
    # Create global leaderboard
    global_leaderboard = create_global_leaderboard(leagues_output)
    
    # Final output structure
    output = {
        "lastUpdated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "clubId": CLUB_ID,
        "leagues": leagues_output,
        "globalLeaderboard": global_leaderboard
    }
    
    # Ensure output directory exists
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    
    # Write JSON file
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    # ── Build clubIcons.json ────────────────────────────────────────────────────
    # Collect all unique opponent club IDs referenced across all rounds.
    opponent_club_ids: set = set()
    for league_data in leagues_output.values():
        for sub_data in league_data.get("subLeagues", {}).values():
            for round_data in sub_data.get("rounds", []):
                cid = round_data.get("opponentClubId")
                if cid:
                    opponent_club_ids.add(cid)

    # Load existing icons so we don't re-fetch clubs we already have.
    club_icons_file = os.path.join(PROJECT_ROOT, "public", "data", args.site_key, "clubIcons.json")
    existing_icons: dict = {}
    if os.path.exists(club_icons_file):
        try:
            with open(club_icons_file, "r", encoding="utf-8") as f:
                existing_icons = json.load(f)
        except Exception:
            existing_icons = {}

    new_icons = dict(existing_icons)
    clubs_to_fetch = [cid for cid in opponent_club_ids if cid not in new_icons]
    print(f"\nFetching club icon data for {len(clubs_to_fetch)} new club(s) "
          f"({len(opponent_club_ids) - len(clubs_to_fetch)} already cached)...")

    for cid in clubs_to_fetch:
        club_api_url = f"https://api.chess.com/pub/club/{cid}"
        club_info = fetch_json(club_api_url)
        if club_info:
            new_icons[cid] = {
                "name": club_info.get("name", cid),
                "icon": club_info.get("icon", "")
            }
            print(f"  ✓ {cid}: {new_icons[cid]['name']}")
        else:
            new_icons[cid] = {"name": cid, "icon": ""}
            print(f"  ✗ Could not fetch club info for: {cid}")
        time.sleep(0.3)

    with open(club_icons_file, "w", encoding="utf-8") as f:
        json.dump(new_icons, f, indent=2, ensure_ascii=False)
    print(f"✓ Club icons written to {club_icons_file} ({len(new_icons)} clubs)")

    print(f"\n{'='*60}")
    print(f"✓ Data successfully written to {OUTPUT_FILE}")
    print(f"{'='*60}")
    print(f"Summary:")
    print(f"  • Total leagues: {len(leagues_output)}")
    print(f"  • Total sub-leagues: {sum(len(l['subLeagues']) for l in leagues_output.values())}")
    print(f"  • Total rounds: {sum(len(sl['rounds']) for l in leagues_output.values() for sl in l['subLeagues'].values())}")
    print(f"  • Global leaderboard players: {len(global_leaderboard)}")
    
    if len(leagues_output) > 0:
        print(f"\nLeagues found:")
        for league_name, league_data in leagues_output.items():
            print(f"  • {league_name}: {len(league_data['subLeagues'])} sub-league(s)")
            for sub_name, sub_data in league_data['subLeagues'].items():
                print(f"    - {sub_name}: {len(sub_data['rounds'])} round(s), {len(sub_data['leaderboard'])} player(s)")
    
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
