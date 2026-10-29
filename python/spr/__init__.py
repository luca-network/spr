"""SPR, the Sealed Payment Record, for Python (Apache-2.0).

    from spr import SprBook
    book = SprBook(dir="books", agent_id="agt_research", entity="Example Co")
    intent = book.declare(purpose="Market data", max_amount_minor=20000, currency="USDC")
    record = book.seal(rail="x402", source_id=tx_hash, amount_minor=10000, currency="USDC", nonce=book.nonce_for(intent["intent_id"]))
"""
from .format import *  # noqa: F401,F403
from .format import SPEC_VERSION, run_vectors, verify_package  # noqa: F401
from .book import SprBook, SDK_PRODUCER, LucaError, luca_url, synced_folder_of, verify_folder  # noqa: F401

__version__ = "0.1.3"
