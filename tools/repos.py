#!/usr/bin/env python3
"""Reads repos.json, the list of firmware repos the simulator can build.

  repos.py default              name of the default repo
  repos.py list                 one "name github" line per repo
  repos.py sync-devcontainer    copy the repo list into devcontainer.json's write permissions
  repos.py check-devcontainer   exit 1 if devcontainer.json is out of date
"""
import json
import os
import sys

SIM_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPOS_JSON = os.path.join(SIM_DIR, "repos.json")
DEVCONTAINER = os.path.join(SIM_DIR, ".devcontainer", "devcontainer.json")


def load(path):
    with open(path) as f:
        return json.load(f)


def wanted_permissions(repos):
    return {r["github"]: {"permissions": {"contents": "write"}} for r in repos["repos"]}


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
    repos = load(REPOS_JSON)

    if cmd == "default":
        print(repos.get("default") or repos["repos"][0]["name"])
    elif cmd == "list":
        for r in repos["repos"]:
            print(r["name"], r["github"])
    elif cmd in ("sync-devcontainer", "check-devcontainer"):
        dc = load(DEVCONTAINER)
        current = dc["customizations"]["codespaces"].get("repositories", {})
        wanted = wanted_permissions(repos)
        if cmd == "check-devcontainer":
            sys.exit(0 if current == wanted else 1)
        dc["customizations"]["codespaces"]["repositories"] = wanted
        with open(DEVCONTAINER, "w") as f:
            json.dump(dc, f, indent=2)
            f.write("\n")
        print("Updated", DEVCONTAINER)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
