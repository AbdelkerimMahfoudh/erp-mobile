# ops/render-tests

Tooling only, never merged. Runs erp-mobile's rendered (Jest) suite on Linux for the commit in `target.env` and keeps
Jest's report under `evidence/<commit>-<run>/` (summary.txt, jest.json, jest.txt). Needed since Expo SDK 58: the owner's PC
cannot run Jest 30 (Smart App Control blocks unrs-resolver's native binary). See erp-docs D222.
