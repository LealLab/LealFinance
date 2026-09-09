from typing import NamedTuple


class PostingResult(NamedTuple):
    processed: int
    failed: int
