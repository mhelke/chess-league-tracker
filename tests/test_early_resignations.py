import sys
import unittest

sys.path.insert(0, "scripts")

from detect_early_resignations import backfill_detected_at, insert_result


class EarlyResignationTrackingTests(unittest.TestCase):
    def test_backfill_prefers_match_start_and_preserves_existing_timestamp(self):
        results = {
            "leagues": {
                "League": {
                    "subLeagues": {
                        "Division": {
                            "matches": [{
                                "matchUrl": "start-match",
                                "players": [{"username": "alice"}, {"username": "bob", "detectedAt": "existing"}],
                            }, {
                                "matchUrl": "end-match",
                                "players": [{"username": "carol"}],
                            }],
                        },
                    },
                },
            },
        }
        league_data = {
            "leagues": {
                "League": {
                    "subLeagues": {
                        "Division": {
                            "rounds": [{
                                "matchUrl": "start-match",
                                "startTime": 100,
                                "endTime": 200,
                            }, {
                                "matchUrl": "end-match",
                                "endTime": 300,
                            }],
                        },
                    },
                },
            },
        }

        backfill_detected_at(results, league_data)

        players = results["leagues"]["League"]["subLeagues"]["Division"]["matches"]
        self.assertEqual(players[0]["players"][0]["detectedAt"], "1970-01-01T00:01:40Z")
        self.assertEqual(players[0]["players"][1]["detectedAt"], "existing")
        self.assertEqual(players[1]["players"][0]["detectedAt"], "1970-01-01T00:05:00Z")

    def test_new_timestamp_is_preserved_and_duplicate_game_is_not_added(self):
        results = {}
        first = {
            "username": "alice",
            "color": "white",
            "game_api": "game-1",
            "detectedAt": "2026-09-29T23:00:00Z",
        }
        duplicate = {**first, "detectedAt": "2026-09-30T00:00:00Z"}

        insert_result(results, "League", "Division", "match-1", {"matchUrl": "match-1"}, first)
        insert_result(results, "League", "Division", "match-1", {"matchUrl": "match-1"}, duplicate)

        players = results["leagues"]["League"]["subLeagues"]["Division"]["matches"][0]["players"]
        self.assertEqual(len(players), 1)
        self.assertEqual(players[0]["detectedAt"], "2026-09-29T23:00:00Z")


if __name__ == "__main__":
    unittest.main()
