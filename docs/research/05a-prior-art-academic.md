# Track 5a: prior art (academic)

Raw research report (2026-10-01/02), kept verbatim. See README.md for method caveats.


---

# Report

# Track 5a: Academic prior art for architecture-cleaner

**How this was checked.** The shared WebSearch budget ran out partway through (200/200). After that, every ID was checked against primary metadata: the arXiv export API for arXiv IDs, Crossref for DOIs, and OpenAlex for abstracts, plus WebFetch of GitHub and docs pages. Every DOI and arXiv ID below resolved and its title matched unless it is marked otherwise. Nothing was cloned and nothing in /workspace was touched.

**Date caveat.** Today is 2026-10-01, and many 2026 items are fresh preprints. Venue claims come from arXiv comments, and some look inconsistent; these are flagged.

---

## 0. Summary

- **Recovery and clustering (1998–2026)** only describes the structure. It never moves code. Accuracy against expert ground truth has historically been low (Garcia 2013; Lutellier 2015/2018). The 2025–26 LLM work (SemRef, ClassLAR, ArchAgent) improves recovery, but it still only recovers or recommends.
- **Search-based remodularization** recommends move-class and split-package sequences. It already has a "minimize number of changes" objective (Mkaouer 2015). Carrying out the recommendations is an acknowledged unsolved gap (REARRANGE 2023).
- **Monolith-to-microservice work** is almost all Java and recommendation-only. There are two partial exceptions that generate or refactor code: MicroRefact (2021) and IBM Mono2Micro's codegen. Neither proves behavior preservation.
- **"LLM decides, a deterministic engine executes" is not new.** EM-Assist (2024), MM-assist (2025), RefactoringMirror (2024/25), coordinated rename via IDE APIs (2026), LLM-synthesized AST rules (BigBag 2026; ASE 2026 rule synthesis) and Google's migration work (2025) all use it. All of these work at method or symbol level, mostly in Java.
- **Translation validation and binding preservation are old ideas**: Pnueli 1998, Necula 2000, Schäfer et al. 2008–2012 (JRRT, the JastAdd Refactoring Tools). What I could not find is a checker for **TS/JS module moves** that works without tests: resolved-import-graph equality plus identity-normalized AST equality plus a hazard scan.
- **TS/JS is nearly absent from the literature.** The recovery, remodularization and LLM-refactoring work is overwhelmingly Java, with some Python. TypeScript is missing even from instructed code-editing benchmarks (2604.05100). The only TS-inclusive refactoring benchmark found is SWE-Bench ProMax (2026), which checks with tests, not certificates.
- **The defensible novelty is the combination.** Architecture-level (file→feature module) restructuring is *executed* deterministically for TS backends. Each step ships with a mechanical, test-free certificate. "Made obvious, not fixed" findings are recorded. Boundary rules are *generated from the plan*, and the remaining violations are baselined. I found no prior work that combines these.

---

## 1. Classic architecture recovery and clustering

| Work | What it does | Language | Executes? | Verifies behavior? | TS/JS? | Citation |
|---|---|---|---|---|---|---|
| **Bunch** (Mancoridis et al. IWPC'98; Mitchell & Mancoridis TSE 2006) | Clusters the module dependency graph by maximizing MQ, using hill-climbing or a GA | Language-agnostic graph | No (recovers only) | No | No | https://doi.org/10.1109/WPC.1998.693283 · https://doi.org/10.1109/TSE.2006.31 |
| Bunch evaluation (Mitchell & Mancoridis, Soft Computing 12(1):77–93, 2008) | Evaluates the MQ-guided search. TurboMQ is the MQ variant Bunch uses (details UNVERIFIED) | Any | No | No | No | https://researchdiscovery.drexel.edu/esploro/outputs/journalArticle/On-the-evaluation-of-the-Bunch/991019167811504721 (DOI not verified) |
| **ACDC** (Tzerpos & Holt, WCRE 2000) | Comprehension-driven, pattern-based clustering, e.g. directory structure and support-library patterns (pattern list from memory, not re-verified) | Any | No | No | No | https://doi.org/10.1109/WCRE.2000.891477 (Crossref title has the typo "ACCD") |
| **LIMBO** (Andritsos & Tzerpos, TSE 2005) | Information-theoretic hierarchical clustering. Can weight non-structural attributes such as **file names** and ownership | Any | No | No | No | https://doi.org/10.1109/TSE.2005.25 |
| **WCA** (Maqbool & Babri; analyzed in TSE 2007) | Hierarchical clustering with weighted combined similarity | Any (evaluated on legacy systems) | No | No | No | https://doi.org/10.1109/TSE.2007.70732 |
| **ARC** (Garcia et al., ASE 2011) | Concern (topic-model) based recovery of components and connectors | Java (plus others in later studies) | No | No | No | https://doi.org/10.1109/ASE.2011.6100123 |
| **ZBR** (Corazza et al., CSMR 2011; EMSE 2015) | Lexical, zone-weighted clustering | Any | No | No | No | https://doi.org/10.1109/CSMR.2011.8 · https://doi.org/10.1007/s10664-014-9347-3 |
| **Garcia, Ivkovic, Medvidovic** (ASE 2013) | Compares 6 techniques against 8 verified ground truths. Abstract: "two of the techniques routinely outperform the rest, but even the best … has surprisingly low accuracy". Usually cited as ARC and ACDC (UNVERIFIED from the abstract) | Java, C | — | — | No | https://doi.org/10.1109/ASE.2013.6693106 |
| Ground-truth architectures (Garcia et al., ICSE 2013) | Method for obtaining ground-truth architectures | — | — | — | — | https://doi.org/10.1109/ICSE.2013.6606639 |
| **Lutellier et al.** (ICSE 2015; TSE 2018) | 9 variants of 6 techniques, including on Chromium (9.7 MLOC). Symbol-level dependencies beat include-level ones, and "overall accuracy is low for all recovery techniques" | C/C++, Java | — | — | No | https://doi.org/10.1109/ICSE.2015.136 · https://doi.org/10.1109/TSE.2017.2671865 |
| Metrics: MoJo (1999), **MoJoFM** (2004), a2a (Le et al. MSR 2015; a2a attribution UNVERIFIED) | Edit-distance similarity to a ground truth | — | — | — | — | https://doi.org/10.1109/WCRE.1999.806959 · https://doi.org/10.1109/WPC.2004.1311061 · https://doi.org/10.1109/MSR.2015.29 |
| **Reflexion models** (Murphy, Notkin, Sullivan, FSE 1995) | Checks conformance of code against a hypothesized module map | Any | No | No | No | https://doi.org/10.1145/222124.222136 |
| Reflexion plus automated mapping, HuGMe (Christl, Koschke, Storey: WCRE 2005; IST 2007) | Assigns unmapped entities to target modules automatically. This is exactly "decide where files go given target modules" | C/Java | No | No | No | https://doi.org/10.1109/WCRE.2005.17 · https://doi.org/10.1016/j.infsof.2006.10.015 |
| Olsson et al. (JSS 2021) | Naive Bayes mapping from source entities to architecture modules | Java | No | No | No | https://doi.org/10.1016/j.jss.2021.111095 · arXiv https://arxiv.org/abs/2109.09525 |
| Ehrhardt & Koschke (ICSA-C 2025) | Controlled experiment on automated reflexion-mapping suggestions | — | No | No | No | https://doi.org/10.1109/ICSA-C65153.2025.00068 |

**What this means for us:**
- Recovery output is a clustering. It is evaluated with MoJoFM/a2a against expert ground truth, which matches our scramble-benchmark plan.
- Accuracy depends on how precise the dependencies are, which argues for using symbol-level resolved dependencies from ts-morph rather than raw `import` text.
- Nothing in this group executes a restructuring.

## 2. Search-based remodularization

| Work | What it does | Language | Executes? | Verifies behavior? | TS/JS? | Citation |
|---|---|---|---|---|---|---|
| Harman, Hierons, Proctor (GECCO 2002, pp. 1351–1358) | GA representation and crossover for modularization | Any | No | No | No | No DOI found. Details come from a search snippet only: UNVERIFIED |
| **Praditwong, Harman, Yao** (TSE 2011) | Multi-objective clustering (MCA/ECA) on 17 problems. Beats single-objective MQ | Any | No | No | No | https://doi.org/10.1109/TSE.2010.26 |
| Abdeen, Ducasse, Sahraoui (WCRE 2009) | Simulated annealing to minimize package coupling and cycles | OO (Smalltalk/Java) | No | No | No | https://doi.org/10.1109/WCRE.2009.13 |
| Bavota et al. (WCRE 2010; EMSE 2013; interactive GA at SSBSE 2012) | Splits packages using structural plus semantic measures; developer-in-the-loop GA | Java | No | No | No | https://doi.org/10.1109/WCRE.2010.29 · https://doi.org/10.1007/s10664-012-9226-8 · https://doi.org/10.1007/978-3-642-33119-0_7 |
| **Mkaouer et al.** (TOSEM 2015) | NSGA-III over structure, semantic coherence, change history and **"minimize the number of changes"**. Goes beyond move-class and split-package. Evaluated on 4 OSS systems plus 1 automotive system, with engineers | Java | No (recommends sequences) | No | No | https://doi.org/10.1145/2729974 |
| Schröder et al. (Adyen, ICSE-SEIP 2021) | Search-based remodularization at 5.5M+ LOC; developers judged the recommendations valuable. Whether they were executed is UNVERIFIED | Java | UNVERIFIED | No | No | https://arxiv.org/abs/2102.00701 |
| E-SC4R (Tan, Chong, Aleti, 2021) | Explains clustering choice across 30 systems | Java | No | No | No | https://arxiv.org/abs/2107.01766 |
| REARRANGE (Tan, Chong, Aleti, ICSE'23 poster) | States outright that the benefit of clustering "is only realized if developers follow through with the recommended refactoring suggestions" | Java | No (estimates effort) | No | No | https://arxiv.org/abs/2303.06283 |

**What this means for us:**
- A small-diff objective is prior art (Mkaouer).
- The "last mile" of actually executing a remodularization is an explicitly named gap (REARRANGE). We can cite it as motivation.

## 3. Monolith-to-microservice decomposition

| Work | What it does | Language | Executes? | Verifies behavior? | TS/JS? | Citation |
|---|---|---|---|---|---|---|
| Service Cutter (Gysel et al., ESOCC 2016) | Cuts services from requirement and design artefacts using coupling criteria | Model-level | No | No | No | https://doi.org/10.1007/978-3-319-44482-6_12 |
| **MEM** (Mazlami, Cito, Leitner, ICWS 2017) | Formal extraction model with a web prototype that recommends candidates. Coupling strategies are logical/semantic/contributor (from memory) | Git and code history | No | No | No | https://doi.org/10.1109/ICWS.2017.61 |
| **Fritzsch et al.** (DEVOPS 2018, LNCS 2019) | Classification of monolith-to-microservice refactoring approaches | — | — | — | — | https://arxiv.org/abs/1807.10059 · https://doi.org/10.1007/978-3-030-06019-0_10 |
| **Mono2Micro** (Kalia et al., IBM, ESEC/FSE 2021) | Spatio-temporal decomposition from business use cases plus runtime traces | Java | **Partly**: the IBM product generates starter and proxy code for partitions, and monolith classes are reused as-is | No | No | https://doi.org/10.1145/3468264.3473915 · https://www.ibm.com/docs/SS7H9Y/doc/m2m_1_overview.html |
| **CARGO** (Nitin et al., ASE 2022, Distinguished Paper) | Refines partitions using a context- and flow-sensitive system dependency graph, including database dependencies. Tested on 5 Java EE apps | Java | No | No | No | https://doi.org/10.1145/3551349.3556960 · https://arxiv.org/abs/2207.11784 |
| **MicroRefact** (Freitas, Ferreira, Cunha, SBLP 2021; COLA 2023) | Takes a microservice proposal and **refactors the classes**, generating REST APIs for cross-service calls. "Successfully refactor[s] 80% of the Java applications tested" | Java | **Yes** | Not formally (UNVERIFIED beyond compiling) | No | https://doi.org/10.1145/3475061.3475086 · https://doi.org/10.1016/j.cola.2023.101205 |
| Abgaz et al. SLR (TSE 2023); Martínez Saucedo et al. mapping study (IST 2025) | Surveys | — | — | — | — | https://doi.org/10.1109/TSE.2023.3287297 · https://doi.org/10.1016/j.infsof.2024.107590 |
| Peixoto et al. (EuroPLoP 2025) | Catalogue of 7 code-level refactorings that prepare for extraction. Calls migration "largely manual and labour-intensive" | — | No (catalogue) | No | No | https://arxiv.org/abs/2510.03050 |
| **MonoEmbed** (Sellami & Saied, 2025) | LLM embeddings with contrastive/LoRA fine-tuning, then clustering | Not stated in the abstract | No (partitions only) | No | UNVERIFIED | https://arxiv.org/abs/2502.04604 |
| **MicroAgent** (Su et al., ASE 2026 per arXiv) | 5-agent decomposition. Reports 89.2% average "decomposition accuracy", +24.6% over the prior state of the art, on 10 Java web apps | Java | No | No | No | https://arxiv.org/abs/2606.29742 |
| Silva et al. (2026) | Checks LLM (o3) decompositions against source dependencies. Dependency preservation (TPD) of 68.0% on PetClinic and 83.3% on Bookstore. Warns to control for mapping coverage | Java | No | Structural check only | No | https://arxiv.org/abs/2607.28331 |
| Albuquerque et al. (2026); Renan et al. (2026) | o3 from requirements reaches F1 0.79 zero-shot vs 0.97 few-shot. Second paper characterizes LLM-generated microservice architectures | — | No | No | No | https://arxiv.org/abs/2607.28307 · https://arxiv.org/abs/2609.20308 |
| Weerasinghe et al. (LNNS 2026) | Comparative evaluation of decomposition frameworks. Full text not accessible | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | https://doi.org/10.1007/978-3-032-32032-2_29 |

**What this means for us:**
- This literature targets *distribution* boundaries and is almost all Java and recommendation-only.
- Our target is the in-process "modular monolith": feature modules plus inner layers. It is a lower-risk step that comes before, or instead of, microservices.
- MicroRefact is the closest "executes a decomposition" prior art. It is Java-only and has no behavior certificate.

## 4. LLM-based work, 2023–2026

### 4a. Architecture recovery and modularization with LLMs (all recover or recommend; none execute)
- **SLR, Schmid et al. (2025):** covers 18 papers. Finds that "checking conformance remain[s] underexplored" and that most work uses simple prompting. https://arxiv.org/abs/2505.16697
- **SemRef (Zhang et al.):**
  - Uses an LLM plus dependency analysis to refine the output of 10 recovery tools on 9 ground-truth projects.
  - Reports relative gains of +118.57% MoJoFM and +100.41% a2a_adj.
  - The arXiv comment says "Accepted by ICSE 2026", but the submission date is 2026-07-26, so the venue is inconsistent and UNVERIFIED. Language UNVERIFIED.
  - https://arxiv.org/abs/2607.23774
- **ClassLAR (He, Huai, Chen, Garcia, Dec 2025):**
  - A language model over **fully-qualified class names** recovers JPMS modules.
  - On 20 Java projects it beats the state of the art on architecture-similarity metrics and is 3.99–10.50× faster.
  - This supports the kickoff's "name stems first" pre-clustering idea: names carry module intent.
  - https://arxiv.org/abs/2512.15980
- **ArchAgent (Pan et al., 2026; arXiv lists ICASSP 2026):** static analysis plus adaptive segmentation plus LLM synthesis, producing multiview diagrams. https://arxiv.org/abs/2601.13007
- **Other 2025–26 recovery work:**
  - ROS 2 LLM-assisted recovery: https://arxiv.org/abs/2605.20055
  - Recovering intent from work items: https://arxiv.org/abs/2608.28403
  - Architecture description from code: https://arxiv.org/abs/2511.05165

### 4b. LLM proposes, trusted engine executes (method and symbol level)
- **EM-Assist (Pomian et al., FSE 2024 demo):**
  - Extract Method. 76.3% of raw LLM suggestions were hallucinations.
  - The IntelliJ refactoring engine validates and applies the suggestions. Recall 53.4% vs 39.4% for the previous best tool.
  - Java. **Executes via the IDE.** https://arxiv.org/abs/2405.20551
- **MM-assist (Bellur, Batole et al., ICSME 2025):**
  - Move Method. Up to 80% of LLM suggestions were hallucinations; IDE static analysis filters them; the IDE executes.
  - 1.7× Recall@1/@3; at least 2.4× on 210 recent refactorings; 82.8% of recommendations rated positively by 30 developers.
  - Java. https://arxiv.org/abs/2503.20934
- **RefactoringMirror (Liu et al., ASE journal 2025):**
  - 13/176 ChatGPT and 9/137 Gemini refactoring solutions were unsafe (changed functionality or broke syntax).
  - Fix: detect the refactoring and **re-apply it with a tested IDE engine**. Java. https://arxiv.org/abs/2411.04444
- **Multi-agent coordinated rename (Bellur et al., 2026):** applies renames through the IDE's refactoring APIs instead of custom logic. https://arxiv.org/abs/2601.00482
- **LLM writes the transformation instead of the code:**
  - Google, Ziftci et al. 2025: 39 migrations, 595 submissions, 93,574 edits; 74.45% of code changes were LLM-generated; developers estimated about 50% time saved. https://arxiv.org/abs/2504.09691
  - Allain et al. (ASE 2026): LLM-synthesized Comby, GritQL and ast-grep rules. https://arxiv.org/abs/2609.03592
  - BigBag (Reyes, Baudry, Monperrus 2026): agent writes Spoon/JavaParser transformations for breaking dependency updates; 94.3% compilable, 78.6% fix rate. https://arxiv.org/abs/2606.24446

### 4c. LLM and agent refactoring where the LLM writes the code
- **MANTRA (Xu et al., 2025):**
  - 703 pure refactorings across 10 Java projects; 82.8% compile and pass tests, vs 8.7% for RawGPT.
  - 50% better than EM-Assist on Extract Method. https://arxiv.org/abs/2503.14340
- **RefAgent (Oueslati, Lamothe, Khomh; ICSE 2026 per researchr):** plan/execute/test agents on 8 Java projects; median 90% unit-test pass rate. https://arxiv.org/abs/2511.03153
- **REFINE (2026):** Java, 450 files. Authors say outputs are "candidates requiring compilation, testing, dependency analysis, and human review". Residual risks include method removal and assertion changes. https://arxiv.org/abs/2608.23611
- **Agentic Refactoring (Horikawa et al., TOSEM):**
  - 15,451 refactorings across 12,256 agent PRs, Java only.
  - Agents favor low-level edits: Change Variable Type 11.8%, Rename Parameter 10.4%, Rename Variable 8.5%. This contrasts with the high-level design changes common in human refactoring. https://arxiv.org/abs/2511.04824
- **ICSME 2026 roadmap (Sun et al.):** "existing approaches remain limited to method-level tasks". https://arxiv.org/abs/2609.01236
- **Architecture-level change by an agent, TypeScript (Abenhaim 2026):**
  - Single-author case study: 717k-line TS app, 189 files.
  - Spec-first protocol with 31 audit passes, no test oracle and no human code review.
  - Changes behavior intentionally, so it is not a refactoring certificate. https://arxiv.org/abs/2608.12440

### 4d. Benchmarks
- **RefactorBench (ICLR 2025):**
  - 100 multi-file tasks from 9 **Python** repos (per the GitHub README).
  - Agents solve 22% vs 87% for a human; state-aware agents improve by 43.9%.
  - https://arxiv.org/abs/2503.07832 · https://github.com/microsoft/RefactorBench
- **RefactorPlatform (EMNLP 2026 demo):** harness over RefactorBench with AST-based verification. Single-agent RAG reaches 86% vs 66% for multi-agent. https://arxiv.org/abs/2609.04898
- **SWE-Refactor (2026):** 1,099 Java instances from 18 repos, checked by compiling, running tests and RefactoringMiner. A Codex agent gets 39.4% on compound refactorings. https://arxiv.org/abs/2602.03712
- **CodeTaste (Thillen et al., 2026):** agents do well when the refactoring is specified in detail, but fail to *discover* human refactoring choices. "Propose-then-implement" improves alignment, which supports plan-as-data. https://arxiv.org/abs/2603.04177
- **SWE-Bench ProMax (COLM 2026):** 170 multilingual instances **including TypeScript**, averaging 11.4 files each; best model 41.2%; test-based. https://arxiv.org/abs/2608.09802
- **SmellBench (2026):**
  - Architectural smells in Python (scikit-learn). 63.1% of detected smells are false positives; best agent resolves 47.7%.
  - The most aggressive agent introduced 140 new smells. No behavior-preservation check. https://arxiv.org/abs/2605.07001
- **ScarfBench (2026):** behavior-preserving Java framework migration. Best agent passes 15.3% (focused) and 12.2% (whole apps) of tests; only 1 of 204 tasks came out fully behaviorally equivalent. https://arxiv.org/abs/2605.06754
- **Dristi & Dwyer (2026):** differential fuzzing finds 19–35% of LLM refactorings functionally non-equivalent, and about 21% of those slip past the existing tests. https://arxiv.org/abs/2602.15761
- **"Edit, But Verify" (2026):** the two instructed code-editing benchmarks are more than 90% Python, and **TypeScript is absent**. https://arxiv.org/abs/2604.05100

### 4e. LLMs and architecture conformance
- **Su et al. (ICSA 2026, Distinguished Paper):** LLMs checked 980 ADRs (architecture decision records) across 109 repos. Good on explicit, code-inferable decisions; weak on implicit ones. https://arxiv.org/abs/2602.07609
- **Slater (2025, under review, single author, low weight):** Llama 3 8B had an 80% architectural violation rate on a hexagonal-architecture task; GPT-5.1 had 0%. https://arxiv.org/abs/2512.04273
- **Canedo (2026):** TypeScript interface contracts and OpenAPI specs narrow the gap for weaker models. https://arxiv.org/abs/2608.21747

## 5. Verifying behavior preservation

| Line of work | What it does | Language | Relation to our certificate | Citation |
|---|---|---|---|---|
| **Translation validation** (Pnueli, Siegel, Singerman, TACAS 1998; Necula, PLDI 2000) | Checks each compiler run's output against its input, instead of verifying the compiler | — | Our per-step check *is* translation validation, applied to a codemod | https://doi.org/10.1007/BFb0054170 · https://doi.org/10.1145/349299.349314 |
| Regression verification (Godlin & Strichman, DAC 2009; STVR 2013) | Proves equivalence of similar programs | C | Heavier alternative | https://doi.org/10.1145/1629911.1630034 · https://doi.org/10.1002/stvr.1472 |
| **Name-binding preservation, JRRT** (Schäfer, Ekman, de Moor, OOPSLA 2008; Schäfer & de Moor, OOPSLA 2010; Schäfer, Thies, Steimann, Tip, TSE 2012; PLPV 2009 challenge) | Correct by construction: every name must bind to the same declaration after the refactoring | Java | **Closest conceptual ancestor** of identity-normalized AST equality. We apply it at module-specifier granularity, as an after-the-fact checker | https://doi.org/10.1145/1449764.1449787 · https://doi.org/10.1145/1869459.1869485 · https://doi.org/10.1109/TSE.2012.13 · https://doi.org/10.1145/1481848.1481859 |
| **JS refactoring soundness** (Feldthaus et al., OOPSLA 2011; Feldthaus & Møller, OOPSLA 2013) | Pointer-analysis preconditions for JS refactorings. Notes that JS tools "often [are] unable to ensure that program behavior is preserved" | JS | Precondition approach; ours is a post-hoc check | https://doi.org/10.1145/2048066.2048078 · https://doi.org/10.1145/2509136.2509520 |
| **ES5 → ES6 modules** (Paltoglou et al., SANER 2018; JSS 2021) | Automated module migration driven by a Module Dependence Graph; tested on 19 projects | JS | Closest **executed, module-level JS** restructuring, but it is a syntax migration, not domain regrouping | https://doi.org/10.1109/SANER.2018.8330227 · https://doi.org/10.1016/j.jss.2021.111049 · https://arxiv.org/abs/2107.10164 |
| **SafeRefactor** (Soares et al., IEEE Software 2010; TSE 2013) | Generates tests and compares behavior. Across 153,444 transformations it found 57 compile bugs and 63 behavioral bugs in Eclipse JDT, NetBeans and JRRT. Randoop use not re-verified | Java | Test-based oracle; ours needs no tests | https://doi.org/10.1109/MS.2010.63 · https://doi.org/10.1109/TSE.2012.19 |
| **Refactoring-engine bug studies** (Wang et al., TOSEM 2026 / arXiv 2024) | 518 bugs in Eclipse, IntelliJ and NetBeans. Top error-prone types: Extract 28.76%, Inline 16.99%, **Move 15.44%**. "Incorrect transformations" is the top root cause. 134 new bugs in the TOSEM version (130 in arXiv v1) | Java | Motivates not trusting the executor: check its output independently | https://doi.org/10.1145/3747289 · https://arxiv.org/abs/2409.14610 |
| RETESTER (FORGE 2025) | LLM- and bug-report-driven differential testing of engines; 18 new bugs | Java | Same motivation | https://arxiv.org/abs/2501.09879 |
| LLMs as refactoring-bug oracles (Gheyi et al., EMSE 2026) | 226 real IDE refactoring bugs; best model reached 93.8% accuracy | Java | Possible LLM second opinion, not a certificate | https://arxiv.org/abs/2605.02096 |
| Rope bugs via foundation models (Oliveira et al., SBES 2026) | 13 bugs, 12 accepted | Python | — | https://arxiv.org/abs/2608.09919 |
| TS language service, anecdotal | "Move to New File" crashes with `@/` path aliases (#58897, closed as not planned). **No systematic study of TS/VS Code refactoring-engine bugs found** (absence UNVERIFIED) | TS | Supports checking `paths` aliases explicitly | https://github.com/microsoft/TypeScript/issues/58897 |
| **RefactoringMiner** (ICSE 2018; 2.0 in TSE 2022) | Detects refactorings in history. The README now lists "Java, Python, Kotlin, TypeScript, JavaScript, C and C++", including Move/Rename/Split/Merge Package. Ships a purity checker and an MCP server | Multi, **incl. TS/JS** | Usable as an independent **third oracle**: each step should show up as pure Move/Rename only | https://doi.org/10.1145/3180155.3180206 · https://doi.org/10.1109/TSE.2020.3007722 · https://github.com/tsantalis/RefactoringMiner |
| PurityChecker (Noori) | Pure method-level refactoring detection. Claimed precision 95% and recall 88%; the paper itself was not located (UNVERIFIED) | Java | — | https://github.com/pedramnoori/RefactoringMiner |
| **RefDiff** (MSR 2017; 2.0 in TSE 2021) | Language-agnostic Code Structure Tree. Plugins for JS and C, with precision and recall of 88–91% | Java, **JS**, C | Alternative oracle | https://arxiv.org/abs/1704.01544 · https://doi.org/10.1109/TSE.2020.2968072 |
| RefModel (SBES 2025) | Foundation-model refactoring detection | Multi | — | https://arxiv.org/abs/2507.11346 |
| SemaDiff (Ayub, …, Tsantalis, Papadakis, 2026) | Generated code and tests classify commits as semantics-preserving or not: 76% correct, 100% precision on semantics-changing | Java | Test-based | https://arxiv.org/abs/2607.13111 |
| RefDistiller (FSE 2014); AlOmar et al. mapping study (2021) | Refactoring-aware review; taxonomy of behavior-preservation approaches | Java | — | https://doi.org/10.1145/2635868.2661674 · https://arxiv.org/abs/2106.13900 |
| Someya et al. (ICSME 2025) | Only 33.9% of behavior-preserving changes could be decomposed into refactoring operations by an existing detector | Java | Supports small, single-purpose steps | https://arxiv.org/abs/2508.11993 |
| Ferreira et al. (2025) | Over 27,450 refactorings: "floss" refactorings mixed with other changes raise bug-proneness, and current behavior-preservation detection misses many refactoring-induced bugs | Java | **Evidence for "never fix bugs in a refactor step"** | https://arxiv.org/abs/2505.08005 |
| Herzig & Zeller (MSR 2013); Chen & Hayashi (JSS 2026) | Tangled changes. About 20% of commit messages hint at refactorings spread across commits | Java | Supports bisectable per-step commits | https://doi.org/10.1109/MSR.2013.6624018 · https://arxiv.org/abs/2609.07482 |
| REM2.0 (2026) | Coq equivalence proofs for Rust extract-function | Rust | Formal end of the spectrum | https://arxiv.org/abs/2601.19207 |

## 6. Freezing architecture and restructuring tools (not academic, but direct prior art for parts of the claim)

- **ArchUnit `FreezingArchRule`:** records existing violations in a `ViolationStore` and only reports new ones. Also has layered, onion and slice rules. https://www.archunit.org/userguide/html/000_Index.html
- **dependency-cruiser `--baseline` / `--ignore-known`:** the same "freeze known violations" idea in the TS ecosystem. `--init` produces preset rules. The docs describe **no feature that generates rules from an inferred module structure**. https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md
- **Restructure101 (2011):** you drag classes between packages in a sandbox model, then "the final action list can be exported to Eclipse and IntelliJ" to apply. Java, .NET and others. https://www.methodsandtools.com/tools/restructure.html
- **SonarJ / Sonargraph "virtual refactorings":** simulate moves and measure against the virtual state; they don't change code. https://www.codecentric.de/en/knowledge-hub/blog/how-to-simulate-refactoring-restructuring-of-java-code-with-sonar

## 7. Feature coverage matrix (✓ = found in prior work, ~ = partial, ✗ = not found)

| Claim component | Prior art | Status |
|---|---|---|
| Decide module membership (clustering / LLM) | Bunch…ClassLAR, SemRef, MonoEmbed, MicroAgent, HuGMe | ✓ not new |
| LLM outputs a plan only; deterministic engine executes | EM-Assist, MM-assist, RefactoringMirror, coordinated rename, BigBag, Google | ✓ not new at method/symbol level |
| *Executed* architecture-level restructuring (file→module + inner layers) | MicroRefact (Java, microservices), Restructure101 action export (Java), Mono2Micro codegen | ~ Java and microservices only; **nothing found for TS/JS feature modules** |
| Per-step behavior certificate that needs no tests | Translation validation (concept), JRRT binding preservation (by construction, Java), RefactoringMiner/RefDiff purity (detection, heuristic) | ~ concept exists; **no TS module-move checker found** |
| Hazard scan for location-sensitive code (`__dirname`, dynamic `require`, globs) | Not found as a published check | ✗ (absence UNVERIFIED) |
| Bisectable commit per step | Tangled-change and decomposition studies support it | ~ practice, not a contribution |
| Findings log: "made obvious, never fixed" | Not found. Ferreira 2025 and Dristi & Dwyer 2026 give supporting evidence | ✗ novel as a discipline (soft) |
| Boundary rules generated from the plan, residual violations frozen | Freezing exists (ArchUnit, dependency-cruiser). Generating rules from an inferred decomposition was not found | ~ the freezing is not new; the generation is |
| Scramble-and-recover benchmark (MoJoFM) | MoJoFM/ground-truth evaluation ✓. Spaghetti Architect (2026) mints labelled "messy" programs, but at program level and without TS (https://arxiv.org/abs/2607.18642). Artificially degraded package benchmarks are suspected prior art (Bavota-era) but **UNVERIFIED** (search budget exhausted) | ~ |
| TS/JS target | Feldthaus 2011/13, Paltoglou 2018/21, RefDiff JS, RefactoringMiner TS, SWE-Bench ProMax TS | ~ thin; **no TS architecture recovery or remodularization paper found** |

## 8. Conclusions on novelty

**Not new. Don't claim these:**
1. Using LLMs to decide architecture or module membership: there are 25+ years of clustering and several 2025–26 LLM papers.
2. Splitting the LLM's decision from deterministic execution. This is the 2024–26 consensus: EM-Assist, MM-assist, RefactoringMirror, Google.
3. Translation validation and binding preservation as ideas.
4. Freezing existing architecture violations (ArchUnit, dependency-cruiser).
5. "First AI agent for architectural refactoring". RefAgent, MicroAgent, ArchAgent and SmellBench-style agents exist.
6. "Formally verified" or "proves behavior is unchanged" in an absolute sense. The certificate checks a *sufficient condition* under stated assumptions. Its soundness is established empirically (mutation testing plus tests as a second oracle), not by proof.

**Plausibly new, as a combination (to the best of this search, which was Java-heavy and arXiv-heavy after the budget ran out):**
1. Architecture-granularity restructuring (type-sliced → feature modules with inner layers) that is **executed** end to end for **TypeScript backends**. Every published executor works at method level or targets Java and microservices.
2. A **test-free, per-step translation-validation certificate specialized to TS module semantics**:
   - resolved-import-graph equality modulo `pathMap`, with real resolution (tsconfig `paths`, index files, extensions);
   - identity-normalized AST equality;
   - a location-sensitivity hazard scan;
   - glob match-set preservation.

   Prior checkers either need tests (SafeRefactor, SemaDiff, fuzzing), are built into the engine for Java (JRRT), or are heuristic detectors (RefactoringMiner purity).
3. A refactor discipline that records exposed bugs as findings and never fixes them. Recent evidence motivates it: floss refactorings are more bug-prone, 19–35% of LLM refactorings are non-equivalent, and REFINE found assertion changes.
4. **Boundary rules generated from the plan** with residual violations baselined. This turns a one-off restructuring into an enforced architecture. Existing tools only freeze hand-written rules.
5. Measured against the literature, the scramble benchmark with MoJoFM recovery gives a quantitative plan-quality number that most LLM-refactoring papers lack.

**Honest pitch wording:**
- One line: *"An LLM architect that never writes code. Nemotron decides where each file belongs and why; a deterministic ts-morph codemod moves it; every step ships a machine-checked certificate that the program is unchanged, using no tests and no trust in the codemod."*
- Related-work sentence for the README: *"Architecture recovery (Bunch, ACDC, ARC; recently SemRef, ClassLAR) and microservice decomposition (Mono2Micro, CARGO, MicroAgent) recommend module boundaries, mostly for Java, and leave execution to developers. LLM refactoring tools that execute safely (EM-Assist, MM-assist, RefactoringMirror) work at method level. architecture-cleaner executes architecture-level moves for TypeScript and validates each step with translation validation over the resolved import graph, in the spirit of name-binding-preserving refactoring (Schäfer et al.)."*
- Say **"certificate"** or **"mechanically checked"**, not "formally proven". Say **"feature modules with explicit, enforced boundaries"**, not "Clean Architecture", unless dependency inversion is shipped (this matches the kickoff's A/B/C table).
- Say **"first we know of for TypeScript"**, not "first". The novelty is in the scope (TS, architecture-level, executed, certified), not in any single ingredient.

**Ammunition from the literature for the pitch and video:**
- Generic agents mostly make low-level edits (Horikawa et al.).
- The most aggressive architectural-smell agent introduced 140 new smells (SmellBench).
- Only 1 of 204 ScarfBench migrations was fully behaviorally equivalent.
- 19–35% of LLM refactorings are non-equivalent, and about 21% of those evade tests (Dristi & Dwyer). This supports "a certificate, not just tests".
- 76–80% hallucination rates in raw move and extract suggestions (EM-Assist, MM-assist). This supports validating the plan statically before executing.
- Single-agent RAG beat multi-agent, 86% vs 66% (RefactorPlatform). Don't over-build the agent topology.
- Propose-then-implement improves alignment (CodeTaste). This supports plan-as-data.

**Planning implications:**
- Use symbol-level resolved dependencies; Lutellier showed accuracy depends on dependency precision.
- Pre-cluster on names; ClassLAR shows names carry module intent.
- Report MoJoFM and a2a so results compare with SemRef and ClassLAR.
- Consider RefactoringMiner, which now lists TS/JS support, as an off-the-shelf third oracle: "every commit shows only Move/Rename". Its TS support quality is UNVERIFIED and needs a smoke test.
- Treat "the hazard scan is novel" carefully. No published equivalent turned up, but this search was not exhaustive.

**Gaps and unverified items to close if it matters:**
- Bavota-era "artificially degraded modularization" evaluations (scramble-benchmark prior art).
- Exactly which techniques topped Garcia 2013.
- The PurityChecker paper.
- RefactorBench's own verification method (RefactorPlatform describes it as AST-based).
- SemRef's venue.
- The Harman 2002 GECCO DOI/URL.
- Whether any TS-specific architecture recovery or remodularization paper exists outside arXiv (e.g. IEEE/ACM-only). A Crossref/OpenAlex sweep would settle it.
