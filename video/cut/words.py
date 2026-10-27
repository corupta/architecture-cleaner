# The words of a voice-over take and when each is spoken, for timing the captions (video/cut/render.mjs): Vosk, an
# offline recognizer, with a model under video/.tools. Prints JSON: [{"word", "start", "end"}], seconds in the take.
#
#   video/.tools/venv/bin/python cut/words.py <take.wav> <model dir>
import json
import subprocess
import sys

from vosk import KaldiRecognizer, Model, SetLogLevel

SetLogLevel(-1)
take, model_dir = sys.argv[1], sys.argv[2]
recognizer = KaldiRecognizer(Model(model_dir), 16000)
recognizer.SetWords(True)
pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', take, '-f', 's16le', '-ac', '1', '-ar', '16000', '-'], check=True, capture_output=True).stdout
words = []
for offset in range(0, len(pcm), 8000):
    if recognizer.AcceptWaveform(pcm[offset:offset + 8000]):
        words += json.loads(recognizer.Result()).get('result', [])
words += json.loads(recognizer.FinalResult()).get('result', [])
print(json.dumps([{'word': word['word'], 'start': round(word['start'], 2), 'end': round(word['end'], 2)} for word in words]))
