# Building a big machine with parallel agents

A machine of ODM-E1's size (about 7,000 lines across physics, gear, rider, world, effects and console) goes faster with one agent per module, but only with a contract written first. For anything the size of the examples, or smaller, one agent is faster: skip this.

`sims/odm-shared/CONTRACT.md` is the real contract that build ran on. Copy its shape:

1. **The integrator goes first, alone.** Write the spec and put every number in one params file. Build the stage, materials and bench (`kit/studio.js`, `kit/bench.js`), so every module is lit and judged the same way.
2. **One owner per file.** No two agents edit the same file. An owner who needs something else from another module codes against the published API and leaves a `// CONTRACT-REQUEST:` comment at the top of their own file for the integrator.
3. **Write out the API.** Exact names, units, frames and shapes for every module, including the physics state each frame reads. State the conventions that cause silent bugs, such as axes, units and which way is left. With y up and z forward, +x is the rider's anatomical **left**.
4. **Physics goes first, or runs in parallel against a stubbed state.** Everything else reads from it.
5. **Each owner verifies alone before reporting.** A bench page, stills, a read of the stills against the references and the skill's checklist, and for physics a node test printing peaks against the spec's values. Then report what was built, the API actually exposed, and what the integrator has to know.
6. **The integrator assembles and reviews the whole.** The film, the live page and the score are theirs, and no module is done until it has been seen in the full frame. Reports from owners are claims; read the sheets yourself.
