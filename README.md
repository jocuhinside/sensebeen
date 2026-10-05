# sensebeen: Postiz + Doogee capture node

Doogee (Android/Termux) captures media and drops it in `doogee/outbox/`; a cron job uploads it to a self-hosted Postiz instance through the public API. Default mode is `draft`, so nothing publishes until reviewed in Postiz.

## 1. Postiz host
```
cd postiz && cp .env.example .env   # set URLs, JWT_SECRET, POSTGRES_PASSWORD
docker compose up -d
```
Terminate TLS in front of :5000 (Caddy/nginx, or WireGuard/Tor); Postiz serves UI at `/` and API at `/api`. Create the first account, connect channels, then set `DISABLE_REGISTRATION=true`. Generate the API key at Settings → Public API.

## 2. Doogee
Install Termux from F-Droid, copy `doogee/` onto the phone, then:
```
cd doogee && ./setup-termux.sh        # first run creates postiz.env
$EDITOR postiz.env                    # URL + API key
./postiz-post.sh channels             # lists id / provider / name -> fill POSTIZ_CHANNELS, POSTIZ_PROVIDERS
./postiz-post.sh post "test" ~/storage/dcim/Camera/x.jpg
```
Cron drains `outbox/` every 15 min (`<name>.jpg|png|mp4` + optional `<name>.txt` caption); sent files move to `sent/`. Disable battery optimization for Termux and keep Termux:Boot if you want it surviving reboots. Sensor-triggered capture can write into `outbox/` (e.g. `termux-camera-photo`, `termux-sensor`).

## Media pipeline
`capture.sh snapshot|photo` (Termux:API camera) and `capture.sh ingest` (new files in `~/storage/dcim/Camera`, the Doogee camera app's output, which is where video comes from since Termux:API can't record video) all go through `media-prep.sh` before staging in `outbox/`:
- all metadata stripped (EXIF, GPS, device/serial tags); `snapshot` captions carry only battery and UTC time, never location
- images capped to `MAX_PX` (1920) JPEG; video transcoded H.264/AAC `faststart`, CRF 28, rejected over `MAX_VIDEO_MB` (100)
- sha256 dedupe in `.seen/`, so cron re-scans never double-post; caption sidecar (`<file>.txt` or `<name>.txt`) is carried over

Cron (set by `setup-termux.sh`): ingest every 10 min, upload every 15. Needs the Termux:API app (F-Droid) with camera permission, and `termux-setup-storage` for the DCIM path. Originals are never modified or deleted. Tested `media-prep.sh` on synthetic JPEG/MP4 (resize, metadata strip, dedupe, caption carry); `capture.sh` and the Termux:API calls are untested off-device. Check your Postiz instance's upload size limit against `MAX_VIDEO_MB`, and per-platform limits (X, IG) are stricter than that.

## Unverified
Written from memory of Postiz's public API (`POST /public/v1/upload`, `POST /public/v1/posts`, `GET /public/v1/integrations`, raw API key in `Authorization`). I couldn't reach a live instance from this sandbox; verify payload shape and per-provider `settings` against your Postiz version's docs before relying on `now`/`schedule`.

## PQC smoke test

The repository includes a reproducible environment-level PQC check in
[`pqc/`](pqc/). Run `./pqc/pqc-smoke-test.sh` from the repository root to
exercise ML-KEM-768 and ML-DSA-65 through the host OpenSSL provider. This is a
provider/readiness check only; the current application has no PQC code path.

## Run reports (Giles / Divya / anyone with hardware)
```
git clone -b claude/sleepy-ride-hc7wry https://github.com/jocuhinside/sensebeen.git
cd sensebeen
echo giles > runs/.runner          # or divya; gitignored
scripts/run-and-report             # local report in runs/<name>/<UTC>.json
scripts/run-and-report --commit    # also pushes it to branch runs/<name> only
```
Checks toolchain, runs the media pipeline on a synthetic image in a throwaway copy (resize, metadata-canary strip, dedupe), and probes sensors/camera/serial by capability only. Reports carry a hashed host id, coarse OS/arch, and git commit; no hostname, IPs, serials, GPS, paths, or `postiz.env`. A scrub guard deletes the report if it finds any of those. Exit code is non-zero on any failure. On Termux install `termux-api` + the Termux:API app first or the sensor checks will fail. Review the JSON before `--commit`: pushed history is permanent. Needs write access to the repo (add them as collaborators); `runs/*` branches never touch the working branch.
