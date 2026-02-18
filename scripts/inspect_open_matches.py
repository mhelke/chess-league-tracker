import json

with open('../public/data/leagueData.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

open_matches = []
for lname, league in data['leagues'].items():
    for sname, sub in league['subLeagues'].items():
        for r in sub['rounds']:
            if r.get('status') == 'open':
                open_matches.append({
                    'league': lname,
                    'subLeague': sname,
                    'round': r.get('round'),
                    'name': r.get('name'),
                    'hasBoardsData': 'boardsData' in r,
                    'hasRegistrationData': 'registrationData' in r,
                    'boardsCount': len(r.get('boardsData', [])),
                    'registeredPlayers': r.get('registeredPlayers'),
                    'rosterCount': len(r.get('registrationData', {}).get('ourRoster', [])) if 'registrationData' in r else 0
                })

print(f"Found {len(open_matches)} open (registered) matches")
print("\nFirst 5 matches:")
for i, match in enumerate(open_matches[:5], 1):
    print(f"\n{i}. {match['league']} / {match['subLeague']}")
    print(f"   Round: {match['round']}")
    print(f"   Has board data: {match['hasBoardsData']}")
    print(f"   Has registration data: {match['hasRegistrationData']}")
    print(f"   Boards with ratings: {match['boardsCount']}")
    print(f"   Registered players: {match['registeredPlayers']}")
    print(f"   Our roster size: {match['rosterCount']}")
