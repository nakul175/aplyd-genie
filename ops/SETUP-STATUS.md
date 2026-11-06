# Aplyd Genie Product Setup

6 November 2026

## Registered identity

- Product: Aplyd Genie.
- BTF: https://backlogtothefuture.aplyd.org/aplyd/GENIE . Created and verified in the Aplyd team, Software issue types.
- Bug Off: https://bugoff.aplyd.org/en-US/projects/overview/7 . Created and verified; implementation acceptance remains unexecuted. QuickScript disabled; no AI provider selected during setup.
- Repository target: https://github.com/nakul175/aplyd-genie . Created private under the authenticated nakul175 account; initial product specifications are committed to main.

## DNS

GoDaddy accepted two new A records in the aplyd.org zone, increasing the visible record count from 30 to 32:

| Host | Target | TTL |
|---|---|---|
| genie.aplyd.org | 168.144.144.69 | 600 seconds |
| staging.ginie.aplyd.org | 168.144.144.69 | 600 seconds |

Target matches the existing Aplyd application records observed for Holy Sheet, BTF, Bug Off and Mai Samay Hoon. Staging retains the explicitly requested `ginie` spelling. Both names resolved to 168.144.144.69 through a fresh DNS lookup after creation. Authoritative nameserver ns51.domaincontrol.com returned both exact A records with 600-second TTLs. No application route, TLS certificate, running Genie service or production release is claimed.

## Tracker documentation

- BTF product baseline: https://backlogtothefuture.aplyd.org/aplyd/GENIE/docs/225 .
- Bug Off documentation: https://bugoff.aplyd.org/en-US/projects/documentation/7 .
- Both contain the renamed product summary and links to the complete repository specifications. Individual work items and executable test cases are not claimed imported.

## Backlog status

21 epics, 90 detailed proposed stories, 270 acceptance criteria and six bounded workflows are recorded in the repository specifications. Specification IDs are not claimed live BTF issue keys. Existing application prerequisites stay assigned to their functional domains rather than implying Genie rebuilds the suite. No story has been marked implemented or passed.

## Standing constraints

All schedules and heartbeat automations remain paused. No recurring work, GPU deployment, shared server modification or application deployment was performed as part of registration.
