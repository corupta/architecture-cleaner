// A quiet bed for the v2 video, to open and change in https://strudel.cc (paste this file, or use the link in
// README.md). corupta's brief: it shouldn't grab attention; one instrument playing a four-note figure from the
// C major pentatonic scale, repeated without variation; a plain "tap tap tap blap" beat; no solo. Synthesized sounds
// only (oscillators and noise, no sample banks), so nothing in the mix is anyone else's recording.
setcpm(84 / 4) // 84 beats a minute, four beats a bar

stack(
  // // the figure: one note a beat, the same every bar
  // note("c4 e4 g4 e4").s("triangle")
  //   .attack(0.01).decay(0.3).sustain(0.2).release(0.5)
  //   .lpf(1400).room(0.25).gain(0.35),
  // // tap tap tap: three short, bright noise ticks
  // s("white white white ~").decay(0.03).sustain(0).hpf(6000).gain(0.1),
  // // blap: a low sine thump on the fourth beat, its pitch falling
  // note("~ ~ ~ c2").s("sine").decay(0.18).sustain(0).penv(12).pdecay(0.12).gain(0.5),

  n("1 3 2 <7 0>".ply(1).fast(2))
  // .add("[0, <1 3 2 <7 0>>]")
  //.scale("G2:mixolydian")
  //.scale("D2:dorian")
  .scale("<D2:dorian G2:mixolydian>".slow(4))
  .adsr(".1:.3:.2:.7")
  .sound("user")
  .partials([1, 1/2, 1/4, 1/8, 0, 0, 0, 1/128])
  .gain(.2)
  .lpf(256)
  // ._scope()
)