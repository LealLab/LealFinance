"""Mirrors frontend/src/app/domain/calc/recurrence.spec.ts - both sides must
agree on which date a given occurrence falls on."""

from datetime import date

from app.services.recurrence import project_occurrence_dates


def test_expands_monthly_occurrences_within_range() -> None:
    dates = project_occurrence_dates(
        start_date=date(2026, 1, 15),
        frequency="monthly",
        interval=1,
        end_date=None,
        range_start=date(2026, 1, 1),
        range_end=date(2026, 4, 30),
    )
    assert dates == [date(2026, 1, 15), date(2026, 2, 15), date(2026, 3, 15), date(2026, 4, 15)]


def test_expands_weekly_occurrences_by_7_times_interval_days() -> None:
    dates = project_occurrence_dates(
        start_date=date(2026, 1, 1),
        frequency="weekly",
        interval=2,
        end_date=None,
        range_start=date(2026, 1, 1),
        range_end=date(2026, 2, 1),
    )
    assert dates == [date(2026, 1, 1), date(2026, 1, 15), date(2026, 1, 29)]


def test_expands_yearly_occurrences() -> None:
    dates = project_occurrence_dates(
        start_date=date(2026, 6, 1),
        frequency="yearly",
        interval=1,
        end_date=None,
        range_start=date(2026, 1, 1),
        range_end=date(2029, 1, 1),
    )
    assert dates == [date(2026, 6, 1), date(2027, 6, 1), date(2028, 6, 1)]


def test_respects_interval_greater_than_one_for_monthly_rules() -> None:
    dates = project_occurrence_dates(
        start_date=date(2026, 1, 15),
        frequency="monthly",
        interval=3,
        end_date=None,
        range_start=date(2026, 1, 1),
        range_end=date(2026, 12, 31),
    )
    assert dates == [date(2026, 1, 15), date(2026, 4, 15), date(2026, 7, 15), date(2026, 10, 15)]


def test_stops_at_the_rule_end_date_even_if_the_query_range_extends_further() -> None:
    dates = project_occurrence_dates(
        start_date=date(2026, 1, 15),
        frequency="monthly",
        interval=1,
        end_date=date(2026, 3, 1),
        range_start=date(2026, 1, 1),
        range_end=date(2026, 12, 31),
    )
    assert dates == [date(2026, 1, 15), date(2026, 2, 15)]


def test_clamps_month_end_anchors_across_a_run() -> None:
    dates = project_occurrence_dates(
        start_date=date(2026, 1, 31),
        frequency="monthly",
        interval=1,
        end_date=None,
        range_start=date(2026, 1, 1),
        range_end=date(2026, 4, 30),
    )
    assert dates == [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]


def test_returns_nothing_when_the_range_is_entirely_before_the_rule_starts() -> None:
    dates = project_occurrence_dates(
        start_date=date(2026, 1, 15),
        frequency="monthly",
        interval=1,
        end_date=None,
        range_start=date(2025, 1, 1),
        range_end=date(2025, 12, 31),
    )
    assert dates == []


def test_interval_zero_returns_nothing() -> None:
    dates = project_occurrence_dates(
        start_date=date(2026, 1, 15),
        frequency="monthly",
        interval=0,
        end_date=None,
        range_start=date(2026, 1, 1),
        range_end=date(2026, 12, 31),
    )
    assert dates == []
