# The pinned verification image (day-22 §2.3). Every tool version is fixed so a
# re-run cannot change a verdict without touching a line of code — `latest` in a
# verification image is a reproducibility bug.
FROM node:20.18.0-alpine3.20

# `tsc` + `vitest`, pinned to the workspace's own versions.
RUN npm install --global --no-audit --no-fund typescript@5.6.3 vitest@2.1.8 \
  && npm cache clean --force

# Non-root sandbox user (matches `--user 1000:1000`).
USER 1000:1000

WORKDIR /workdir