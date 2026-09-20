import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, "scripts")

import fetch_league_data as fetcher


class SubLeagueDetectionTests(unittest.TestCase):
    def test_timeout_history_baselines_then_records_only_count_increases(self):
        def leagues(alpha_timeouts, beta_timeouts, second_match_timeouts):
            return {
                "League": {"subLeagues": {"Division": {"rounds": [
                    {
                        "status": "in_progress",
                        "matchUrl": "https://api.chess.com/pub/match/alpha",
                        "playerStats": {
                            "Player": {"timeouts": alpha_timeouts},
                            "Beta": {"timeouts": beta_timeouts},
                        },
                    },
                    {
                        "status": "finished",
                        "matchUrl": "https://api.chess.com/pub/match/second",
                        "playerStats": {"Player": {"timeouts": second_match_timeouts}},
                    },
                ]}}}
            }

        original_path = fetcher.TIMEOUT_HISTORY_FILE
        with tempfile.TemporaryDirectory() as directory:
            fetcher.TIMEOUT_HISTORY_FILE = f"{directory}/timeout_history.json"
            try:
                baseline = fetcher.update_timeout_history(leagues(1, 0, 1), "2026-09-01T00:00:00Z")
                self.assertEqual(baseline["events"], [])
                fetcher.save_timeout_history(baseline)

                increased = fetcher.update_timeout_history(leagues(3, 1, 2), "2026-09-02T00:00:00Z")
                self.assertEqual(
                    {(event["matchUrl"], event["username"], event["ordinal"]) for event in increased["events"]},
                    {
                        ("https://api.chess.com/pub/match/alpha", "player", 2),
                        ("https://api.chess.com/pub/match/alpha", "player", 3),
                        ("https://api.chess.com/pub/match/alpha", "beta", 1),
                        ("https://api.chess.com/pub/match/second", "player", 2),
                    },
                )
                fetcher.save_timeout_history(increased)

                repeated = fetcher.update_timeout_history(leagues(3, 1, 2), "2026-09-03T00:00:00Z")
                self.assertEqual(len(repeated["events"]), 4)
                fetcher.save_timeout_history(repeated)

                corrected = fetcher.update_timeout_history(leagues(1, 0, 1), "2026-09-04T00:00:00Z")
                self.assertEqual(len(corrected["events"]), 4)
                fetcher.save_timeout_history(corrected)

                increased_again = fetcher.update_timeout_history(leagues(4, 0, 1), "2026-09-05T00:00:00Z")
                self.assertEqual(len(increased_again["events"]), 5)
                self.assertEqual(increased_again["events"][-1]["ordinal"], 4)
                self.assertEqual(increased_again["events"][-1]["detectedAt"], "2026-09-05T00:00:00Z")
            finally:
                fetcher.TIMEOUT_HISTORY_FILE = original_path

    def test_equivalent_season_spans_share_one_key(self):
        fetcher.load_config("1dpmc")
        keys = {
            fetcher.canonical_subleague_key(label)
            for label in (
                "2025/26 Classic Open B G2",
                "2025/2026 Classic Open B G2",
                "2025-26 Classic Open B G2",
                "2025-2026 Classic Open B G2",
            )
        }
        self.assertEqual(len(keys), 1)

    def test_playoff_formatting_is_harmless(self):
        fetcher.load_config("1dpmc")
        self.assertEqual(
            fetcher.canonical_subleague_key("DECANUS 2024 - 2025 Play-Offs"),
            fetcher.canonical_subleague_key("DECANUS 2024-2025 Playoffs"),
        )
        self.assertEqual(
            fetcher.canonical_subleague_key("2026 Classic Classic U1700"),
            fetcher.canonical_subleague_key("2026 Classic U1700"),
        )

    def test_seasons_groups_and_stages_remain_distinct(self):
        fetcher.load_config("1dpmc")
        self.assertNotEqual(
            fetcher.canonical_subleague_key("2025/26 Classic Open B G1"),
            fetcher.canonical_subleague_key("2025/26 Classic Open B G2"),
        )
        self.assertNotEqual(
            fetcher.canonical_subleague_key("2025/26 Classic Open B G2"),
            fetcher.canonical_subleague_key("2026/27 Classic Open B G2"),
        )
        self.assertNotEqual(
            fetcher.canonical_subleague_key("2025/26 Classic Open B G2 Playoffs"),
            fetcher.canonical_subleague_key("2025/26 Classic Open B G2"),
        )
        self.assertEqual(
            fetcher._structural_score("PHOENIX 2024 PLAYOFF P3", "PHOENIX 2024 PLAYOFF P4"),
            0.0,
        )

    def test_classic_open_b_titles_merge_without_fuzzy_guessing(self):
        fetcher.load_config("1dpmc")
        self.assertEqual(
            fetcher.parse_match_title("1WL 2025/26 960 Classic Open B G2 R1")['canonicalSubLeague'],
            fetcher.parse_match_title("1WL 2025/2026 960 Classic Open B G2 R4")['canonicalSubLeague'],
        )

    def test_schedule_score_prefers_monthly_date_window(self):
        fetcher.load_config("teamusa")
        def stamp(day):
            return int((datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(days=day - 1)).timestamp())

        candidate = [
            {"startTime": stamp(1)},
            {"startTime": stamp(29)},
            {"startTime": stamp(57)},
        ]
        self.assertGreater(
            fetcher._schedule_score(candidate, {"startTime": stamp(85)}),
            fetcher._schedule_score(candidate, {"startTime": stamp(15)}),
        )

    def test_date_tie_break_selects_structurally_compatible_candidate(self):
        fetcher.load_config("teamusa")
        def stamp(month):
            return int(datetime(2026, month, 1, tzinfo=timezone.utc).timestamp())

        def round_data(match_id, title, start_time):
            return {
                "round": "R1",
                "status": "finished",
                "matchId": match_id,
                "startTime": start_time,
                "name": title,
                "playerStats": {},
                "matchResult": {"result": "win"},
            }

        existing = {
            "WL": {
                "subLeagues": {
                    "2025 Open Group": {"rounds": [
                        round_data("a1", "WL2025 Open Group R1: A vs B", stamp(1)),
                        round_data("a2", "WL2025 Open Group R2: A vs B", stamp(2)),
                        round_data("a3", "WL2025 Open Group R3: A vs B", stamp(3)),
                    ]},
                    "2026 Open Group": {"rounds": [
                        round_data("b1", "WL2026 Open Group R1: A vs B", stamp(7)),
                        round_data("b2", "WL2026 Open Group R2: A vs B", stamp(8)),
                        round_data("b3", "WL2026 Open Group R3: A vs B", stamp(9)),
                    ]},
                }
            }
        }
        incoming_key = ("WL", fetcher.canonical_subleague_key("Open Group"))
        output = fetcher.rebuild_leagues_output(
            existing,
            {incoming_key: [round_data("new", "WL Open Group R4: A vs B", stamp(4))]},
            {incoming_key: {"Open Group"}},
            {},
        )

        selected = next(
            subleague for subleague in output["WL"]["subLeagues"].values()
            if "new" in {round_data["matchId"] for round_data in subleague["rounds"]}
        )
        self.assertIn("new", {round_data["matchId"] for round_data in selected["rounds"]})
        self.assertEqual(len(selected["diagnostics"]["dateResolvedMatches"]), 1)
        self.assertEqual(
            sum(
                "new" in {round_data["matchId"] for round_data in subleague["rounds"]}
                for subleague in output["WL"]["subLeagues"].values()
            ),
            1,
        )

    def test_existing_trailing_letter_alias_merges_when_schedule_continues(self):
        fetcher.load_config("teamusa")
        def stamp(day):
            return int((datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(days=day - 1)).timestamp())

        def round_data(match_id, round_name, title, start_time):
            return {
                "round": round_name,
                "status": "finished",
                "matchId": match_id,
                "startTime": start_time,
                "name": title,
                "playerStats": {},
                "matchResult": {"result": "win"},
            }

        alias_rounds = [
            round_data(f"a{index}", f"R{index}", f"WL2026 Classic U1700 A R{index}: A vs B", stamp(day))
            for index, day in enumerate((1, 29, 57, 92, 120), start=1)
        ]
        base_rounds = [
            round_data("b6", "R6", "WL2026 Classic U1700 R6: A vs B", stamp(155)),
            round_data("b7", "R7", "WL2026 Classic U1700 R7: A vs B", stamp(183)),
        ]
        output = fetcher.rebuild_leagues_output(
            {"WL": {"subLeagues": {
                "2026 Classic U1700 A": {"rounds": alias_rounds},
                "2026 Classic U1700": {"rounds": base_rounds},
            }}},
            {},
            {},
            {},
        )

        self.assertEqual(list(output["WL"]["subLeagues"]), ["2026 Classic U1700"])
        merged = output["WL"]["subLeagues"]["2026 Classic U1700"]
        self.assertEqual([round_data["round"] for round_data in merged["rounds"]], ["R1", "R2", "R3", "R4", "R5", "R6", "R7"])
        self.assertEqual(len(merged["diagnostics"]["dateResolvedMatches"]), 5)

    def test_trailing_letter_alias_chain_merges_around_missing_round(self):
        fetcher.load_config("teamusa")

        def stamp(day):
            return int((datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(days=day - 1)).timestamp())

        def round_data(match_id, round_name, title, start_time):
            return {
                "round": round_name,
                "status": "finished",
                "matchId": match_id,
                "startTime": start_time,
                "name": title,
                "playerStats": {},
                "matchResult": {"result": "win"},
            }

        existing = {"WL": {"subLeagues": {
            "2026 Classic U1300 A": {"rounds": [
                round_data(f"a{index}", f"R{index}", f"WL2026 Classic U1300 A R{index}: A vs B", stamp(day))
                for index, day in enumerate((1, 29, 57, 92, 120), start=1)
            ]},
            "2026 Classic U1300": {"rounds": [
                round_data("base6", "R6", "WL2026 Classic U1300 R6: A vs B", stamp(155)),
                round_data("base9", "R9", "WL2026 Classic U1300 R9: A vs B", stamp(246)),
            ]},
            "2026 Classic U1300 B": {"rounds": [
                round_data("b8", "R8", "WL2026 Classic U1300 B R8: A vs B", stamp(211)),
            ]},
        }}}

        output = fetcher.rebuild_leagues_output(existing, {}, {}, {})
        subleagues = output["WL"]["subLeagues"]
        self.assertEqual(list(subleagues), ["2026 Classic U1300"])
        merged = subleagues["2026 Classic U1300"]
        self.assertEqual(
            [round_data["round"] for round_data in merged["rounds"]],
            ["R1", "R2", "R3", "R4", "R5", "R6", "R8", "R9"],
        )
        self.assertEqual(
            merged["diagnostics"]["observedRounds"],
            ["R1", "R2", "R3", "R4", "R5", "R6", "R8", "R9"],
        )
        self.assertNotIn("missingRounds", merged["diagnostics"])
        self.assertEqual(
            {item["matchId"] for item in merged["diagnostics"]["dateResolvedMatches"]},
            {"a1", "a2", "a3", "a4", "a5", "b8"},
        )

    def test_one_round_group_fills_gap_and_uses_larger_display_name(self):
        fetcher.load_config("teamusa")

        def stamp(day):
            return int((datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(days=day - 1)).timestamp())

        def make_round(match_id, round_name, title, day):
            return {
                "round": round_name,
                "status": "finished",
                "matchId": match_id,
                "startTime": stamp(day),
                "name": title,
                "playerStats": {},
                "matchResult": {"result": "win"},
            }

        larger_rounds = [
            make_round(f"g2-{number}", f"R{number}", f"WL2026 U1800 20 G2 R{number}: A vs B", day)
            for number, day in ((1, 1), (2, 29), (3, 57), (5, 113), (6, 141), (7, 169))
        ]
        orphan_round = make_round("g1-4", "R4", "WL2026 U1800 20 G1 R4: A vs B", 85)
        output = fetcher.rebuild_leagues_output(
            {"WL": {"subLeagues": {
                "2026 U1800 20 G1": {"rounds": [orphan_round]},
                "2026 U1800 20 G2": {"rounds": larger_rounds},
            }}},
            {},
            {},
            {},
        )

        self.assertEqual(list(output["WL"]["subLeagues"]), ["2026 U1800 20 G2"])
        merged = output["WL"]["subLeagues"]["2026 U1800 20 G2"]
        self.assertEqual([round_data["round"] for round_data in merged["rounds"]], ["R1", "R2", "R3", "R4", "R5", "R6", "R7"])
        self.assertEqual(merged["diagnostics"]["mergedFrom"], ["2026 U1800 20 G1"])
        self.assertEqual(
            merged["diagnostics"]["dateResolvedMatches"][0]["reason"],
            "schedule evidence merged a one-round group alias into the larger sub-league",
        )

    def test_future_one_round_group_is_resolved_into_existing_larger_group(self):
        fetcher.load_config("teamusa")

        def stamp(day):
            return int((datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(days=day - 1)).timestamp())

        def make_round(match_id, round_name, title, day):
            return {
                "round": round_name,
                "status": "finished",
                "matchId": match_id,
                "startTime": stamp(day),
                "name": title,
                "playerStats": {},
                "matchResult": {"result": "win"},
            }

        existing = [
            make_round(f"g2-{number}", f"R{number}", f"WL2026 U1800 20 G2 R{number}: A vs B", day)
            for number, day in ((1, 1), (2, 29), (3, 57), (5, 113), (6, 141), (7, 169))
        ]
        incoming = make_round("g1-4", "R4", "WL2026 U1800 20 G1 R4: A vs B", 85)
        key = ("WL", fetcher.canonical_subleague_key("2026 U1800 20 G1"))
        output = fetcher.rebuild_leagues_output(
            {"WL": {"subLeagues": {"2026 U1800 20 G2": {"rounds": existing}}}},
            {key: [incoming]},
            {key: {"2026 U1800 20 G1"}},
            {},
        )

        self.assertEqual(list(output["WL"]["subLeagues"]), ["2026 U1800 20 G2"])
        self.assertEqual(
            [round_data["matchId"] for round_data in output["WL"]["subLeagues"]["2026 U1800 20 G2"]["rounds"]],
            ["g2-1", "g2-2", "g2-3", "g1-4", "g2-5", "g2-6", "g2-7"],
        )

    def test_existing_trailing_letter_alias_does_not_merge_overlapping_schedule(self):
        fetcher.load_config("teamusa")
        def make_round(match_id, title, start_time):
            return {
                "round": "R1",
                "status": "finished",
                "matchId": match_id,
                "startTime": start_time,
                "name": title,
                "playerStats": {},
                "matchResult": {"result": "win"},
            }

        existing = {"WL": {"subLeagues": {
            "2026 Classic U1700": {"rounds": [make_round("base", "WL2026 Classic U1700 R1: A vs B", 100)]},
            "2026 Classic U1700 A": {"rounds": [make_round("alias", "WL2026 Classic U1700 A R1: A vs B", 100)]},
        }}}
        output = fetcher.rebuild_leagues_output(existing, {}, {}, {})
        self.assertEqual(len(output["WL"]["subLeagues"]), 2)

    def test_existing_trailing_letter_alias_merges_sparse_sequential_rounds(self):
        fetcher.load_config("teamusa")

        def stamp(day):
            return int((datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(days=day - 1)).timestamp())

        def make_round(match_id, round_name, title, start_time):
            return {
                "round": round_name,
                "status": "finished",
                "matchId": match_id,
                "startTime": start_time,
                "name": title,
                "playerStats": {},
                "matchResult": {"result": "win"},
            }

        existing = {"WL": {"subLeagues": {
            "2026 Classic U1500": {"rounds": [
                make_round("base-r1", "R1", "WL2026 Classic U1500 R1: A vs B", stamp(180)),
            ]},
            "2026 Classic U1500 B": {"rounds": [
                make_round("alias-r2", "R2", "WL2026 Classic U1500 B R2: A vs B", stamp(208)),
            ]},
        }}}

        output = fetcher.rebuild_leagues_output(existing, {}, {}, {})
        self.assertEqual(list(output["WL"]["subLeagues"]), ["2026 Classic U1500"])
        merged = output["WL"]["subLeagues"]["2026 Classic U1500"]
        self.assertEqual([r["round"] for r in merged["rounds"]], ["R1", "R2"])
        self.assertEqual(
            [item["matchId"] for item in merged["diagnostics"]["dateResolvedMatches"]],
            ["alias-r2"],
        )

    def test_cadence_alone_cannot_merge_unrelated_label(self):
        fetcher.load_config("teamusa")
        existing = {
            "WL": {
                "subLeagues": {
                    "2025 Open Group": {"rounds": [{
                        "round": "R1", "status": "finished", "matchId": "old",
                        "startTime": 100, "name": "WL2025 Open Group R1: A vs B",
                        "playerStats": {}, "matchResult": {"result": "win"},
                    }]}
                }
            }
        }
        incoming_key = ("WL", fetcher.canonical_subleague_key("Unrelated Division"))
        output = fetcher.rebuild_leagues_output(
            existing,
            {incoming_key: [{
                "round": "R2", "status": "finished", "matchId": "new",
                "startTime": 101, "name": "WL Unrelated Division R2: A vs B",
                "playerStats": {}, "matchResult": {"result": "win"},
            }]},
            {incoming_key: {"Unrelated Division"}},
            {},
        )
        self.assertIn("Unrelated Division", output["WL"]["subLeagues"])
        self.assertNotIn("new", {
            round_data["matchId"]
            for round_data in output["WL"]["subLeagues"]["2025 Open Group"]["rounds"]
        })

    def test_ambiguous_candidates_are_reported_concisely_and_kept_separate(self):
        fetcher.load_config("teamusa")
        def existing_round(match_id, title):
            return {
                "round": "R1", "status": "finished", "matchId": match_id,
                "startTime": 100, "name": title, "playerStats": {},
                "matchResult": {"result": "win"},
            }

        existing = {"WL": {"subLeagues": {
            "2025 Open Group": {"rounds": [existing_round("a", "WL2025 Open Group R1: A vs B")]},
            "2026 Open Group": {"rounds": [existing_round("b", "WL2026 Open Group R1: A vs B")]},
        }}}
        incoming_key = ("WL", fetcher.canonical_subleague_key("Open Group"))
        output = fetcher.rebuild_leagues_output(
            existing,
            {incoming_key: [existing_round("new", "WL Open Group R2: A vs B")]},
            {incoming_key: {"Open Group"}},
            {},
        )

        diagnostics = output["WL"]["subLeagues"]["Open Group"]["diagnostics"]
        self.assertEqual(len(diagnostics["ambiguousMatches"]), 1)
        self.assertNotIn("candidates", diagnostics["ambiguousMatches"][0])
        self.assertIn("clear score margin", diagnostics["ambiguousMatches"][0]["reason"])
        self.assertIn("new", {
            round_data["matchId"]
            for round_data in output["WL"]["subLeagues"]["Open Group"]["rounds"]
        })

    def test_team_first_title_uses_match_team_context(self):
        fetcher.load_config("mn")
        parsed = fetcher.parse_match_title(
            "Team Arizona vs Team Minnesota USTCL 2018, Div 2, Round 9",
            ["Team Arizona", "Team Minnesota"],
        )

        self.assertEqual(parsed["league"], "USTCL")
        self.assertEqual(parsed["subLeague"], "2018 Div 2")
        self.assertEqual(parsed["round"], "R9")
        self.assertEqual(parsed["confidence"], "high")

    def test_year_is_not_dropped_when_resolving_team_first_title(self):
        fetcher.load_config("1dpmc")
        parsed_2025 = fetcher.parse_match_title(
            "1WL 2025 960 Six4Us Winter Masters The Ge-Winner vs 1 day per move club",
            ["The Ge-Winner", "1 day per move club"],
        )
        parsed_2026 = fetcher.parse_match_title(
            "1WL 2026 960 Six4Us Winter Masters The Ge-Winner vs 1 day per move club",
            ["The Ge-Winner", "1 day per move club"],
        )

        self.assertEqual(parsed_2025["subLeague"], "Chess960 2025 Six4Us Winter Masters")
        self.assertEqual(parsed_2026["subLeague"], "Chess960 2026 Six4Us Winter Masters")
        self.assertNotEqual(parsed_2025["canonicalSubLeague"], parsed_2026["canonicalSubLeague"])

    def test_slash_delimited_tmcl_division_uses_standard_identity(self):
        fetcher.load_config("1dpmc")
        parsed = fetcher.parse_match_title(
            "TMCL U1400/2025/D3/ Sahovska sekcija TQM Aradac vs 1 day per move club",
            ["Sahovska sekcija TQM Aradac", "1 day per move club"],
        )

        self.assertEqual(parsed["subLeague"], "U1400 2025 (div D3)")
        self.assertEqual(
            parsed["canonicalSubLeague"],
            fetcher.canonical_subleague_key("U1400 2025 (div D3)"),
        )

    def test_case_and_punctuation_variants_share_key(self):
        fetcher.load_config("teamusa")
        self.assertEqual(
            fetcher.canonical_subleague_key("Chess960 2016,"),
            fetcher.canonical_subleague_key("Chess960 2016"),
        )
        self.assertEqual(
            fetcher.canonical_subleague_key("Classic OPEN A"),
            fetcher.canonical_subleague_key("Classic Open A"),
        )

    def test_group_tokens_are_preserved_when_round_is_present(self):
        fetcher.load_config("1dpmc")
        parsed = fetcher.parse_match_title(
            "1WL 2026 U1800 20 G1 R4: Chess.com Deutsch vs 1 day per move club",
            ["Chess.com Deutsch", "1 day per move club"],
        )

        self.assertEqual(parsed["subLeague"], "2026 U1800 20 G1")
        self.assertEqual(parsed["round"], "R4")

    def test_process_match_groups_using_fetched_team_names(self):
        fetcher.load_config("teamusa")
        original_fetch_json = fetcher.fetch_json
        fetcher.fetch_json = lambda _: {
            "@id": "https://api.chess.com/pub/match/fixture",
            "name": "WL2026 960 Six4Us Winter Masters The Ge-Winner vs Team USA",
            "boards": 0,
            "teams": {
                "team1": {
                    "@id": "https://api.chess.com/pub/club/team-usa",
                    "name": "Team USA",
                    "players": [],
                    "score": 1,
                    "result": "win",
                },
                "team2": {
                    "@id": "https://api.chess.com/pub/club/the-ge-winner",
                    "name": "The Ge-Winner",
                    "players": [],
                    "score": 0,
                    "result": "loss",
                },
            },
            "settings": {},
        }
        try:
            match = fetcher.process_match(
                "https://api.chess.com/pub/match/fixture",
                fetcher.parse_match_title("WL2026 R1: Team USA vs Team Canada"),
                "finished",
            )
        finally:
            fetcher.fetch_json = original_fetch_json

        self.assertEqual(match["_parsedTitle"]["subLeague"], "Chess960 2026 Six4Us Winter Masters")
        self.assertEqual(match["_parsedTitle"]["confidence"], "high")

    def test_historical_repair_persists_context_for_future_rebuilds(self):
        fetcher.load_config("1dpmc")
        match_url = "https://api.chess.com/pub/match/1781452"
        round_data = {
            "round": "NA",
            "status": "finished",
            "matchId": match_url,
            "matchUrl": match_url,
            "name": "TMCL U1400/2025/D3/ Sahovska sekcija TQM Aradac vs 1 day per move club",
            "playerStats": {},
            "matchResult": {"result": "win"},
        }
        payload = {
            "@id": match_url,
            "name": round_data["name"],
            "boards": 7,
            "settings": {"max_rating": 1400, "rules": "chess"},
            "teams": {
                "team1": {
                    "@id": "https://api.chess.com/pub/club/sahovska-sekcija-tqm-aradac",
                    "name": "Sahovska sekcija TQM Aradac",
                },
                "team2": {
                    "@id": "https://api.chess.com/pub/club/1-day-per-move-club",
                    "name": "1 day per move club",
                },
            },
        }

        original_fetch_json = fetcher.fetch_json
        fetcher.fetch_json = lambda _: payload
        try:
            repaired = fetcher._parse_round_with_api_context(
                "TMCL", "Undefined Subleague", round_data
            )
        finally:
            fetcher.fetch_json = original_fetch_json

        self.assertEqual(repaired["subLeague"], "U1400 2025 (div D3)")
        self.assertEqual(len(round_data["teams"]), 2)
        self.assertEqual(round_data["apiMetadata"]["maxRating"], 1400)

        # The next ordinary rebuild must use stored context, not the API.
        reparsed = fetcher._parse_existing_round(
            "TMCL", "U1400 2025 (div D3)", round_data
        )
        self.assertEqual(reparsed["confidence"], "high")
        self.assertEqual(reparsed["subLeague"], "U1400 2025 (div D3)")

    def test_historical_repair_keeps_incomplete_team_context_unresolved(self):
        fetcher.load_config("1dpmc")
        match_url = "https://api.chess.com/pub/match/incomplete"
        round_data = {
            "round": "NA",
            "status": "finished",
            "matchId": match_url,
            "matchUrl": match_url,
            "name": "1WL 2026 Spring Masters Team A vs 1 day per move club",
            "playerStats": {},
            "matchResult": {"result": "unknown"},
        }
        payload = {
            "name": round_data["name"],
            "settings": {},
            "teams": {
                "team1": {
                    "@id": "https://api.chess.com/pub/club/1-day-per-move-club",
                    "name": "1 day per move club",
                },
            },
        }

        original_fetch_json = fetcher.fetch_json
        fetcher.fetch_json = lambda _: payload
        try:
            repaired = fetcher._parse_round_with_api_context(
                "1WL", "Undefined Subleague", round_data
            )
        finally:
            fetcher.fetch_json = original_fetch_json

        self.assertEqual(repaired["confidence"], "low")
        self.assertEqual(repaired["subLeague"], "Undefined Subleague")
        self.assertNotIn("teams", round_data)
        self.assertNotIn("apiMetadata", round_data)

    def test_stored_team_context_repairs_1dpmc_legacy_groupings(self):
        fetcher.load_config("1dpmc")

        def stored_round(match_id, title, round_name, team_names):
            return {
                "round": round_name,
                "status": "finished",
                "matchId": f"https://api.chess.com/pub/match/{match_id}",
                "name": title,
                "teams": [
                    {"name": name, "clubId": name.casefold().replace(" ", "-")}
                    for name in team_names
                ],
                "playerStats": {},
                "matchResult": {"result": "win"},
            }

        our_club = "1 day per move club"
        repaired_960 = stored_round(
            1905217,
            "1WL 2026 960 Six4Us Winter Masters The Ge-Winner vs 1 day per move club",
            "NA",
            ["The Ge-Winner", our_club],
        )
        repaired_tmcl = stored_round(
            1781452,
            "TMCL U1400/2025/D3/ Sahovska sekcija TQM Aradac vs 1 day per move club",
            "NA",
            ["Sahovska sekcija TQM Aradac", our_club],
        )
        corrected_year = stored_round(
            1758397,
            "1WL 2025 1400-1600 Spring Masters The Pandora's box club. vs 1 day per move club",
            "NA",
            ["The Pandora's box club.", our_club],
        )
        existing = {
            "1WL": {"subLeagues": {
                "Chess960 2026 Six4Us Winter Masters": {"rounds": [stored_round(
                    "base-960",
                    "1WL 2026 960 Six4Us Winter Masters R1: Chess Team Europe vs 1 day per move club",
                    "R1",
                    ["Chess Team Europe", our_club],
                )]},
                "2025 1400-1600 Spring Masters": {"rounds": [stored_round(
                    "base-2025",
                    "1WL 2025 1400-1600 Spring Masters R1: Team Australia vs 1 day per move club",
                    "R1",
                    ["Team Australia", our_club],
                )]},
                "2026 1400-1600 Spring Masters": {"rounds": [corrected_year]},
                "Undefined Subleague": {"rounds": [repaired_960]},
            }},
            "TMCL": {"subLeagues": {
                "U1400 2025 (div D3)": {"rounds": [stored_round(
                    "base-tmcl",
                    "TMCL U1400 2025 (div D3) R2: Vedic Warriors vs 1 day per move club",
                    "R2",
                    ["Vedic Warriors", our_club],
                )]},
                "Undefined Subleague": {"rounds": [repaired_tmcl]},
            }},
        }

        output = fetcher.rebuild_leagues_output(existing, {}, {}, {})
        locations = {
            round_data["matchId"]: (league_name, subleague_name)
            for league_name, league_data in output.items()
            for subleague_name, subleague_data in league_data["subLeagues"].items()
            for round_data in subleague_data["rounds"]
        }

        self.assertEqual(
            locations[repaired_960["matchId"]],
            ("1WL", "Chess960 2026 Six4Us Winter Masters"),
        )
        self.assertEqual(
            locations[repaired_tmcl["matchId"]],
            ("TMCL", "U1400 2025 (div D3)"),
        )
        self.assertEqual(
            locations[corrected_year["matchId"]],
            ("1WL", "2025 1400-1600 Spring Masters"),
        )
        self.assertFalse(any(
            "undefined" in subleague_name.casefold()
            for league_data in output.values()
            for subleague_name in league_data["subLeagues"]
        ))

    def test_rebuild_records_observed_rounds_without_classifying_gaps(self):
        fetcher.load_config("teamusa")
        rounds = [
            {
                "round": "R1",
                "status": "finished",
                "matchId": "m1",
                "name": "WL2026 R1: Team USA vs Team Canada",
                "playerStats": {},
                "matchResult": {"result": "win"},
            },
            {
                "round": "R3",
                "status": "finished",
                "matchId": "m3",
                "name": "WL2026 R3: Team Canada vs Team USA",
                "playerStats": {},
                "matchResult": {"result": "loss"},
            },
        ]
        key = ("WL", fetcher.canonical_subleague_key("2026"))
        output = fetcher.rebuild_leagues_output(
            {},
            {key: rounds},
            {key: {"2026"}},
            {},
        )

        subleague = output["WL"]["subLeagues"]["2026"]
        self.assertEqual([r["matchId"] for r in subleague["rounds"]], ["m1", "m3"])
        self.assertEqual(subleague["diagnostics"]["observedRounds"], ["R1", "R3"])
        self.assertNotIn("missingRounds", subleague["diagnostics"])

    def test_same_day_non_numbered_matches_get_simultaneous_ids(self):
        fetcher.load_config("1dpmc")
        rounds = [
            {
                "round": "NA",
                "status": "finished",
                "matchId": "later",
                "startTime": 20,
                "name": "1WL 2026 Spring Masters: A vs B",
                "playerStats": {},
                "matchResult": {"result": "win"},
            },
            {
                "round": "NA",
                "status": "finished",
                "matchId": "earlier",
                "startTime": 10,
                "name": "1WL 2026 Spring Masters: C vs D",
                "playerStats": {},
                "matchResult": {"result": "draw"},
            },
        ]
        key = ("1WL", fetcher.canonical_subleague_key("2026 Spring Masters"))
        output = fetcher.rebuild_leagues_output(
            {},
            {key: rounds},
            {key: {"2026 Spring Masters"}},
            {},
        )

        assigned = {
            r["matchId"]: r["round"]
            for r in output["1WL"]["subLeagues"]["2026 Spring Masters"]["rounds"]
        }
        self.assertEqual(assigned, {"earlier": "M1", "later": "M2"})

    def test_non_simultaneous_non_numbered_matches_keep_na_ids(self):
        fetcher.load_config("1dpmc")
        rounds = [
            {
                "round": None,
                "status": "finished",
                "matchId": "day-one",
                "startTime": 86400,
                "name": "1WL 2026 Spring Masters: A vs B",
                "playerStats": {},
                "matchResult": {"result": "win"},
            },
            {
                "round": None,
                "status": "finished",
                "matchId": "day-two",
                "startTime": 172800,
                "name": "1WL 2026 Spring Masters: C vs D",
                "playerStats": {},
                "matchResult": {"result": "draw"},
            },
        ]
        finalized = fetcher._finalize_rounds(rounds)
        self.assertEqual(
            {r["matchId"]: r["round"] for r in finalized},
            {"day-one": "NA", "day-two": "NA-2"},
        )

    def test_duplicate_match_prefers_finished_snapshot(self):
        fetcher.load_config("1dpmc")
        rounds = [
            {
                "round": "NA",
                "status": "finished",
                "matchId": "duplicate",
                "startTime": 10,
                "endTime": 30,
                "name": "1WL 2026 Spring Masters: A vs B",
                "playerStats": {"player": {"games": 2}},
                "matchResult": {"result": "win"},
            },
            {
                "round": "NA-2",
                "status": "in_progress",
                "matchId": "duplicate",
                "startTime": 10,
                "name": "1WL 2026 Spring Masters: A vs B",
                "playerStats": {},
                "matchResult": {"result": "unknown"},
            },
        ]
        finalized = fetcher._finalize_rounds(rounds)

        self.assertEqual(len(finalized), 1)
        self.assertEqual(finalized[0]["status"], "finished")
        self.assertEqual(finalized[0]["endTime"], 30)

    def test_global_dedup_keeps_match_id_in_one_subleague(self):
        fetcher.load_config("teamusa")
        duplicate = {
            "round": "R1",
            "status": "finished",
            "matchId": "global-duplicate",
            "startTime": 10,
            "endTime": 20,
            "name": "WL2026 Open A R1: Team USA vs Team Canada",
            "playerStats": {"player": {"games": 2, "wins": 2, "draws": 0, "losses": 0}},
            "matchResult": {"result": "win"},
        }
        output = fetcher.rebuild_leagues_output(
            {},
            {
                ("WL", fetcher.canonical_subleague_key("2026 Open A")): [dict(duplicate)],
                ("WL", fetcher.canonical_subleague_key("2026 Open B")): [dict(duplicate)],
            },
            {
                ("WL", fetcher.canonical_subleague_key("2026 Open A")): {"2026 Open A"},
                ("WL", fetcher.canonical_subleague_key("2026 Open B")): {"2026 Open B"},
            },
            {},
        )
        occurrences = [
            round_data["matchId"]
            for league_data in output.values()
            for subleague in league_data["subLeagues"].values()
            for round_data in subleague["rounds"]
            if round_data["matchId"] == "global-duplicate"
        ]
        self.assertEqual(occurrences, ["global-duplicate"])

    def test_refreshed_context_moves_match_without_cross_subleague_duplicate(self):
        fetcher.load_config("teamusa")
        existing = {
            "WL": {
                "subLeagues": {
                    "Old Label": {
                        "rounds": [{
                            "round": "NA",
                            "status": "in_progress",
                            "matchId": "moving",
                            "name": "WL2026 Old Label Team USA vs Team Canada",
                            "playerStats": {},
                            "matchResult": {"result": "unknown"},
                        }],
                    }
                }
            }
        }
        key = ("WL", fetcher.canonical_subleague_key("2026 New Label"))
        refreshed = {
            key: [{
                "round": "NA",
                "status": "finished",
                "matchId": "moving",
                "name": "WL2026 New Label Team USA vs Team Canada",
                "playerStats": {},
                "matchResult": {"result": "win"},
            }]
        }
        output = fetcher.rebuild_leagues_output(
            existing,
            refreshed,
            {key: {"2026 New Label"}},
            {},
        )

        self.assertNotIn("Old Label", output["WL"]["subLeagues"])
        self.assertEqual(
            output["WL"]["subLeagues"]["2026 New Label"]["rounds"][0]["status"],
            "finished",
        )

    def test_existing_variant_is_rekeyed_without_losing_round(self):
        fetcher.load_config("teamusa")
        existing = {
            "WL": {
                "subLeagues": {
                    "Chess960 2016,": {
                        "rounds": [{
                            "round": "R7",
                            "status": "finished",
                            "matchId": "m7",
                            "name": "Chess960 WL2016, R7: Team USA vs Team Poland",
                            "playerStats": {},
                            "matchResult": {"result": "win"},
                        }],
                        "leaderboard": [],
                        "record": {"wins": 1, "losses": 0, "draws": 0},
                    }
                }
            }
        }
        output = fetcher.rebuild_leagues_output(existing, {}, {}, {})

        self.assertIn("Chess960 2016", output["WL"]["subLeagues"])
        self.assertNotIn("Chess960 2016,", output["WL"]["subLeagues"])
        self.assertEqual(
            output["WL"]["subLeagues"]["Chess960 2016"]["rounds"][0]["matchId"],
            "m7",
        )

    def test_api_rating_cap_mismatch_is_a_hard_grouping_rejection(self):
        fetcher.load_config("1dpmc")

        def match(match_id, group, round_name, day, max_rating):
            return {
                "round": round_name,
                "status": "finished",
                "matchId": f"https://api.chess.com/pub/match/{match_id}",
                "startTime": day * 86400,
                "name": f"1WL 2026 U1800 20 {group} {round_name}: Team A vs Team B",
                "apiMetadata": {"maxRating": max_rating, "minRating": None, "rules": None, "timeControl": None, "boards": 20},
                "playerStats": {},
                "matchResult": {"result": "win"},
            }

        existing = {"1WL": {"subLeagues": {"2026 U1800 20 G2": {"rounds": [
            match(1001, "G2", "R1", 1, 1800),
            match(1002, "G2", "R2", 29, 1800),
            match(1003, "G2", "R3", 57, 1800),
            match(1005, "G2", "R5", 113, 1800),
        ]}}}}
        key = ("1WL", fetcher.canonical_subleague_key("2026 U1800 20 G1"))
        output = fetcher.rebuild_leagues_output(
            existing,
            {key: [match(1004, "G1", "R4", 85, 1600)]},
            {key: {"2026 U1800 20 G1"}},
            {},
        )

        self.assertIn("2026 U1800 20 G1", output["1WL"]["subLeagues"])
        self.assertIn("2026 U1800 20 G2", output["1WL"]["subLeagues"])
        self.assertEqual(
            output["1WL"]["subLeagues"]["2026 U1800 20 G1"]["rounds"][0]["apiMetadata"]["maxRating"],
            1600,
        )

    def test_team_round_collision_blocks_legacy_alias_merge(self):
        fetcher.load_config("teamusa")

        def match(match_id, label, round_name, day):
            return {
                "round": round_name,
                "status": "finished",
                "matchId": str(match_id),
                "startTime": day * 86400,
                "name": f"WL2026 Classic U1700 {label} {round_name}: Team USA vs Team Canada",
                "teams": [
                    {"name": "Team USA", "clubId": "team-usa"},
                    {"name": "Team Canada", "clubId": "team-canada"},
                ],
                "playerStats": {},
                "matchResult": {"result": "win"},
            }

        output = fetcher.rebuild_leagues_output(
            {"WL": {"subLeagues": {
                "2026 Classic U1700": {"rounds": [
                    match(1, "", "R1", 1), match(2, "", "R2", 29), match(3, "", "R3", 57),
                ]},
                "2026 Classic U1700 A": {"rounds": [match(4, "A", "R2", 29)]},
            }}},
            {}, {}, {},
        )

        self.assertEqual(len(output["WL"]["subLeagues"]), 2)
        reasons = [
            match["reason"]
            for subleague in output["WL"]["subLeagues"].values()
            for match in subleague["diagnostics"]["ambiguousMatches"]
        ]
        self.assertTrue(any(
            reason.startswith("REJECTED: Team round collision [") and reason.endswith("] in R2")
            for reason in reasons
        ))

    def test_same_round_match_variants_share_one_subleague(self):
        fetcher.load_config("1dpmc")

        def match(match_id, variant):
            return {
                "round": "R1",
                "status": "finished",
                "matchId": match_id,
                "name": (
                    f"PCL Fire and Ashes S2 GA R1 {variant}: "
                    "1 day per move club vs Chess Players Without Borders"
                ),
                "teams": [
                    {"name": "1 day per move club", "clubId": "1-day-per-move-club"},
                    {"name": "Chess Players Without Borders", "clubId": "chess-players-without-borders"},
                ],
                "playerStats": {},
                "matchResult": {"result": "win"},
            }

        parsed = fetcher.parse_match_title(
            match("classic", "Classic")["name"]
        )
        self.assertEqual(parsed["subLeague"], "Fire and Ashes S2 GA")
        self.assertEqual(parsed["matchVariant"], "Classic")
        self.assertEqual(
            fetcher.parse_match_title(match("960", "960")["name"])["matchVariant"],
            "Chess960",
        )

        output = fetcher.rebuild_leagues_output(
            {"PCL": {"subLeagues": {
                "Fire and Ashes S2 GA": {"rounds": [
                    match("classic", "Classic"),
                    match("thematic", "Thematic"),
                    match("960", "960"),
                ]},
            }}},
            {}, {}, {},
        )

        self.assertEqual(list(output["PCL"]["subLeagues"]), ["Fire and Ashes S2 GA"])
        self.assertEqual(
            {round_data["matchId"] for round_data in output["PCL"]["subLeagues"]["Fire and Ashes S2 GA"]["rounds"]},
            {"classic", "thematic", "960"},
        )
        self.assertEqual(
            output["PCL"]["subLeagues"]["Fire and Ashes S2 GA"]["diagnostics"]["ambiguousMatches"],
            [],
        )

    def test_team_round_collision_also_partitions_fresh_batch(self):
        fetcher.load_config("teamusa")
        key = ("WL", fetcher.canonical_subleague_key("2026 Open"))
        def match(match_id, opponent):
            return {
                "round": "R1", "status": "finished", "matchId": match_id,
                "name": f"WL2026 Open R1: Team USA vs {opponent}", "playerStats": {},
                "matchResult": {"result": "win"},
                "teams": [
                    {"name": "Team USA", "clubId": "team-usa"},
                    {"name": opponent, "clubId": opponent.casefold().replace(" ", "-")},
                ],
            }

        output = fetcher.rebuild_leagues_output(
            {}, {key: [match("fresh-a", "Team A"), match("fresh-b", "Team B")]},
            {key: {"2026 Open"}}, {},
        )
        self.assertEqual(sum(
            len(subleague["rounds"])
            for subleague in output["WL"]["subLeagues"].values()
        ), 2)
        ambiguous = [
            match
            for subleague in output["WL"]["subLeagues"].values()
            for match in subleague["diagnostics"]["ambiguousMatches"]
        ]
        self.assertTrue(any("Team round collision" in match["reason"] for match in ambiguous))


if __name__ == "__main__":
    unittest.main()
