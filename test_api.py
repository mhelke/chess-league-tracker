#!/usr/bin/env python3
"""
Simple test script to check the chess.com API
"""

import json
from urllib.request import urlopen, Request

CLUB_ID = "1-day-per-move-club"
CLUB_MATCHES_URL = f"https://api.chess.com/pub/club/{CLUB_ID}/matches"
USER_AGENT = "ChessLeagueTracker/1.0"

def fetch_json(url):
    req = Request(url, headers={'User-Agent': USER_AGENT})
    with urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode('utf-8'))

print(f"Fetching club matches from: {CLUB_MATCHES_URL}\n")
club_data = fetch_json(CLUB_MATCHES_URL)

print(f"Keys in response: {list(club_data.keys())}")
print(f"\nFinished matches: {len(club_data.get('finished', []))}")
print(f"In progress matches: {len(club_data.get('in_progress', []))}")
print(f"Registered matches: {len(club_data.get('registered', []))}\n")

# Print first finished match
if club_data.get('finished'):
    first_match = club_data['finished'][0]
    print(f"First finished match structure:")
    print(f"  Name: {first_match.get('name')}")
    print(f"  @id: {first_match.get('@id')}")
    print(f"  Keys: {list(first_match.keys())}\n")
    
    # Fetch details of first match
    match_url = first_match.get('@id')
    if match_url:
        print(f"Fetching match details from: {match_url}\n")
        match_data = fetch_json(match_url)
        print(f"Match detail keys: {list(match_data.keys())}")
        print(f"  Status: {match_data.get('status')}")
        print(f"  Boards: {match_data.get('boards')}")
        print(f"  Start time: {match_data.get('start_time')}")
        print(f"  End time: {match_data.get('end_time')}")
        
        # Try fetching first board
        if match_data.get('boards', 0) > 0:
            board_url = f"{match_url}/1"
            print(f"\nFetching board 1 from: {board_url}\n")
            board_data = fetch_json(board_url)
            print(f"Board keys: {list(board_data.keys())}")
            games = board_data.get('games', [])
            print(f"Number of games on board: {len(games)}")
            if games:
                game = games[0]
                print(f"First game keys: {list(game.keys())}")
                print(f"  White: {game.get('white', {}).get('username')}")
                print(f"  Black: {game.get('black', {}).get('username')}")
                print(f"  White result: {game.get('white', {}).get('result')}")
                print(f"  Black result: {game.get('black', {}).get('result')}")
