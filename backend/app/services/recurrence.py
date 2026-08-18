"""Occurrence-date math for a RecurringRule - the Python twin of the
frontend's domain/calc/recurrence.ts, kept in lockstep because both sides
must agree on which date a given occurrence falls on.

The Nth occurrence (`periods = rule.interval * N`) is computed directly
from the rule's start date every time, never by stepping from the previous
occurrence - that matters for month-end anchors: a monthly rule starting
Jan 31 must land on Mar 31 (not Mar 28) even though the Feb occurrence in
between clamped to 28. Stepping from a clamped date would permanently lose
the day-31 anchor; recomputing from `start` every time doesn't.
"""

import calendar
from datetime import date, timedelta

# A pathological rule (interval 0 or a huge range) shouldn't be able to
# spin this loop forever.
MAX_OCCURRENCES = 2000


def add_months_clamped(start: date, months: int) -> date:
    """Adds calendar months, clamping the day-of-month to whatever the
    target month actually has - Jan 31 + 1 month lands on Feb 28 (or 29),
    not an overflowed Mar 3. `months` may be negative."""
    total = start.month - 1 + months
    year = start.year + total // 12
    month = total % 12 + 1
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(start.day, last_day))


def occurrence_date(start: date, frequency: str, periods: int) -> date:
    if frequency == "weekly":
        return start + timedelta(days=7 * periods)
    if frequency == "monthly":
        return add_months_clamped(start, periods)
    if frequency == "yearly":
        return add_months_clamped(start, 12 * periods)
    raise ValueError(f"unknown frequency: {frequency}")


def project_occurrence_dates(
    *,
    start_date: date,
    frequency: str,
    interval: int,
    end_date: date | None,
    range_start: date,
    range_end: date,
) -> list[date]:
    """Every occurrence date within [range_start, range_end] (inclusive),
    truncated by the rule's own end_date. Mirrors projectOccurrences in
    recurrence.ts, minus the template payload - callers here only need the
    dates."""
    if interval < 1:
        return []

    dates: list[date] = []
    for index in range(MAX_OCCURRENCES):
        occurrence = occurrence_date(start_date, frequency, interval * index)
        if occurrence > range_end:
            break
        if end_date is not None and occurrence > end_date:
            break
        if occurrence >= range_start:
            dates.append(occurrence)

    return dates
