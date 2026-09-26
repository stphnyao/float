"""Quick-and-dirty prototype of the Tempo access-key repayment flow.

Usage:
    $ pip install pytempo python-dotenv
    $ cp .env.example .env  # then fill in values
    $ python pull_test.py

The script:
1. Loads env vars for merchant & server keys
2. Connects to Tempo testnet
3. Ensures merchant wallet has ≥ DAILY_CAP * 2 stable-coin balance (use faucet first)
4. Merchant creates an access-key delegating DAILY_CAP spend to the server wallet, restricted to STABLECOIN_ADDRESS transfers
5. Server wallet sends two `stablecoin.transferFrom()` txs:
   a) amount = DAILY_CAP − 1   → expected **success**
   b) amount = DAILY_CAP + 5   → expected **revert/cap exceeded**
6. Prints tx hashes and explorer URLs.

NOTE: pytempo API is hypothetical until the SDK merges; if unavailable, swap to the TypeScript SDK or raw contract calls as described in PLAN.md §6.
"""

import os
from decimal import Decimal
from dotenv import load_dotenv

try:
    from pytempo import Tempo
except ImportError as exc:  # fallback stub so the file imports even without SDK
    class Tempo:  # type: ignore
        def __init__(self, *a, **kw):
            raise exc

load_dotenv()

RPC = os.environ["TEMPO_RPC_URL"]
MERCHANT_KEY = os.environ["MERCHANT_PRIVATE_KEY"]
SERVER_KEY = os.environ["SERVER_PRIVATE_KEY"]
TOKEN_ADDR = os.environ["STABLECOIN_ADDRESS"]
CAP = Decimal(os.environ.get("DAILY_CAP", "20"))


def main() -> None:
    tempo = Tempo(RPC)

    merchant = tempo.wallet(MERCHANT_KEY)
    server = tempo.wallet(SERVER_KEY)

    print("Merchant:", merchant.address)
    print("Server  :", server.address)

    # 1. Create / update access-key
    print("Creating access-key with daily cap", CAP)
    access_key_tx = tempo.create_access_key(
        owner=merchant,
        delegate=server.address,
        token=TOKEN_ADDR,
        daily_limit=int(CAP * 10**6),  # assume 6-decimals
    )
    print("access-key tx:", access_key_tx.hash)

    # 2. In-cap pull
    in_cap_amt = CAP - 1
    print("\n--- in-cap pull", in_cap_amt)
    success_tx = tempo.transfer_from(
        token=TOKEN_ADDR,
        from_addr=merchant.address,
        to_addr=server.address,
        amount=int(in_cap_amt * 10**6),
        signer=server,
    )
    print("success tx:", success_tx.hash)

    # 3. Over-cap pull
    over_cap_amt = CAP + 5
    print("\n--- over-cap pull", over_cap_amt)
    try:
        fail_tx = tempo.transfer_from(
            token=TOKEN_ADDR,
            from_addr=merchant.address,
            to_addr=server.address,
            amount=int(over_cap_amt * 10**6),
            signer=server,
        )
        print("UNEXPECTED SUCCESS:", fail_tx.hash)
    except Exception as err:  # noqa: BLE001
        print("Expected failure:", err)


if __name__ == "__main__":
    main()
