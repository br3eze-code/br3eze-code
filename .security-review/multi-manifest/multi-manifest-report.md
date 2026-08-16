# Multi-manifest local security audit report

Generated: 2026-08-16T16:19:56.371Z

## Reproducible local results

The isolated npm audit sweep covered **43 resolved surfaces**. The non-deduplicated sum is **176 findings**, including **40 critical** and **46 high** entries.

The counts are not a repository-wide unique advisory count: the same advisory can occur in multiple independently resolved plugin manifests. The root lockfile reports 0 critical and 0 high; the nested Cordova SQLite lockfile reports 0 critical and 0 high.

## Highest-risk surfaces

| Surface | Critical/high detail records | Interpretation |
|---|---:|---|
| lockless:plugins_community-cordova-plugin-wifi-wizard | 62 | Requires reachability and dependency-path review |
| lockless:plugins_cordova-plugin-contacts | 4 | Requires reachability and dependency-path review |
| lockless:plugins_cordova-plugin-vibration | 3 | Requires reachability and dependency-path review |
| lockless:plugins_cordova-plugin-device | 3 | Requires reachability and dependency-path review |
| lockless:plugins_cordova-plugin-screen-orientation | 3 | Requires reachability and dependency-path review |

## Critical/high advisory groups

| Severity | Package | Advisory | Range | Occurrences | Surfaces |
|---|---|---|---|---:|---|
| critical | babel-traverse | https://github.com/advisories/GHSA-67hx-6x53-jw92 | <7.23.2 | 1 | 1 |
| critical | deep-extend | https://github.com/advisories/GHSA-hr2v-3952-633q | <0.5.1 | 1 | 1 |
| critical | form-data | https://github.com/advisories/GHSA-fjxv-7rqg-78g4 | <2.5.4 | 1 | 1 |
| critical | json-schema | https://github.com/advisories/GHSA-896r-f27r-55mw | <0.4.0 | 1 | 1 |
| critical | lodash | https://github.com/advisories/GHSA-jf85-cpcp-j695 | <4.17.12 | 1 | 1 |
| critical | minimist | https://github.com/advisories/GHSA-xvch-5gv4-984h | <0.2.4 | 1 | 1 |
| critical | plist | https://github.com/advisories/GHSA-4cpg-3vgw-4877 | <3.0.5 | 1 | 1 |
| critical | shell-quote | https://github.com/advisories/GHSA-qg8p-v9q4-gh34 | <1.6.1 | 1 | 1 |
| critical | tar | https://github.com/advisories/GHSA-23hp-3jrh-7fpw | <=7.5.18 | 1 | 1 |
| critical | underscore | https://github.com/advisories/GHSA-cf4h-3jhx-xvhq | >=1.3.2 <1.12.1 | 1 | 1 |
| critical | xmldom | https://github.com/advisories/GHSA-crh6-fp67-6883 | <=0.6.0 | 1 | 1 |
| high | brace-expansion | https://github.com/advisories/GHSA-3jxr-9vmj-r5cp | <1.1.16 | 1 | 1 |
| high | brace-expansion | https://github.com/advisories/GHSA-mh99-v99m-4gvg | <1.1.17 | 1 | 1 |
| high | brace-expansion | https://github.com/advisories/GHSA-rgw5-rvv9-x895 | <1.1.18 | 1 | 1 |
| high | brace-expansion | https://github.com/advisories/GHSA-832h-xg76-4gv6 | <1.1.7 | 1 | 1 |
| high | cross-spawn | https://github.com/advisories/GHSA-3xgq-45jj-v275 | <6.0.6 | 1 | 1 |
| high | flatted | https://github.com/advisories/GHSA-25h7-pfq9-p65f | <3.4.0 | 2 | 2 |
| high | flatted | https://github.com/advisories/GHSA-rf6f-7fwh-wjgh | <=3.4.1 | 2 | 2 |
| high | form-data | https://github.com/advisories/GHSA-hmw2-7cc7-3qxx | <2.5.6 | 1 | 1 |
| high | fstream | https://github.com/advisories/GHSA-xf7w-r453-m56c | <1.0.12 | 1 | 1 |
| high | hawk | https://github.com/advisories/GHSA-jcpv-g9rr-qxrc | <3.1.3 | 1 | 1 |
| high | hawk | https://github.com/advisories/GHSA-44pw-h2cw-w3vq | <9.0.1 | 1 | 1 |
| high | hoek | https://github.com/advisories/GHSA-c429-5p7v-vgjp | <=6.1.3 | 1 | 1 |
| high | hoek | https://github.com/advisories/GHSA-jp4x-w63m-7wgm | <4.2.1 | 1 | 1 |
| high | ini | https://github.com/advisories/GHSA-qqgx-2p2h-9c37 | <1.3.6 | 1 | 1 |
| high | lodash | https://github.com/advisories/GHSA-35jh-r3h4-6jhm | <4.17.21 | 1 | 1 |
| high | lodash | https://github.com/advisories/GHSA-r5fr-rjxr-66jc | >=4.0.0 <=4.17.23 | 1 | 1 |
| high | lodash | https://github.com/advisories/GHSA-4xc9-xhrj-v574 | <4.17.11 | 1 | 1 |
| high | lodash | https://github.com/advisories/GHSA-p6mc-m468-83gw | >=3.7.0 <4.17.19 | 1 | 1 |
| high | mime | https://github.com/advisories/GHSA-wrvr-8mpx-r7pp | <1.4.1 | 1 | 1 |
| high | minimatch | https://github.com/advisories/GHSA-3ppc-4f35-3m26 | <3.1.3 | 2 | 2 |
| high | minimatch | https://github.com/advisories/GHSA-7r86-cg39-jmmj | <3.1.3 | 2 | 2 |
| high | minimatch | https://github.com/advisories/GHSA-f8q6-p94x-37v3 | <3.0.5 | 1 | 1 |
| high | minimatch | https://github.com/advisories/GHSA-23c5-xmqv-rm74 | <3.1.4 | 2 | 2 |
| high | minimatch | https://github.com/advisories/GHSA-hxm2-r34f-qmc5 | <3.0.2 | 1 | 1 |
| high | node-uuid | https://github.com/advisories/GHSA-265q-28rp-chq5 | <1.4.4 | 1 | 1 |
| high | npm | https://github.com/advisories/GHSA-m6cx-g6qm-p2cx | <6.13.3 | 1 | 1 |
| high | npm | https://github.com/advisories/GHSA-ph34-pc88-72gc | <5.7.1 | 1 | 1 |
| high | npm | https://github.com/advisories/GHSA-x8qc-rrcw-4r46 | <6.13.3 | 1 | 1 |
| high | npm | https://github.com/advisories/GHSA-4328-8hgf-7wjr | <6.13.4 | 1 | 1 |
| high | npm-user-validate | https://github.com/advisories/GHSA-pw54-mh39-w3hc | <1.0.1 | 1 | 1 |
| high | qs | https://github.com/advisories/GHSA-gqgv-6jq5-jjj9 | >=6.2.0 <6.2.3 | 1 | 1 |
| high | qs | https://github.com/advisories/GHSA-gqgv-6jq5-jjj9 | <6.0.4 | 1 | 1 |
| high | qs | https://github.com/advisories/GHSA-hrpp-h998-j3pp | <6.2.4 | 1 | 1 |
| high | semver | https://github.com/advisories/GHSA-c2qf-rxjj-qqgw | >=2.0.0-alpha <5.7.2 | 2 | 2 |
| high | shell-quote | https://github.com/advisories/GHSA-395f-4hp3-45gv | <=1.8.4 | 1 | 1 |
| high | shelljs | https://github.com/advisories/GHSA-4rq4-32rv-6wp6 | <0.8.5 | 1 | 1 |
| high | sshpk | https://github.com/advisories/GHSA-2m39-62fm-q8r3 | <1.13.2 | 1 | 1 |
| high | tar | https://github.com/advisories/GHSA-3jfq-g458-7qm9 | <3.2.2 | 1 | 1 |
| high | tar | https://github.com/advisories/GHSA-5955-9wpr-37jh | <4.4.18 | 1 | 1 |
| high | tar | https://github.com/advisories/GHSA-j44m-qm6p-hp7m | <2.2.2 | 1 | 1 |
| high | tar | https://github.com/advisories/GHSA-83g3-92jg-28cx | <7.5.8 | 1 | 1 |
| high | tar | https://github.com/advisories/GHSA-8qq5-rm4j-mr97 | <=7.5.2 | 1 | 1 |
| high | tar | https://github.com/advisories/GHSA-9ppj-qmqm-q256 | <=7.5.10 | 1 | 1 |
| high | tar | https://github.com/advisories/GHSA-34x7-hfp2-rc4v | <7.5.7 | 1 | 1 |
| high | tar | https://github.com/advisories/GHSA-8x88-c5mf-7j5w | <=7.5.17 | 1 | 1 |
| high | tar | https://github.com/advisories/GHSA-r6q2-hw4h-h46w | <=7.5.3 | 1 | 1 |
| high | tar | https://github.com/advisories/GHSA-gfjr-3jmm-4g9v | <2.0.0 | 1 | 1 |
| high | tar | https://github.com/advisories/GHSA-qffp-2rhf-9h96 | <=7.5.9 | 1 | 1 |
| high | tmp | https://github.com/advisories/GHSA-ph9p-34f9-6g65 | <0.2.6 | 3 | 3 |
| high | tough-cookie | https://github.com/advisories/GHSA-g7q5-pjjr-gqvp | <2.3.3 | 1 | 1 |
| high | underscore | https://github.com/advisories/GHSA-qpx9-hpmf-5gmw | <=1.13.7 | 1 | 1 |
| high | xmldom | https://github.com/advisories/GHSA-f6ww-3ggp-fr8h | <=0.6.0 | 1 | 1 |
| high | xmldom | https://github.com/advisories/GHSA-j759-j44w-7fr8 | <=0.6.0 | 1 | 1 |
| high | xmldom | https://github.com/advisories/GHSA-x6wf-f3px-wcqx | <=0.6.0 | 1 | 1 |
| high | xmldom | https://github.com/advisories/GHSA-2v35-w6hq-6mfw | <=0.6.0 | 1 | 1 |
| high | xmldom | https://github.com/advisories/GHSA-wh4c-j3r5-mjhp | <=0.6.0 | 1 | 1 |

## Specialist remediation order

1. **Engineer** confirms whether each package is runtime-reachable, build-only, test-only, or plugin-development-only and maps each advisory to a direct or transitive dependency path.
2. **Project Manager and Planner** create one WBS package per unique advisory group, sequence critical runtime paths first, and track activity numbers, float, and release gates.
3. **Procurement** evaluates maintained replacements, licensing, support, and buy-versus-build options for abandoned packages.
4. **Expeditor** tracks upstream fixes and supplier or maintainer responses for blocked upgrades.
5. **QA** runs security regression, tenant-isolation, payment, courier, channel, and platform tests after each dependency wave.
6. **Editor and Draftsman** maintain the controlled advisory register, dependency map, upgrade notes, and rollback runbook.
7. **Accountant and Secretary** record remediation cost, approvals, decisions, deadlines, and release communication.

## Evidence limitations

The GitHub Dependabot endpoint returned HTTP 403 in this environment, so the remote aggregate of 7 critical and 70 high findings could not be mapped to advisory IDs. The local audit used temporary lockfiles for lockless manifests and did not modify the repository manifests. Temporary resolution can differ from the exact dependency graph used by the project build. Treat these results as a reproducible discovery set, not as a final release decision, until canonical lockfiles are generated and reviewed.
