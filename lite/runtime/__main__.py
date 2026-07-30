"""python -m lite.runtime"""

import argparse
import logging

from .server import run_server


def main() -> None:
    parser = argparse.ArgumentParser(description="aflow-lite runtime")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--db", default="data/aflow.db")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    run_server(host=args.host, port=args.port, db_path=args.db)


if __name__ == "__main__":
    main()
