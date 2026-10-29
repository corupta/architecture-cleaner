# The v2 video's music bed (optional)

[bed.strudel.js](bed.strudel.js) is a starting point for corupta to change in [Strudel](https://strudel.cc), a live-coding
music environment that runs in the browser (AGPL-3.0; music made with it is ours). The brief, corupta's (S11): quiet,
never attention-grabbing, no stock music; one instrument on a four-note figure from the C major pentatonic scale,
repeated without variation; a plain "tap tap tap blap" beat; no solos. Only synthesized sounds (oscillators and
noise, no sample banks), so no third-party recording is in the mix.

- **Play it:** [open in strudel.cc](https://strudel.cc/#Ly8gQSBxdWlldCBiZWQgZm9yIHRoZSB2MiB2aWRlbywgdG8gb3BlbiBhbmQgY2hhbmdlIGluIGh0dHBzOi8vc3RydWRlbC5jYyAocGFzdGUgdGhpcyBmaWxlLCBvciB1c2UgdGhlIGxpbmsgaW4KLy8gUkVBRE1FLm1kKS4gY29ydXB0YSdzIGJyaWVmOiBpdCBzaG91bGRuJ3QgZ3JhYiBhdHRlbnRpb247IG9uZSBpbnN0cnVtZW50IHBsYXlpbmcgYSBmb3VyLW5vdGUgZmlndXJlIGZyb20gdGhlCi8vIEMgbWFqb3IgcGVudGF0b25pYyBzY2FsZSwgcmVwZWF0ZWQgd2l0aG91dCB2YXJpYXRpb247IGEgcGxhaW4gInRhcCB0YXAgdGFwIGJsYXAiIGJlYXQ7IG5vIHNvbG8uIFN5bnRoZXNpemVkIHNvdW5kcwovLyBvbmx5IChvc2NpbGxhdG9ycyBhbmQgbm9pc2UsIG5vIHNhbXBsZSBiYW5rcyksIHNvIG5vdGhpbmcgaW4gdGhlIG1peCBpcyBhbnlvbmUgZWxzZSdzIHJlY29yZGluZy4Kc2V0Y3BtKDg0IC8gNCkgLy8gODQgYmVhdHMgYSBtaW51dGUsIGZvdXIgYmVhdHMgYSBiYXIKCnN0YWNrKAogIC8vIHRoZSBmaWd1cmU6IG9uZSBub3RlIGEgYmVhdCwgdGhlIHNhbWUgZXZlcnkgYmFyCiAgbm90ZSgiYzQgZTQgZzQgZTQiKS5zKCJ0cmlhbmdsZSIpCiAgICAuYXR0YWNrKDAuMDEpLmRlY2F5KDAuMykuc3VzdGFpbigwLjIpLnJlbGVhc2UoMC41KQogICAgLmxwZigxNDAwKS5yb29tKDAuMjUpLmdhaW4oMC4zNSksCiAgLy8gdGFwIHRhcCB0YXA6IHRocmVlIHNob3J0LCBicmlnaHQgbm9pc2UgdGlja3MKICBzKCJ3aGl0ZSB3aGl0ZSB3aGl0ZSB%2BIikuZGVjYXkoMC4wMykuc3VzdGFpbigwKS5ocGYoNjAwMCkuZ2FpbigwLjEpLAogIC8vIGJsYXA6IGEgbG93IHNpbmUgdGh1bXAgb24gdGhlIGZvdXJ0aCBiZWF0LCBpdHMgcGl0Y2ggZmFsbGluZwogIG5vdGUoIn4gfiB%2BIGMyIikucygic2luZSIpLmRlY2F5KDAuMTgpLnN1c3RhaW4oMCkucGVudigxMikucGRlY2F5KDAuMTIpLmdhaW4oMC41KSwKKQo%3D), then press play (or Ctrl+Enter). If the link opens an empty editor, paste
  the file in.
- **Change it:** the notes are in `note("c4 e4 g4 e4")` (any of c d e g a keeps it pentatonic), the tempo in
  `setcpm(84 / 4)`, each part's loudness in `.gain(...)`. Save the result back into bed.strudel.js.
- **In the video:** after picture lock, rendered offline in the headless Chromium the captures already use, mixed
  about 25 dB under the voice and dropped for the pause in B3. If it isn't clearly better with it, the video has none.
