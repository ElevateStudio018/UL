#!/usr/bin/env bash
# Hämtar GTFS Regional (UL) från Trafiklab och ett OSM-utdrag för Uppsala län.
# Kräver curl och osmium-tool.
set -euo pipefail
cd "$(dirname "$0")/data"
: "${TRAFIKLAB_GTFS_STATIC_KEY:?Ange TRAFIKLAB_GTFS_STATIC_KEY}"

echo "Hämtar GTFS Regional för UL…"
curl -fL --compressed -o ul.zip "https://opendata.samtrafiken.se/gtfs/ul/ul.zip?key=${TRAFIKLAB_GTFS_STATIC_KEY}"

if [ ! -f sweden-latest.osm.pbf ]; then
  echo "Hämtar OpenStreetMap för Sverige (Geofabrik)…"
  curl -fL -o sweden-latest.osm.pbf https://download.geofabrik.de/europe/sweden-latest.osm.pbf
fi
echo "Klipper ut Uppsala län…"
osmium extract --overwrite -b 16.6,59.3,18.9,60.75 sweden-latest.osm.pbf -o uppsala-lan.osm.pbf
echo "Klart. Bygg grafen med: docker compose -f otp/docker-compose.yml run --rm otp-build"
