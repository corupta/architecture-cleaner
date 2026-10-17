# ARCADE MoJo oracles

Copied from [usc-softarch/arcade_core](https://github.com/usc-softarch/arcade_core) at commit
`53e6f4f6e35098b260290e5cda794ec78f6df4df`, `src/test/resources/MoJoCalculator/` (BSD-3-Clause, see `LICENSE`):

- `<system>/<technique>/*.rsf.gz`: the clusterings, gzipped (`gzip -9 -n`), otherwise unchanged.
- `MoJoBaseOracles/`, `MoJoFMoracles/`: ARCADE's recorded values. `MoJoCalculatorTest.calcMojoMeasure` builds
  `new MoJoCalculator(source = first file, target = second file)` for each `first,second,value` triple.

These are ARCADE's own regression values (written by its `generateOracles`), not independent truth;
test/bench/metrics.test.ts checks the port against them and against brute force.
