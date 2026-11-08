#!/bin/sh
# Rebuilds client/public/sfx/cassette-*.wav from the CC0 freesound previews
# (see client/public/sfx/CREDITS.txt). Download each preview,
#   https://cdn.freesound.org/previews/<id/1000>/<id>_<user>-hq.mp3
# and decode it whole first, so the MP3 encoder delay is dropped (seeking into
# the MP3 directly would shift every cut by ~23 ms):
#   ffmpeg -i <id>.mp3 -ar 48000 -ac 2 -c:a pcm_s16le tools/out/sfx-wav/<id>.wav
# Each cut starts 1 ms before its first attack; SYNC in the comment is where
# the hit that lands on the animation event sits inside the file.
set -eu
src=tools/out/sfx-wav
dst=client/public/sfx
sub() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.4f", a - b }'; }
ff() { /opt/homebrew/bin/ffmpeg -hide_banner -loglevel error -y "$@"; }
# cut <id> <start s> <length s> <fade-out start s> <high-pass Hz> <channel: mix|left> <out>
cut() {
  if [ "$6" = left ]; then mono="pan=mono|c0=c0"; else mono="pan=mono|c0=0.5*c0+0.5*c1"; fi
  ff -ss "$2" -t "$3" -i "$src/$1.wav" -af "$mono,highpass=f=$5:poles=2,afade=t=in:d=0.001,afade=t=out:st=$4:d=$(sub "$3" "$4")" \
    -ar 32000 -c:a pcm_f32le tools/out/cassette-build/raw.wav
  # Peak-normalise to -1 dBFS like the other takes; loudness is set in code.
  peak=$(ff -i tools/out/cassette-build/raw.wav -af astats=measure_overall=Peak_level:measure_perchannel=0 -f null - 2>&1 | sed -n 's/.*Peak level dB: //p')
  ff -i tools/out/cassette-build/raw.wav -af "volume=$(sub -1 "$peak")dB" -c:a pcm_s16le "$dst/$7"
}
# Door released and springing open (SYNC 0.026: the latch).      cognito perceptu 98329
cut 98329  0.2270 0.45 0.30 100 mix  cassette-door-open.wav
# Old tape pushed out: the tray's hard pop (SYNC 0.003).           jpkweli 154756 (left channel only has signal)
cut 154756 1.0540 0.30 0.15 150 left cassette-eject.wav
# Old tape landing in snow: a soft touch, then the crunch (SYNC 0.050). kyles 450848
cut 450848 0.3020 0.28 0.16 90  mix  cassette-snow.wav
# Tape seated: brush, catch, then the heavy clack (SYNC 0.140).    cognito perceptu 98329
cut 98329  2.1940 0.50 0.34 60  mix  cassette-seat.wav
# Door snapped shut (SYNC 0.023: the closing hit).                  kyles 635487
cut 635487 8.8680 0.36 0.20 80  mix  cassette-door-shut.wav
# PLAY key down; the transport catches the tape (SYNC 0.040).      cognito perceptu 98329
cut 98329  3.6690 0.48 0.22 70  mix  cassette-play.wav
# STOP key: the clunk and the motor winding down (SYNC 0.015).     horraceradishh 734566
cut 734566 16.3460 0.80 0.45 70 mix  cassette-stop.wav
rm -f tools/out/cassette-build/raw.wav
